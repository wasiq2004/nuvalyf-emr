// Phase 9: de-identified analytics. Nothing that leaves the analytics module
// may contain a name, mobile number or record number; pseudonyms do not link
// across cohorts; small numbers are suppressed.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ownerSql } from "./test-db";
import { createTestClinic } from "./fixtures";
import { withClinic } from "@/lib/db";
import { createStaff } from "@/features/staff/staff.service";
import { registerPatient } from "@/features/patients/patients.service";
import { addWalkIn } from "@/features/scheduling/booking.service";
import { callPatient, finalizeEncounter } from "@/features/clinical/encounters.service";
import { addDiagnosis } from "@/features/clinical/diagnoses.service";
import { addPrescriptionItem } from "@/features/clinical/prescriptions.service";
import { cohortDefinitionSchema, monthEnd, monthStart } from "@/features/analytics/analytics-rules";
import { createCohort, dataQuality, exportCohort, minCell, overview, runCohort, updateCohort } from "@/features/analytics/analytics.service";
import { todayInTimeZone } from "@/lib/time";
import { csvCell } from "@/features/audit/audit-rules";

const TZ = "Asia/Kolkata";
const owner = ownerSql();
const today = todayInTimeZone(TZ);

let clinic: Awaited<ReturnType<typeof createTestClinic>>;
let adminId: string;
let doctorId: string;
let analystId: string;
const identifiers: string[] = [];

const as = (userId: string) => <T,>(fn: Parameters<typeof withClinic<T>>[1]) => withClinic({ clinicId: clinic.clinicId, userId }, fn);

async function seenWith(firstName: string, mobile: string, age: number, code: string, label: string, drug?: string) {
  const asAdmin = as(adminId);
  const asDoctor = as(doctorId);
  const p = await asAdmin((tx) => registerPatient(tx, clinic.clinicId, { firstName, lastName: "Analytic", sex: "female", statedAgeYears: age, mobile }, { likelyIds: [], actorId: adminId, today }));
  identifiers.push(firstName, mobile, p.mrn);
  const visit = await asAdmin((tx) => addWalkIn(tx, clinic.clinicId, { patientId: p.id, doctorId }, adminId, today));
  const { encounterId } = await asDoctor((tx) => callPatient(tx, clinic.clinicId, visit.id, doctorId, today));
  await asDoctor((tx) => addDiagnosis(tx, clinic.clinicId, encounterId, { code, label, isPrimary: true }, doctorId));
  if (drug) {
    const [d] = await owner`select id from app.drugs where clinic_id = ${clinic.clinicId} and name = ${drug}`;
    await asDoctor((tx) => addPrescriptionItem(tx, clinic.clinicId, encounterId, { drugId: d.id, dose: "1 tablet", frequency: "BD", durationDays: 30, quantity: 60 }, doctorId));
  }
  await asDoctor((tx) => finalizeEncounter(tx, encounterId, doctorId, today));
  return p.id;
}

function expectNoIdentifiers(value: unknown) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  for (const id of identifiers) expect(text, `leaked "${id}"`).not.toContain(id);
  // No 10-digit numbers either (mobiles in any format).
  expect(text).not.toMatch(/(?<!\d)\d{10}(?!\d)/);
}

beforeAll(async () => {
  clinic = await createTestClinic("analytics");
  const [admin] = await owner`select id from app.users where clinic_id = ${clinic.clinicId}`;
  adminId = admin.id;
  const mk = (firstName: string, roleKeys: string[], registrationNumber?: string) =>
    as(adminId)((tx) => createStaff(tx, clinic.clinicId, { firstName, lastName: "Staff", email: `${firstName.toLowerCase()}@analytics.test`, roleKeys, registrationNumber }, adminId));
  doctorId = (await mk("Dhruv", ["doctor"], "REG-A1")).id;
  analystId = (await mk("Anya", ["analyst"])).id;

  const names = ["Aarti", "Bhavna", "Chitra", "Deepa", "Esha", "Farah"];
  for (const [i, name] of names.entries()) {
    await seenWith(name, `98451000${String(i).padStart(2, "0")}`, 50 + i, "E11.9", "Type 2 diabetes mellitus without complications", "Metformin 500");
  }
  await seenWith("Gita", "9845100090", 61, "I10", "Essential (primary) hypertension");
  await seenWith("Hema", "9845100091", 47, "I10", "Essential (primary) hypertension");
});

afterAll(async () => {
  await owner.end();
});

const window = () => ({ from: monthStart(today), to: monthEnd(today) });

