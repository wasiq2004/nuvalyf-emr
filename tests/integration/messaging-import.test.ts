// Phase 8: consent-gated WhatsApp messaging and the all-or-nothing import.
import { randomUUID } from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ownerSql } from "./test-db";
import { createTestClinic } from "./fixtures";
import { withClinic } from "@/lib/db";
import { createStaff } from "@/features/staff/staff.service";
import { cancelAppointment } from "@/features/scheduling/booking.service";
import { registerPatient } from "@/features/patients/patients.service";
import { consentHistory, currentConsent, setConsent } from "@/features/messaging/consent.service";
import { createBroadcast, enqueueDueReminders, previewAudience, processQueue, saveConfig, saveTemplate, type Sender } from "@/features/messaging/messaging.service";
import { runMessagingTick } from "@/features/messaging/worker";
import { dryRun, runImport } from "@/features/import/import.service";
import { todayInTimeZone } from "@/lib/time";

const TZ = "Asia/Kolkata";
const owner = ownerSql();
const today = todayInTimeZone(TZ);

let clinic: Awaited<ReturnType<typeof createTestClinic>>;
let adminId: string;
let doctorId: string;
let templateId: string;
const patientIds: Record<string, string> = {};

const run = <T,>(fn: Parameters<typeof withClinic<T>>[1]) => withClinic({ clinicId: clinic.clinicId, userId: adminId }, fn);

/** A sender that records who it was asked to message. */
function recordingSender() {
  const sent: string[] = [];
  const sender: Sender = async (_creds, message) => {
    sent.push(message.to);
    return { ok: true, providerMessageId: `test-${randomUUID()}` };
  };
  return { sent, sender };
}

async function patient(key: string, mobile: string | undefined, consents: ("whatsapp_reminders" | "whatsapp_broadcasts")[]) {
  const p = await run((tx) =>
    registerPatient(tx, clinic.clinicId, { firstName: key, lastName: "Msg", sex: "female", statedAgeYears: 40, mobile }, { likelyIds: [], actorId: adminId, today }),
  );
  for (const type of consents) await run((tx) => setConsent(tx, clinic.clinicId, { patientId: p.id, type, granted: true, source: "front_desk" }, adminId));
  patientIds[key] = p.id;
  return p.id;
}

beforeAll(async () => {
  clinic = await createTestClinic("messaging");
  const [admin] = await owner`select id from app.users where clinic_id = ${clinic.clinicId}`;
  adminId = admin.id;
  // A plan with the WhatsApp module, so the worker picks the clinic up.
  const [plan] = await owner`insert into platform.plans (name) values (${`WA ${randomUUID().slice(0, 8)}`}) returning id`;
  await owner`insert into platform.plan_modules (plan_id, module) values (${plan.id}, 'whatsapp')`;
  await owner`update platform.clinics set plan_id = ${plan.id} where id = ${clinic.clinicId}`;

  await run((tx) =>
    saveConfig(
      tx,
      clinic.clinicId,
      { phoneNumberId: "1234567890", accessToken: "EAAG-very-secret", enabled: true, remindersEnabled: true, reminderHoursBefore: 24, reminderTemplate: "appointment_reminder", templateLanguage: "en" },
      adminId,
    ),
  );
  templateId = (await run((tx) => saveTemplate(tx, clinic.clinicId, null, { name: "health_camp", language: "en", category: "marketing", preview: "Hi {{1}}", isActive: true }))).id;

  await patient("Agreed", "9845000001", ["whatsapp_broadcasts", "whatsapp_reminders"]);
  await patient("Never", "9845000002", []);
  await patient("Changed", "9845000003", ["whatsapp_broadcasts"]);
  await patient("NoPhone", undefined, []);
  // Consent recorded while a mobile existed, then the mobile was removed.
  await patient("Removed", "9845000005", ["whatsapp_broadcasts"]);
  await owner`update app.patients set mobile = null where id = ${patientIds.Removed}`;

  doctorId = (await run((tx) => createStaff(tx, clinic.clinicId, { firstName: "Dr", lastName: "Msg", email: "dr@messaging.test", roleKeys: ["doctor"] }, adminId))).id;
});

