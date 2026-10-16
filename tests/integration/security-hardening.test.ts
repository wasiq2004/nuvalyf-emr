// Phase 10 security fixes, against the database.
import { randomUUID } from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { ownerSql } from "./test-db";
import { createTestClinic } from "./fixtures";
import { withClinic } from "@/lib/db";
import { drugs, roles } from "@/lib/db/schema";
import { createStaff } from "@/features/staff/staff.service";
import { setRolePermission } from "@/features/staff/roles.service";
import { registerPatient } from "@/features/patients/patients.service";
import { addWalkIn } from "@/features/scheduling/booking.service";
import { callPatient, finalizeEncounter, saveNotes, takeOverEncounter } from "@/features/clinical/encounters.service";
import { addDiagnosis } from "@/features/clinical/diagnoses.service";
import { addPrescriptionItem } from "@/features/clinical/prescriptions.service";
import { cancelLabOrder, listLabTestOptions, orderLab } from "@/features/clinical/lab.service";
import { receiveStock } from "@/features/pharmacy/stock.service";
import { getPrescriptionForDispensing, sell } from "@/features/pharmacy/sales.service";
import { addDaysToDateString, todayInTimeZone } from "@/lib/time";

const TZ = "Asia/Kolkata";
const owner = ownerSql();
const today = todayInTimeZone(TZ);

let clinic: Awaited<ReturnType<typeof createTestClinic>>;
let adminId: string;
let drA: string;
let drB: string;

const as = (userId: string) => <T,>(fn: Parameters<typeof withClinic<T>>[1]) => withClinic({ clinicId: clinic.clinicId, userId }, fn);

async function consultationFor(doctorId: string, name: string) {
  const p = await as(adminId)((tx) => registerPatient(tx, clinic.clinicId, { firstName: name, sex: "male", statedAgeYears: 40 }, { likelyIds: [], actorId: adminId, today }));
  const visit = await as(adminId)((tx) => addWalkIn(tx, clinic.clinicId, { patientId: p.id, doctorId }, adminId, today));
  return (await as(doctorId)((tx) => callPatient(tx, clinic.clinicId, visit.id, doctorId, today))).encounterId;
}

beforeAll(async () => {
  clinic = await createTestClinic("hardening");
  const [admin] = await owner`select id from app.users where clinic_id = ${clinic.clinicId}`;
  adminId = admin.id;
  const mk = (firstName: string) =>
    as(adminId)((tx) =>
      createStaff(
        tx,
        clinic.clinicId,
        { firstName, lastName: "Doc", email: `${firstName.toLowerCase()}@hardening.test`, roleKeys: ["doctor", "pharmacist"], registrationNumber: `R-${firstName}` },
        adminId,
      ),
    );
  drA = (await mk("Asha")).id;
  drB = (await mk("Bala")).id;
});

afterAll(async () => {
  await owner.end();
});

describe("a consultation belongs to its doctor", () => {
  it("another doctor can read but not write, sign or cancel tests until taking it over", async () => {
    const encounterId = await consultationFor(drA, "Owned");
    await as(drA)((tx) => saveNotes(tx, encounterId, { chiefComplaint: "Cough" }, drA));
    const hb = (await as(drA)((tx) => listLabTestOptions(tx))).find((t) => t.name === "Haemoglobin")!;
    const order = await as(drA)((tx) => orderLab(tx, clinic.clinicId, encounterId, hb.id, undefined, drA));

    await expect(as(drB)((tx) => saveNotes(tx, encounterId, { chiefComplaint: "Overwritten" }, drB))).rejects.toThrow(/another doctor/);
    await expect(as(drB)((tx) => addDiagnosis(tx, clinic.clinicId, encounterId, { code: "J06.9", label: "URTI", isPrimary: true }, drB))).rejects.toThrow(/another doctor/);
    await expect(as(drB)((tx) => finalizeEncounter(tx, encounterId, drB, today))).rejects.toThrow(/another doctor/);
    await expect(as(drB)((tx) => cancelLabOrder(tx, order.id, drB))).rejects.toThrow(/ordering doctor/);
    const [notes] = await owner`select chief_complaint from app.encounters where id = ${encounterId}`;
    expect(notes.chief_complaint).toBe("Cough");

    const taken = await as(drB)((tx) => takeOverEncounter(tx, encounterId, drB));
    expect(taken).toMatchObject({ changed: true, previousDoctorId: drA });
    await as(drB)((tx) => saveNotes(tx, encounterId, { chiefComplaint: "Cough, continued" }, drB));
    await expect(as(drA)((tx) => saveNotes(tx, encounterId, { chiefComplaint: "Back" }, drA))).rejects.toThrow(/another doctor/);
  });
});

describe("dispensing", () => {
  it("never exceeds the prescribed course", async () => {
    const encounterId = await consultationFor(drA, "Course");
    const [para] = await as(adminId)((tx) => tx.update(drugs).set({ price: "2.00" }).where(eq(drugs.name, "Paracetamol 500")).returning({ id: drugs.id }));
    await as(drA)((tx) => addPrescriptionItem(tx, clinic.clinicId, encounterId, { drugId: para.id, dose: "1 tablet", frequency: "TDS", durationDays: 2, quantity: null }, drA));
    const { prescriptionId } = await as(drA)((tx) => finalizeEncounter(tx, encounterId, drA, today));
    const batch = await as(adminId)((tx) =>
      receiveStock(tx, clinic.clinicId, { drugId: para.id, batchNo: "H1", expiryDate: addDaysToDateString(today, 200), quantity: 100, reason: "opening" }, adminId, today),
    );
    const item = (await as(drB)((tx) => getPrescriptionForDispensing(tx, prescriptionId!, today)))!.items[0];
    expect(item.needed).toBe(6);
    const line = (quantity: number) => ({ drugId: para.id, batchId: batch.batchId, quantity, prescriptionItemId: item.id });
    await expect(as(drB)((tx) => sell(tx, clinic.clinicId, { prescriptionId, lines: [line(1000)], method: "cash", idempotencyKey: randomUUID() }, drB, today))).rejects.toThrow(/only 6 left/);
    await as(drB)((tx) => sell(tx, clinic.clinicId, { prescriptionId, lines: [line(4)], method: "cash", idempotencyKey: randomUUID() }, drB, today));
    await expect(as(drB)((tx) => sell(tx, clinic.clinicId, { prescriptionId, lines: [line(3)], method: "cash", idempotencyKey: randomUUID() }, drB, today))).rejects.toThrow(/only 2 left/);
  });
});

describe("roles", () => {
  it("the Analyst role cannot be given anything that shows patients", async () => {
    const [analyst] = await as(adminId)((tx) => tx.select().from(roles).where(eq(roles.key, "analyst")));
    for (const permission of ["queue:read", "appointment:read", "billing:read", "reports:read"]) {
      await expect(as(adminId)((tx) => setRolePermission(tx, clinic.clinicId, { roleId: analyst.id, permission, granted: true }))).rejects.toThrow(/de-identified/);
    }
  });
});
