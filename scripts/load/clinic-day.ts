// Load test: a busy clinic day, end to end, against a throwaway database.
//
//   npm run load:clinic-day -- [patients=400] [concurrency=16]
//
// Creates database "medflow_load" (dropped first), onboards one clinic with
// 8 doctors, 4 nurses and a receptionist, then pushes every patient through
// register -> walk-in -> triage + vitals -> hand over -> call -> notes ->
// diagnosis -> prescription -> sign -> invoice + payment, with N patients in
// flight at once and staff screens polling the queue the whole time.
// Prints p50 / p95 / max per step and overall throughput.
import dotenv from "dotenv";
import postgres from "postgres";

dotenv.config({ path: [".env.local", ".env"], quiet: true });

const DB = "medflow_load";
const PATIENTS = Number(process.argv[2] ?? 400);
const CONCURRENCY = Number(process.argv[3] ?? 16);
const TZ = "Asia/Kolkata";

function withDatabase(url: string, database: string) {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

function need(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be set`);
  return value;
}

const timings = new Map<string, number[]>();
async function timed<T>(step: string, fn: () => Promise<T>): Promise<T> {
  const started = performance.now();
  try {
    return await fn();
  } finally {
    const list = timings.get(step) ?? [];
    list.push(performance.now() - started);
    timings.set(step, list);
  }
}

function percentile(sorted: number[], p: number) {
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

async function main() {
  const ownerBase = need("DATABASE_OWNER_URL");
  const admin = postgres(withDatabase(ownerBase, "postgres"), { max: 1, onnotice: () => {} });
  await admin.unsafe(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
  await admin.unsafe(`CREATE DATABASE ${DB}`);
  await admin.end();

  process.env.DATABASE_OWNER_URL = withDatabase(ownerBase, DB);
  process.env.DATABASE_URL = withDatabase(need("DATABASE_URL"), DB);
  process.env.PLATFORM_DATABASE_URL = withDatabase(need("PLATFORM_DATABASE_URL"), DB);
  process.env.PROVISIONER_DATABASE_URL = withDatabase(need("PROVISIONER_DATABASE_URL"), DB);
  process.env.DATABASE_POOL_MAX = String(Math.max(10, CONCURRENCY + 6));

  const { ensureRoles, runMigrations } = await import("../db/tasks");
  const owner = postgres(process.env.DATABASE_OWNER_URL, { max: 1, onnotice: () => {} });
  await ensureRoles(owner);
  await runMigrations(owner);

  const { withClinic, withProvisioner } = await import("../../lib/db");
  const { onboardClinic } = await import("../../features/platform/onboarding.service");
  const { createStaff } = await import("../../features/staff/staff.service");
  const { createService } = await import("../../features/scheduling/services.service");
  const { registerPatient } = await import("../../features/patients/patients.service");
  const { addWalkIn } = await import("../../features/scheduling/booking.service");
  const enc = await import("../../features/clinical/encounters.service");
  const { recordVitals } = await import("../../features/clinical/vitals.service");
  const { addDiagnosis } = await import("../../features/clinical/diagnoses.service");
  const { addPrescriptionItem } = await import("../../features/clinical/prescriptions.service");
  const billing = await import("../../features/billing/billing.service");
  const { todayInTimeZone } = await import("../../lib/time");

  const today = todayInTimeZone(TZ);
  const onboarded = await withProvisioner((tx) =>
    onboardClinic(
      tx,
      { name: "Load Test Clinic", code: `load-${Date.now().toString(36)}`, planId: null, timezone: TZ, admin: { firstName: "Load", lastName: "Admin", email: "admin@load.test" } },
      "00000000-0000-4000-8000-0000000000aa",
      { ipAddress: null, userAgent: "load-test" },
    ),
  );
  const clinicId = onboarded.clinicId;
  const [adminRow] = await owner`select id from app.users where clinic_id = ${clinicId}`;
  const adminId = adminRow.id as string;
  const as = (userId: string) => <T,>(fn: Parameters<typeof withClinic<T>>[1]) => withClinic({ clinicId, userId }, fn);

  const staff = async (n: number, role: string) => {
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      const s = await as(adminId)((tx) =>
        createStaff(tx, clinicId, { firstName: `${role}${i}`, lastName: "Load", email: `${role}${i}@load.test`, roleKeys: [role], registrationNumber: role === "doctor" ? `REG-${i}` : undefined }, adminId),
      );
      ids.push(s.id);
    }
    return ids;
  };
  const doctors = await staff(8, "doctor");
  const nurses = await staff(4, "nurse");
  const serviceId = (await as(adminId)((tx) => createService(tx, clinicId, { name: "Consult", durationMinutes: 15, price: 400, isActive: true }))).id;
  const [paracetamol] = await owner`select id from app.drugs where clinic_id = ${clinicId} and name = 'Paracetamol 650'`;

  // Staff screens polling the queue throughout (like auto-refresh every few seconds).
  let polling = true;
  const pollers = Array.from({ length: 6 }, async (_, i) => {
    while (polling) {
      await timed("queue read (poll)", () => as(doctors[i % doctors.length])((tx) => enc.listClinicalQueue(tx, today)));
      await new Promise((r) => setTimeout(r, 250));
    }
  });

  let next = 0;
  let failures = 0;
  const errors = new Map<string, number>();
  const journey = async (n: number) => {
    const doctorId = doctors[n % doctors.length];
    const nurseId = nurses[n % nurses.length];
    const patient = await timed("register patient", () =>
      as(adminId)((tx) =>
        registerPatient(tx, clinicId, { firstName: `Patient${n}`, lastName: `Load${n % 97}`, sex: n % 2 ? "female" : "male", statedAgeYears: 20 + (n % 60), mobile: `98${String(10_000_000 + n).padStart(8, "0")}` }, { likelyIds: [], actorId: adminId, today }),
      ),
    );
    const visit = await timed("walk-in", () => as(adminId)((tx) => addWalkIn(tx, clinicId, { patientId: patient.id, doctorId, serviceId }, adminId, today)));
    const triage = await timed("start triage", () => as(nurseId)((tx) => enc.startTriage(tx, clinicId, visit.id, today)));
    await timed("record vitals", () => as(nurseId)((tx) => recordVitals(tx, clinicId, triage.encounterId, { temperature_c: 37.2, pulse: 84, systolic: 124, diastolic: 82, spo2: 98 }, undefined, nurseId, today)));
    await timed("hand over", () => as(nurseId)((tx) => enc.handOver(tx, triage.encounterId)));
    await timed("call patient", () => as(doctorId)((tx) => enc.callPatient(tx, clinicId, visit.id, doctorId, today)));
    await timed("open consultation", () => as(doctorId)((tx) => enc.getEncounterCore(tx, triage.encounterId, today)));
    await timed("save notes", () => as(doctorId)((tx) => enc.saveNotes(tx, triage.encounterId, { chiefComplaint: "Fever and cough", plan: "Rest, fluids" }, doctorId)));
    await timed("add diagnosis", () => as(doctorId)((tx) => addDiagnosis(tx, clinicId, triage.encounterId, { code: "J06.9", label: "Acute upper respiratory infection", isPrimary: true }, doctorId)));
    await timed("prescribe (with checks)", () =>
      as(doctorId)((tx) => addPrescriptionItem(tx, clinicId, triage.encounterId, { drugId: paracetamol.id, dose: "1 tablet", frequency: "TDS", durationDays: 3, quantity: null }, doctorId)),
    );
    await timed("sign & finalise", () => as(doctorId)((tx) => enc.finalizeEncounter(tx, triage.encounterId, doctorId, today)));
    const invoice = await timed("create invoice", () => as(adminId)((tx) => billing.createInvoiceForVisit(tx, clinicId, visit.id, adminId)));
    await timed("record payment", () =>
      as(adminId)((tx) => billing.recordPayment(tx, clinicId, { invoiceId: invoice.id, amount: "400.00", method: "upi", idempotencyKey: `load-${n}-${Date.now()}` }, adminId)),
    );
  };

  const started = performance.now();
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (next < PATIENTS) {
        const n = next++;
        try {
          await journey(n);
        } catch (error) {
          failures += 1;
          const key = error instanceof Error ? error.message.split("\n")[0].slice(0, 120) : String(error);
          errors.set(key, (errors.get(key) ?? 0) + 1);
        }
      }
    }),
  );
  const seconds = (performance.now() - started) / 1000;
  polling = false;
  await Promise.all(pollers);

  console.log(`\nNuvaLyf load test: ${PATIENTS} patient journeys, ${CONCURRENCY} in flight, 6 queue pollers`);
  console.log(`Finished in ${seconds.toFixed(1)} s: ${(PATIENTS / seconds).toFixed(1)} complete visits/s, ${failures} failed\n`);
  console.log("step".padEnd(26), "count".padStart(6), "p50 ms".padStart(8), "p95 ms".padStart(8), "max ms".padStart(8));
  for (const [step, list] of timings) {
    const sorted = [...list].sort((a, b) => a - b);
    console.log(step.padEnd(26), String(sorted.length).padStart(6), percentile(sorted, 50).toFixed(0).padStart(8), percentile(sorted, 95).toFixed(0).padStart(8), sorted[sorted.length - 1].toFixed(0).padStart(8));
  }
  for (const [message, count] of errors) console.log(`error x${count}: ${message}`);

  await owner.end();
  process.exit(failures ? 1 : 0);
}

main().catch((error) => {
  console.error("Load test failed:", error instanceof Error ? error.message.split("\n")[0] : error);
  process.exit(1);
});