afterAll(async () => {
  await owner.end();
});

describe("consent", () => {
  it("is a history; the latest event wins", async () => {
    const id = patientIds.Agreed;
    await run((tx) => setConsent(tx, clinic.clinicId, { patientId: id, type: "whatsapp_reminders", granted: false, source: "front_desk" }, adminId));
    await run((tx) => setConsent(tx, clinic.clinicId, { patientId: id, type: "whatsapp_reminders", granted: true, source: "patient_reply" }, adminId));
    expect((await run((tx) => currentConsent(tx, "whatsapp_reminders", [id]))).get(id)).toBe(true);
    const history = await run((tx) => consentHistory(tx, id));
    expect(history.filter((h) => h.type === "whatsapp_reminders").map((h) => h.granted)).toEqual([true, false, true]);
    // Re-recording the current state adds nothing.
    expect(await run((tx) => setConsent(tx, clinic.clinicId, { patientId: id, type: "whatsapp_reminders", granted: true, source: "front_desk" }, adminId))).toEqual({ changed: false });
    await expect(owner`delete from app.consent_events where patient_id = ${id}`).rejects.toThrow(/append-only/);
  });

  it("stores the WhatsApp token encrypted", async () => {
    const [row] = await owner`select access_token_encrypted from app.whatsapp_config where clinic_id = ${clinic.clinicId}`;
    expect(row.access_token_encrypted).toMatch(/^v1:/);
    expect(row.access_token_encrypted).not.toContain("very-secret");
  });
});

describe("broadcasts", () => {
  it("never reach a patient without consent - including one who withdraws after it was queued", async () => {
    const preview = await run((tx) => previewAudience(tx, { kind: "all" }, today));
    expect(preview).toEqual({ matched: 5, recipients: 2, noConsent: 2, noMobile: 1 });

    const key = randomUUID();
    const input = { templateId, title: "Health camp", audience: { kind: "all" } as const, idempotencyKey: key };
    const first = await run((tx) => createBroadcast(tx, clinic.clinicId, input, adminId, today));
    const again = await run((tx) => createBroadcast(tx, clinic.clinicId, input, adminId, today));
    expect(again.result.broadcastId).toBe(first.result.broadcastId);
    expect(first.result.recipients).toBe(2);

    // "Changed" withdraws after the broadcast was queued.
    await run((tx) => setConsent(tx, clinic.clinicId, { patientId: patientIds.Changed, type: "whatsapp_broadcasts", granted: false, source: "patient_reply" }, adminId));

    const { sent, sender } = recordingSender();
    const stats = await run((tx) => processQueue(tx, clinic.clinicId, sender));
    expect(sent).toEqual(["919845000001"]);
    expect(stats).toMatchObject({ sent: 1, skipped: 1 });
    const [skipped] = await owner`select status, error from app.message_log where patient_id = ${patientIds.Changed}`;
    expect(skipped).toEqual({ status: "skipped", error: "No consent at the time of sending" });
    const never = await owner`select id from app.message_log where patient_id in (${patientIds.Never}, ${patientIds.NoPhone}, ${patientIds.Removed})`;
    expect(never).toHaveLength(0);
    const [b] = await owner`select status from app.broadcasts where id = ${first.result.broadcastId}`;
    expect(b.status).toBe("sent");
  });
});