describe("analytics", () => {
  it("overview and data quality return counts and bands only, with small cells hidden", async () => {
    const threshold = await as(analystId)((tx) => minCell(tx, clinic.clinicId));
    expect(threshold).toBe(5);
    const data = await as(analystId)((tx) => overview(tx, today, threshold));
    expectNoIdentifiers(data);
    expect(data.patients).toBe(8);
    const diabetes = data.topDiagnoses.rows.find((d) => d.code === "E11.9");
    const hypertension = data.topDiagnoses.rows.find((d) => d.code === "I10");
    expect(diabetes?.count).toBe(6);
    expect(hypertension?.count).toBeNull(); // 2 patients: hidden
    expect(data.topDiagnoses.suppressed).toBe(1);

    const quality = await as(analystId)((tx) => dataQuality(tx));
    expectNoIdentifiers(quality);
    expect(quality.consultations.finalized).toBe(8);
    expect(quality.patients.noDob).toBe(8);
  });

  it("gives the same patients unrelated pseudonyms in two cohorts", async () => {
    const definition = cohortDefinitionSchema.parse({ ...window(), diagnosisPrefixes: ["E11"] });
    const a = await as(analystId)((tx) => createCohort(tx, clinic.clinicId, { name: "Diabetes A", purpose: "Quarterly review of diabetic control", definition }, analystId));
    const b = await as(analystId)((tx) => createCohort(tx, clinic.clinicId, { name: "Diabetes B", purpose: "Second, independent study of the same group", definition }, analystId));
    const runA = await as(analystId)((tx) => runCohort(tx, clinic.clinicId, a.id, analystId, 5));
    const runB = await as(analystId)((tx) => runCohort(tx, clinic.clinicId, b.id, analystId, 5));
    expect(runA.size).toBe(6);
    expect(runA.rows).toHaveLength(6);
    expectNoIdentifiers(runA);
    expect(runA.rows.every((r) => r.medicineGenerics.includes("metformin") && r.diagnosisCodes.includes("E11.9"))).toBe(true);

    const keysA = new Set(runA.rows.map((r) => r.pseudonym));
    expect(runB.rows.filter((r) => keysA.has(r.pseudonym))).toHaveLength(0);
    // ...but stable inside one cohort.
    const again = await as(analystId)((tx) => runCohort(tx, clinic.clinicId, a.id, analystId, 5));
    expect(again.rows.map((r) => r.pseudonym)).toEqual(runA.rows.map((r) => r.pseudonym));
  });

  it("suppresses small cohorts and refuses to export them", async () => {
    const definition = cohortDefinitionSchema.parse({ ...window(), diagnosisPrefixes: ["I10"] });
    const small = await as(analystId)((tx) => createCohort(tx, clinic.clinicId, { name: "Hypertension", purpose: "Look at hypertensive patients seen recently", definition }, analystId));
    const run = await as(analystId)((tx) => runCohort(tx, clinic.clinicId, small.id, analystId, 5));
    expect(run.size).toBeNull();
    expect(run.rows).toEqual([]);
    await expect(as(analystId)((tx) => exportCohort(tx, clinic.clinicId, small.id, analystId, 5, new Date()))).rejects.toThrow(/cannot be exported/);
    // The recorded run keeps the true size for the record; the screen shows it suppressed.
    const [row] = await owner`select size from app.cohort_runs where cohort_id = ${small.id}`;
    expect(row.size).toBe(2);
  });

  it("exports with definition, version and columns, and versions definition changes", async () => {
    const definition = cohortDefinitionSchema.parse({ ...window(), drugGenerics: ["metformin"] });
    const cohort = await as(analystId)((tx) => createCohort(tx, clinic.clinicId, { name: "Metformin users", purpose: "Check metformin prescribing patterns", definition }, analystId));
    const file = await as(analystId)((tx) => exportCohort(tx, clinic.clinicId, cohort.id, analystId, 5, new Date()));
    expectNoIdentifiers(file.csv);
    expect(file.csv).toContain("# version: 1");
    expect(file.csv).toContain(csvCell(`# definition: ${JSON.stringify(definition)}`));
    expect(file.csv).toContain("pseudonym,age_band,sex,visits_in_window,diagnosis_codes,medicine_generics");
    expect(file.rows).toBe(6);
    const [exported] = await owner`select version, columns, row_count from app.analytics_exports where cohort_id = ${cohort.id}`;
    expect(exported).toMatchObject({ version: 1, row_count: 6 });

    expect(await as(analystId)((tx) => updateCohort(tx, cohort.id, { name: "Metformin users", purpose: "Check metformin prescribing patterns", definition }))).toEqual({ version: 1 });
    const narrower = cohortDefinitionSchema.parse({ ...definition, ageMin: 55 });
    expect(await as(analystId)((tx) => updateCohort(tx, cohort.id, { name: "Metformin 53+", purpose: "Check metformin prescribing patterns", definition: narrower }))).toEqual({ version: 2 });
    await expect(owner`update app.analytics_exports set row_count = 0 where cohort_id = ${cohort.id}`).rejects.toThrow(/append-only/);
    await expect(owner`delete from app.cohort_runs where cohort_id = ${cohort.id}`).rejects.toThrow(/append-only/);
  });

  it("uses the clinic's threshold, never below the platform minimum", async () => {
    await owner`update app.clinic_settings set analytics_min_cell = 3 where clinic_id = ${clinic.clinicId}`;
    expect(await as(analystId)((tx) => minCell(tx, clinic.clinicId))).toBe(3);
    await expect(owner`update app.clinic_settings set analytics_min_cell = 2 where clinic_id = ${clinic.clinicId}`).rejects.toThrow(/min_cell/);
  });
});