describe("reminders", () => {
  it("go once per appointment, only with consent, and not for cancelled appointments", async () => {
    // Two appointments three hours from now (inserted directly: slot rules are
    // tested elsewhere), for a consenting and a non-consenting patient.
    const startsAt = new Date(Date.now() + 3 * 3_600_000);
    const at = (minutes: number) => new Date(startsAt.getTime() + minutes * 60_000).toISOString();
    const [yes] = await owner`insert into app.appointments (clinic_id, patient_id, doctor_id, starts_at, ends_at) values (${clinic.clinicId}, ${patientIds.Agreed}, ${doctorId}, ${at(0)}, ${at(15)}) returning id`;
    await owner`insert into app.appointments (clinic_id, patient_id, doctor_id, starts_at, ends_at) values (${clinic.clinicId}, ${patientIds.Never}, ${doctorId}, ${at(15)}, ${at(30)})`;
    // Outside the 24-hour window: not yet.
    await owner`insert into app.appointments (clinic_id, patient_id, doctor_id, starts_at, ends_at) values (${clinic.clinicId}, ${patientIds.Agreed}, ${doctorId}, ${at(26 * 60)}, ${at(26 * 60 + 15)})`;

    const now = new Date();
    expect(await run((tx) => enqueueDueReminders(tx, clinic.clinicId, now))).toBe(1);
    expect(await run((tx) => enqueueDueReminders(tx, clinic.clinicId, now))).toBe(0);

    // Cancelled before the worker got to it: not sent.
    await run((tx) => cancelAppointment(tx, yes.id, "Patient called"));
    const { sent, sender } = recordingSender();
    const tick = await runMessagingTick(now, sender);
    expect(tick.errors).toEqual([]);
    expect(sent).toEqual([]);
    const [log] = await owner`select status, error from app.message_log where appointment_id = ${yes.id}`;
    expect(log).toEqual({ status: "skipped", error: "Appointment no longer booked" });
  });
});

describe("import", () => {
  const header = "first_name,last_name,sex,date_of_birth,age,mobile,consent_reminders,consent_broadcasts";

  async function patientCount() {
    const [row] = await owner`select count(*)::int as n from app.patients where clinic_id = ${clinic.clinicId}`;
    return row.n as number;
  }

  it("imports nothing when a single row is bad", async () => {
    const before = await patientCount();
    const csv = [header, "Kiran,Patel,male,,45,9845011111,yes,no", "Bad,Row,dragon,,,,,", "Leela,Shah,female,1990-01-02,,9845022222,no,yes"].join("\n");
    const report = await run((tx) => dryRun(tx, csv, today));
    expect(report.rows).toBe(3);
    expect(report.problems.map((p) => p.line)).toEqual([3, 3]);
    await expect(run((tx) => runImport(tx, clinic.clinicId, { fileName: "bad.csv", csv, idempotencyKey: randomUUID() }, adminId, today))).rejects.toThrow(/Nothing was imported/);
    expect(await patientCount()).toBe(before);
  });

  it("refuses rows that match existing patients", async () => {
    const csv = [header, "Agreed,Msg,female,,40,9845000001,no,no"].join("\n");
    const report = await run((tx) => dryRun(tx, csv, today));
    expect(report.problems[0].message).toMatch(/Likely already registered as P-/);
  });

  it("imports a clean file once, with ages dated today and consents recorded", async () => {
    const before = await patientCount();
    const csv = [header, "Kiran,Patel,male,,45,9845011111,yes,no", "Leela,Shah,female,02/01/1990,,9845022222,no,yes"].join("\r\n");
    const key = randomUUID();
    const first = await run((tx) => runImport(tx, clinic.clinicId, { fileName: "register.csv", csv, idempotencyKey: key }, adminId, today));
    const retry = await run((tx) => runImport(tx, clinic.clinicId, { fileName: "register.csv", csv, idempotencyKey: key }, adminId, today));
    expect(first.result.imported).toBe(2);
    expect(retry.replayed).toBe(true);
    expect(await patientCount()).toBe(before + 2);

    const [kiran] = await owner`select id, stated_age_years, stated_age_on::text as on, mrn from app.patients where clinic_id = ${clinic.clinicId} and first_name = 'Kiran'`;
    expect(kiran).toMatchObject({ stated_age_years: 45, on: today });
    expect(kiran.mrn).toMatch(/^P-\d{6}$/);
    const [leela] = await owner`select date_of_birth::text as dob from app.patients where clinic_id = ${clinic.clinicId} and first_name = 'Leela'`;
    expect(leela.dob).toBe("1990-01-02");
    const consents = await owner`select type, granted, source from app.consent_events where patient_id = ${kiran.id}`;
    expect(consents).toEqual([{ type: "whatsapp_reminders", granted: true, source: "import" }]);
  });
});
