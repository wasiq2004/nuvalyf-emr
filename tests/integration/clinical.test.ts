// Phase 4: triage, consultation, prescribing, signing, immutability, lab,
// and the clinic-owned catalogues.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { PDFDocument } from "pdf-lib";
import { ownerSql } from "./test-db";
import { createTestClinic } from "./fixtures";
import { withClinic } from "@/lib/db";
import { AppError, isLockedRecord, pgError } from "@/lib/errors";
import { allergyClasses, drugs, drugInteractions, encounters, labTests, prescriptions, visits } from "@/lib/db/schema";
import { createStaff } from "@/features/staff/staff.service";
import { registerPatient, updatePatientContact } from "@/features/patients/patients.service";
import { SYSTEM_ROLES } from "@/lib/access/roles";
import { addWalkIn } from "@/features/scheduling/booking.service";
import { importStarterCatalog, missingStarterCounts } from "@/lib/catalog/seed";
import {
  addAmendment,
  callNext,
  callPatient,
  finalizeEncounter,
  getEncounterCore,
  getPrivateNote,
  handOver,
  listClinicalQueue,
  saveNotes,
  savePrivateNote,
  saveTriageNotes,
  startTriage,
  takeOverEncounter,
} from "@/features/clinical/encounters.service";
import { recordVitals } from "@/features/clinical/vitals.service";
import { frequentDiagnoses, frequentMedicines, lastPrescription, medicinesForDiagnoses, repeatPrescription } from "@/features/clinical/suggestions.service";
import { addAllergy, correctAllergy, listAllergyHistory, recordNoKnownAllergies } from "@/features/clinical/allergies.service";
import { addDiagnosis, searchDiagnosisCodes } from "@/features/clinical/diagnoses.service";
import { addPrescriptionItem, getDraftPrescription, getSignedPrescription, searchDrugs, warningsFor } from "@/features/clinical/prescriptions.service";
import { cancelLabOrder, entryFieldsFor, labOrderDetail, labReport, listLabTestOptions, listUnreadResults, markResultRead, orderLab, patientLabHistory, saveLabResult } from "@/features/clinical/lab.service";
import { addLabDocument, labDocumentContents, labDocumentForViewing, listOrderDocuments, listPatientDocuments, removeLabDocument } from "@/features/clinical/lab-documents.service";
import { renderLabReportPdf } from "@/lib/pdf/lab-report-pdf";
import { appendDocuments } from "@/lib/pdf/attachments";
import { createDrug, deleteLabRange, getLabTestWithParameters, saveLabParameter, saveLabRange, saveVitalRange, setEntryActive } from "@/features/catalog/catalog.service";
import { todayInTimeZone } from "@/lib/time";

const TZ = "Asia/Kolkata";
const owner = ownerSql();
const today = todayInTimeZone(TZ);

let clinic: Awaited<ReturnType<typeof createTestClinic>>;
let adminId: string;
let doctorId: string;
let unregisteredDoctorId: string;
let nurseId: string;
let labId: string;

const as = (userId: string) => <T,>(fn: Parameters<typeof withClinic<T>>[1]) => withClinic({ clinicId: clinic.clinicId, userId }, fn);
const asAdmin = () => as(adminId);
const asDoctor = () => as(doctorId);
const asNurse = () => as(nurseId);
const asLab = () => as(labId);

async function newPatient(firstName: string, age = 40) {
  return asAdmin()((tx) =>
    registerPatient(tx, clinic.clinicId, { firstName, lastName: "Test", sex: "female", statedAgeYears: age }, { likelyIds: [], actorId: adminId, today }),
  );
}

async function walkIn(patientId: string, doctor: string | null = null) {
  return asAdmin()((tx) => addWalkIn(tx, clinic.clinicId, { patientId, doctorId: doctor }, adminId, today));
}

/** A patient called straight in by the doctor: returns the encounter id. */
async function consultation(name: string, age = 40) {
  const patient = await newPatient(name, age);
  const visit = await walkIn(patient.id, doctorId);
  const called = await asDoctor()((tx) => callPatient(tx, clinic.clinicId, visit.id, doctorId, today));
  return { patientId: patient.id, visitId: visit.id, encounterId: called.encounterId };
}

async function drugId(name: string) {
  const [row] = await asAdmin()((tx) => tx.select({ id: drugs.id }).from(drugs).where(eq(drugs.name, name)).limit(1));
  return row.id;
}

async function expectLocked(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error, "expected the database guard to refuse").not.toBeNull();
  expect(isLockedRecord(error), String((error as Error)?.message) + " / " + JSON.stringify(pgError(error))).toBe(true);
}

beforeAll(async () => {
  clinic = await createTestClinic("clinical");
  const [admin] = await owner`select id from app.users where clinic_id = ${clinic.clinicId}`;
  adminId = admin.id;
  const mk = (firstName: string, roleKeys: string[], registrationNumber?: string) =>
    asAdmin()((tx) =>
      createStaff(tx, clinic.clinicId, { firstName, lastName: "Staff", email: `${firstName.toLowerCase()}@clinical.test`, roleKeys, registrationNumber }, adminId),
    );
  doctorId = (await mk("Meena", ["doctor"], "KMC-12345")).id;
  unregisteredDoctorId = (await mk("Ravi", ["doctor"])).id;
  nurseId = (await mk("Asha", ["nurse"])).id;
  labId = (await mk("Lalit", ["lab_tech"])).id;
});

afterAll(async () => {
  await owner.end();
});

describe("starter catalogue (D6: every clinic owns an editable copy)", () => {
  it("is copied in at onboarding", async () => {
    const missing = await asAdmin()((tx) => missingStarterCounts(tx, clinic.clinicId));
    expect(Object.values(missing).every((n) => n === 0)).toBe(true);
    const found = await asDoctor()((tx) => searchDrugs(tx, "paracetamol"));
    expect(found.length).toBeGreaterThanOrEqual(2);
    const favourites = await asDoctor()((tx) => searchDiagnosisCodes(tx, ""));
    expect(favourites.some((d) => d.code === "J06.9")).toBe(true);
  });

  it("re-importing never revives what the clinic deactivated, and offers only what is missing", async () => {
    const id = await drugId("Tramadol 50");
    await asAdmin()((tx) => setEntryActive(tx, "drug", id, false));
    await owner`delete from app.drug_interactions where clinic_id = ${clinic.clinicId} and starter_key = 'warfarin-aspirin'`;

    const missing = await asAdmin()((tx) => missingStarterCounts(tx, clinic.clinicId));
    expect(missing.interactions).toBe(1);
    expect(missing.drugs).toBe(0);

    const added = await asAdmin()((tx) => importStarterCatalog(tx, clinic.clinicId));
    expect(added.interactions).toBe(1);
    expect(added.drugs).toBe(0);
    const [tramadol] = await asAdmin()((tx) => tx.select().from(drugs).where(eq(drugs.id, id)));
    expect(tramadol.isActive).toBe(false);
    expect(await asDoctor()((tx) => searchDrugs(tx, "tramadol"))).toHaveLength(0);
  });

  it("validates vital ranges", async () => {
    await expect(
      asAdmin()((tx) => saveVitalRange(tx, clinic.clinicId, null, { vital: "pulse", ageMinYears: 0, ageMaxYears: 150, low: 100, high: 60, criticalLow: null, criticalHigh: null })),
    ).rejects.toThrow(AppError);
  });

  it("is invisible to another clinic", async () => {
    const other = await createTestClinic("other");
    const [otherAdmin] = await owner`select id from app.users where clinic_id = ${other.clinicId}`;
    await asAdmin()((tx) => createDrug(tx, clinic.clinicId, { name: "House Tonic", genericName: "Tonic", form: "syrup", defaultDurationDays: null, allergyClassIds: [] }));
    const seen = await withClinic({ clinicId: other.clinicId, userId: otherAdmin.id }, (tx) => searchDrugs(tx, "house tonic"));
    expect(seen).toHaveLength(0);
  });
});

describe("triage → doctor", () => {
  it("runs nurse pick-up, vitals with server flags, hand-over and call-next", async () => {
    const patient = await newPatient("Triage", 45);
    const visit = await walkIn(patient.id);

    const triage = await asNurse()((tx) => startTriage(tx, clinic.clinicId, visit.id, today));
    await expect(asNurse()((tx) => startTriage(tx, clinic.clinicId, visit.id, today))).rejects.toThrow(AppError);

    const vitals = await asNurse()((tx) =>
      recordVitals(tx, clinic.clinicId, triage.encounterId, { temperature_c: 38.4, pulse: 132, spo2: 97, systolic: 128, diastolic: 84 }, undefined, nurseId, today),
    );
    expect(vitals.flags).toEqual({ temperature_c: "high", pulse: "critical_high" });

    await asNurse()((tx) => handOver(tx, triage.encounterId));
    const [ready] = await owner`select status, ready_at from app.visits where id = ${visit.id}`;
    expect(ready.status).toBe("ready");

    const called = await asDoctor()((tx) => callNext(tx, clinic.clinicId, doctorId, today));
    expect(called.visitId).toBe(visit.id);
    expect(called.encounterId).toBe(triage.encounterId);
    const [withDoctor] = await owner`select status, called_at, doctor_id from app.visits where id = ${visit.id}`;
    expect(withDoctor.status).toBe("with_doctor");
    expect(withDoctor.called_at).not.toBeNull();
    expect(withDoctor.doctor_id).toBe(doctorId);
  });

  it("flags vitals by age band", async () => {
    const child = await consultation("Child", 4);
    const adult = await consultation("Adult", 30);
    const childFlags = await asNurse()((tx) => recordVitals(tx, clinic.clinicId, child.encounterId, { pulse: 120, resp_rate: 30 }, undefined, nurseId, today));
    const adultFlags = await asNurse()((tx) => recordVitals(tx, clinic.clinicId, adult.encounterId, { pulse: 120, resp_rate: 30 }, undefined, nurseId, today));
    expect(childFlags.flags).toEqual({});
    expect(adultFlags.flags).toEqual({ pulse: "high", resp_rate: "critical_high" });
  });

  it("does not let a doctor take another doctor's patient", async () => {
    const patient = await newPatient("Booked", 50);
    const visit = await walkIn(patient.id, doctorId);
    await expect(asDoctor()((tx) => callPatient(tx, clinic.clinicId, visit.id, unregisteredDoctorId, today))).rejects.toThrow(/another doctor/);
  });
});

describe("nurse updates for the doctor", () => {
  it("shows the doctor the latest vitals, who took them and when, before calling the patient", async () => {
    const p = await newPatient("Vani");
    const visit = await walkIn(p.id);
    const { encounterId } = await asNurse()((tx) => startTriage(tx, clinic.clinicId, visit.id, today));
    let row = (await asDoctor()((tx) => listClinicalQueue(tx, today))).find((q) => q.id === visit.id)!;
    expect(row.latestVitals).toBeNull();

    await asNurse()((tx) => recordVitals(tx, clinic.clinicId, encounterId, { systolic: 120, diastolic: 80 }, undefined, nurseId, today));
    await asNurse()((tx) => recordVitals(tx, clinic.clinicId, encounterId, { systolic: 150, diastolic: 95, pulse: 90 }, "Repeat after rest", nurseId, today));
    await asNurse()((tx) => saveTriageNotes(tx, encounterId, { chiefComplaint: "Headache since morning", nursingNotes: "Looks anxious" }, nurseId));

    row = (await asDoctor()((tx) => listClinicalQueue(tx, today))).find((q) => q.id === visit.id)!;
    expect(row.chiefComplaint).toBe("Headache since morning");
    expect(row.latestVitals?.values).toMatchObject({ systolic: 150, diastolic: 95, pulse: 90 });
    expect(row.latestVitals?.recordedByName).toContain("Asha");
    expect(row.latestVitals?.recordedAt).toBeInstanceOf(Date);
    const core = await asDoctor()((tx) => getEncounterCore(tx, encounterId, today));
    expect(core).toMatchObject({ triageNotesByName: expect.stringContaining("Asha") });
    expect(core?.encounter.nursingNotes).toBe("Looks anxious");
  });

  it("never reaches the doctor's own notes, and stops once the consultation is signed", async () => {
    const { encounterId } = await consultation("Tara");
    await asDoctor()((tx) => saveNotes(tx, encounterId, { chiefComplaint: "Cough", history: "Three days", plan: "Rest" }, doctorId));
    await asNurse()((tx) => saveTriageNotes(tx, encounterId, { chiefComplaint: "Dry cough", nursingNotes: "Afebrile" }, nurseId));
    const [row] = await owner`select chief_complaint, history, plan, nursing_notes from app.encounters where id = ${encounterId}`;
    expect(row).toEqual({ chief_complaint: "Dry cough", history: "Three days", plan: "Rest", nursing_notes: "Afebrile" });
    // Writing the doctor's notes and prescribing stay refused for a nurse at the action layer.
    const nurse: readonly string[] = SYSTEM_ROLES.nurse.permissions;
    for (const denied of ["encounter:write", "prescription:sign", "patient:write"]) expect(nurse).not.toContain(denied);
    for (const allowed of ["encounter:read", "patient:contact", "vitals:write"]) expect(nurse).toContain(allowed);
    await asDoctor()((tx) => finalizeEncounter(tx, encounterId, doctorId, today));
    await expect(asNurse()((tx) => saveTriageNotes(tx, encounterId, { chiefComplaint: "x" }, nurseId))).rejects.toThrow(/finalised/);
  });

  it("updates contact details only", async () => {
    const p = await newPatient("Gita");
    await asNurse()((tx) => updatePatientContact(tx, p.id, { mobile: "9876543210", city: "Madurai" }));
    const [row] = await owner`select first_name, mobile, city from app.patients where id = ${p.id}`;
    expect(row).toEqual({ first_name: "Gita", mobile: "9876543210", city: "Madurai" });
  });
});

describe("suggestions for the doctor", () => {
  const prescribeAndSign = async (patientName: string, drugName: string, code: string) => {
    const { encounterId } = await consultation(patientName);
    const id = await drugId(drugName);
    await asDoctor()((tx) => addDiagnosis(tx, clinic.clinicId, encounterId, { code, label: "Test diagnosis", isPrimary: true }, doctorId));
    await asDoctor()((tx) => addPrescriptionItem(tx, clinic.clinicId, encounterId, { drugId: id, dose: "1 tablet", frequency: "HS", durationDays: 7, quantity: null }, doctorId));
    await asDoctor()((tx) => finalizeEncounter(tx, encounterId, doctorId, today));
  };

  it("learn this doctor's usual medicine, dose and diagnosis, and what goes with a diagnosis", async () => {
    await prescribeAndSign("Sug One", "Cetirizine 10", "T78.4");
    await prescribeAndSign("Sug Two", "Cetirizine 10", "T78.4");
    await prescribeAndSign("Sug Three", "Cetirizine 10", "T78.4");
    const frequent = await asDoctor()((tx) => frequentMedicines(tx, doctorId));
    expect(frequent[0]).toMatchObject({ name: "Cetirizine 10", defaultDose: "1 tablet", defaultFrequency: "HS", defaultDurationDays: 7 });
    expect(frequent[0].timesUsed).toBeGreaterThanOrEqual(3);
    const withDiagnosis = await asDoctor()((tx) => medicinesForDiagnoses(tx, doctorId, ["T78.4"]));
    expect(withDiagnosis.map((m) => m.name)).toContain("Cetirizine 10");
    expect(await asDoctor()((tx) => medicinesForDiagnoses(tx, doctorId, ["Z99.9"]))).toEqual([]);
    expect((await asDoctor()((tx) => frequentDiagnoses(tx, doctorId))).map((d) => d.code)).toContain("T78.4");
  });

  it("repeat the last prescription, leaving out what now has a serious warning", async () => {
    const p = await newPatient("Repeat");
    const first = await asAdmin()((tx) => addWalkIn(tx, clinic.clinicId, { patientId: p.id, doctorId }, adminId, today));
    const { encounterId: firstEncounter } = await asDoctor()((tx) => callPatient(tx, clinic.clinicId, first.id, doctorId, today));
    for (const name of ["Cetirizine 10", "Amoxicillin 500"]) {
      const id = await drugId(name);
      await asDoctor()((tx) => addPrescriptionItem(tx, clinic.clinicId, firstEncounter, { drugId: id, dose: "1 tablet", frequency: "BD", durationDays: 5, quantity: null }, doctorId));
    }
    await asDoctor()((tx) => finalizeEncounter(tx, firstEncounter, doctorId, today));
    const [penicillins] = await asAdmin()((tx) => tx.select().from(allergyClasses).where(eq(allergyClasses.name, "Penicillins")));
    await asNurse()((tx) => addAllergy(tx, clinic.clinicId, p.id, { substance: "Penicillin", allergyClassId: penicillins.id, severity: "severe" }, nurseId));

    const second = await asAdmin()((tx) => addWalkIn(tx, clinic.clinicId, { patientId: p.id, doctorId }, adminId, today));
    const { encounterId } = await asDoctor()((tx) => callPatient(tx, clinic.clinicId, second.id, doctorId, today));
    const last = await asDoctor()((tx) => lastPrescription(tx, p.id, encounterId));
    expect(last?.items.map((i) => i.drugName).sort()).toEqual(["Amoxicillin 500", "Cetirizine 10"]);
    const result = await asDoctor()((tx) => repeatPrescription(tx, clinic.clinicId, encounterId, last!.id, doctorId));
    expect(result).toMatchObject({ added: ["Cetirizine 10"], skipped: ["Amoxicillin 500"] });
    const again = await asDoctor()((tx) => repeatPrescription(tx, clinic.clinicId, encounterId, last!.id, doctorId));
    expect(again.added).toEqual([]);
    const draft = await asDoctor()((tx) => getDraftPrescription(tx, encounterId));
    expect(draft?.items.map((i) => i.drugName)).toEqual(["Cetirizine 10"]);
    await expect(asDoctor()((tx) => repeatPrescription(tx, clinic.clinicId, encounterId, draft!.id, doctorId))).rejects.toThrow(/cannot be repeated/);
  });
});

describe("allergies", () => {
  it("are add-only with reasoned corrections, and never deleted", async () => {
    const { patientId } = await consultation("Allergic");
    const [penicillins] = await asAdmin()((tx) => tx.select().from(allergyClasses).where(eq(allergyClasses.name, "Penicillins")));

    const allergy = await asNurse()((tx) =>
      addAllergy(tx, clinic.clinicId, patientId, { substance: "Penicillin", allergyClassId: penicillins.id, severity: "severe", reaction: "Hives" }, nurseId),
    );
    await expect(
      asNurse()((tx) => addAllergy(tx, clinic.clinicId, patientId, { substance: "penicillin", allergyClassId: null, severity: "mild" }, nurseId)),
    ).rejects.toThrow(/already recorded/);
    await expect(asNurse()((tx) => recordNoKnownAllergies(tx, patientId, nurseId))).rejects.toThrow(AppError);

    await asDoctor()((tx) => correctAllergy(tx, clinic.clinicId, allergy.id, { severity: "moderate", status: "active", reaction: "Hives" }, "Clarified with patient", doctorId));
    const history = await asDoctor()((tx) => listAllergyHistory(tx, allergy.id));
    expect(history).toHaveLength(1);
    expect(history[0].reason).toBe("Clarified with patient");
    expect((history[0].previous as { severity: string }).severity).toBe("severe");

    await expect(owner`delete from app.allergies where id = ${allergy.id}`).rejects.toThrow();
    await expect(owner`update app.allergy_history set reason = 'x' where allergy_id = ${allergy.id}`).rejects.toThrow();
  });

  it("records 'no known allergies' and a later allergy replaces it", async () => {
    const { patientId } = await consultation("Nka");
    await asNurse()((tx) => recordNoKnownAllergies(tx, patientId, nurseId));
    let [p] = await owner`select no_known_allergies_at from app.patients where id = ${patientId}`;
    expect(p.no_known_allergies_at).not.toBeNull();
    await asNurse()((tx) => addAllergy(tx, clinic.clinicId, patientId, { substance: "Peanuts", allergyClassId: null, severity: "severe" }, nurseId));
    [p] = await owner`select no_known_allergies_at from app.patients where id = ${patientId}`;
    expect(p.no_known_allergies_at).toBeNull();
  });
});

describe("prescribing", () => {
  it("warns about class allergies and interactions, and needs a reason to override", async () => {
    const { patientId, encounterId } = await consultation("Rx");
    const [penicillins] = await asAdmin()((tx) => tx.select().from(allergyClasses).where(eq(allergyClasses.name, "Penicillins")));
    await asNurse()((tx) => addAllergy(tx, clinic.clinicId, patientId, { substance: "Penicillin", allergyClassId: penicillins.id, severity: "severe" }, nurseId));

    const amoxiclav = await drugId("Amoxicillin + Clavulanate 625");
    const check = await asDoctor()((tx) => warningsFor(tx, encounterId, amoxiclav));
    expect(check.warnings[0]).toMatchObject({ kind: "allergy", severity: "allergy" });

    const item = { dose: "1 tablet", frequency: "BD", durationDays: 5, quantity: null };
    await expect(asDoctor()((tx) => addPrescriptionItem(tx, clinic.clinicId, encounterId, { drugId: amoxiclav, ...item }, doctorId))).rejects.toThrow(/reason/);

    // A free-text allergy (no class) still matches by generic name.
    await asNurse()((tx) => addAllergy(tx, clinic.clinicId, patientId, { substance: "Aspirin", allergyClassId: null, severity: "mild" }, nurseId));

    const warfarin = await drugId("Warfarin 5");
    await asDoctor()((tx) => addPrescriptionItem(tx, clinic.clinicId, encounterId, { drugId: warfarin, ...item }, doctorId));
    const aspirin = await drugId("Aspirin 75");
    const both = await asDoctor()((tx) => warningsFor(tx, encounterId, aspirin));
    expect(both.warnings.map((w) => w.kind)).toEqual(["allergy", "interaction"]);
    expect(both.warnings[1].severity).toBe("major");

    const added = await asDoctor()((tx) =>
      addPrescriptionItem(tx, clinic.clinicId, encounterId, { drugId: aspirin, ...item, overrideReason: "Cardiology advised; INR monitored" }, doctorId),
    );
    expect(added.overridden).toBe(true);
    const draft = await asDoctor()((tx) => getDraftPrescription(tx, encounterId));
    expect(draft?.items.map((i) => i.drugName)).toEqual(["Warfarin 5", "Aspirin 75"]);
    expect(draft?.items[1].overrideReason).toBe("Cardiology advised; INR monitored");
  });

  it("refuses deactivated medicines even if called directly", async () => {
    const { encounterId } = await consultation("Inactive");
    const tramadol = await drugId("Tramadol 50");
    await expect(
      asDoctor()((tx) => addPrescriptionItem(tx, clinic.clinicId, encounterId, { drugId: tramadol, dose: "1", frequency: "BD", durationDays: 3, quantity: null }, doctorId)),
    ).rejects.toThrow(/deactivated/);
  });
});

describe("sign & finalise", () => {
  it("needs a registration number", async () => {
    const { encounterId } = await consultation("NoReg");
    await as(unregisteredDoctorId)((tx) => takeOverEncounter(tx, encounterId, unregisteredDoctorId));
    await expect(as(unregisteredDoctorId)((tx) => finalizeEncounter(tx, encounterId, unregisteredDoctorId, today))).rejects.toThrow(/registration number/);
  });

  it("signs with a snapshot, completes the visit, and freezes everything", async () => {
    const { visitId, encounterId, patientId } = await consultation("Final");
    await asDoctor()((tx) => saveNotes(tx, encounterId, { chiefComplaint: "Fever", plan: "Fluids, rest" }, doctorId));
    await asDoctor()((tx) => addDiagnosis(tx, clinic.clinicId, encounterId, { code: "r50.9", label: "Fever, unspecified", isPrimary: false }, doctorId));
    const para = await drugId("Paracetamol 650");
    await asDoctor()((tx) => addPrescriptionItem(tx, clinic.clinicId, encounterId, { drugId: para, dose: "1 tablet", frequency: "TDS", durationDays: 3, quantity: 9 }, doctorId));

    const result = await asDoctor()((tx) => finalizeEncounter(tx, encounterId, doctorId, today));
    expect(result.prescriptionId).not.toBeNull();

    const rx = await asDoctor()((tx) => getSignedPrescription(tx, encounterId));
    const snapshot = rx!.signedSnapshot as { prescriber: { registrationNumber: string }; items: { drugName: string }[]; diagnoses: { code: string }[]; advice: string };
    expect(snapshot.prescriber.registrationNumber).toBe("KMC-12345");
    expect(snapshot.items[0].drugName).toBe("Paracetamol 650");
    expect(snapshot.diagnoses[0].code).toBe("R50.9");
    expect(snapshot.advice).toBe("Fluids, rest");
    const [visit] = await owner`select status, completed_at from app.visits where id = ${visitId}`;
    expect(visit.status).toBe("completed");

    // Editing the catalogue later never changes the signed document.
    await asAdmin()((tx) => tx.update(drugs).set({ name: "Paracetamol 650 (renamed)" }).where(eq(drugs.id, para)));
    const again = await asDoctor()((tx) => getSignedPrescription(tx, encounterId));
    expect((again!.signedSnapshot as typeof snapshot).items[0].drugName).toBe("Paracetamol 650");

    // Services refuse...
    await expect(asDoctor()((tx) => saveNotes(tx, encounterId, { plan: "changed" }, doctorId))).rejects.toThrow(AppError);
    await expect(asDoctor()((tx) => finalizeEncounter(tx, encounterId, doctorId, today))).rejects.toThrow(/already finalised/);

    // ...and so does the database, for the app role and the owner alike.
    await expectLocked(asDoctor()((tx) => tx.update(encounters).set({ plan: "tampered" }).where(eq(encounters.id, encounterId))));
    await expectLocked(asDoctor()((tx) => tx.delete(encounters).where(eq(encounters.id, encounterId))));
    await expectLocked(asDoctor()((tx) => tx.execute(sql`update app.diagnoses set label = 'x' where encounter_id = ${encounterId}`)));
    await expectLocked(asDoctor()((tx) => tx.execute(sql`delete from app.prescription_items where prescription_id = ${rx!.id}`)));
    await expectLocked(asDoctor()((tx) => tx.update(prescriptions).set({ signedSnapshot: { forged: true } }).where(eq(prescriptions.id, rx!.id))));
    await expect(asNurse()((tx) => recordVitals(tx, clinic.clinicId, encounterId, { pulse: 80 }, undefined, nurseId, today))).rejects.toThrow(AppError);
    await expectLocked(
      asNurse()((tx) =>
        tx.execute(sql`insert into app.vitals (clinic_id, encounter_id, patient_id, pulse, recorded_by) values (${clinic.clinicId}, ${encounterId}, ${patientId}, 80, ${nurseId})`),
      ),
    );
    await expect(owner`update app.encounters set plan = 'owner edit' where id = ${encounterId}`).rejects.toThrow(/finalised/);
    await expect(owner`update app.prescription_items set dose = '2 tablets' where prescription_id = ${rx!.id}`).rejects.toThrow(/signed/);

    // The pharmacy's dispensing status is the one thing that may move.
    await asAdmin()((tx) => tx.update(prescriptions).set({ dispenseStatus: "dispensed" }).where(eq(prescriptions.id, rx!.id)));

    // Corrections go in as amendments, which are themselves append-only.
    const amendment = await asDoctor()((tx) => addAmendment(tx, clinic.clinicId, encounterId, "Duration should read 5 days.", doctorId));
    await expect(owner`update app.encounter_amendments set text = 'x' where id = ${amendment.id}`).rejects.toThrow();
  });

  it("drops an empty draft prescription instead of signing it", async () => {
    const { encounterId } = await consultation("NoRx");
    const amox = await drugId("Amoxicillin 500");
    const added = await asDoctor()((tx) => addPrescriptionItem(tx, clinic.clinicId, encounterId, { drugId: amox, dose: "1", frequency: "TDS", durationDays: 5, quantity: null }, doctorId));
    await asDoctor()((tx) => tx.execute(sql`delete from app.prescription_items where id = ${added.id}`));
    const result = await asDoctor()((tx) => finalizeEncounter(tx, encounterId, doctorId, today));
    expect(result.prescriptionId).toBeNull();
    const rows = await owner`select id from app.prescriptions where encounter_id = ${encounterId}`;
    expect(rows).toHaveLength(0);
  });
});

describe("private notes", () => {
  it("are visible to their author only - not the Clinic Admin, not another doctor", async () => {
    const { encounterId } = await consultation("Private");
    await asDoctor()((tx) => savePrivateNote(tx, clinic.clinicId, encounterId, "Query domestic situation", doctorId));
    expect((await asDoctor()((tx) => getPrivateNote(tx, encounterId)))?.text).toBe("Query domestic situation");
    expect(await asAdmin()((tx) => getPrivateNote(tx, encounterId))).toBeNull();
    expect(await as(unregisteredDoctorId)((tx) => getPrivateNote(tx, encounterId))).toBeNull();

    // Writing someone else's note is refused by the policy itself.
    const error = await asAdmin()((tx) => savePrivateNote(tx, clinic.clinicId, encounterId, "admin note pretending", doctorId)).then(
      () => null,
      (e: unknown) => e,
    );
    expect(pgError(error)?.code).toBe("42501");
  });
});

describe("lab", () => {
  it("orders, results, returns to the ordering doctor until read, and freezes the result", async () => {
    const { encounterId } = await consultation("Lab");
    const tests = await asDoctor()((tx) => listLabTestOptions(tx));
    const hb = tests.find((t) => t.name === "Haemoglobin")!;

    const order = await asDoctor()((tx) => orderLab(tx, clinic.clinicId, encounterId, hb.id, "Fasting not needed", doctorId));
    await expect(asDoctor()((tx) => orderLab(tx, clinic.clinicId, encounterId, hb.id, undefined, doctorId))).rejects.toThrow(/already ordered/);

    const hbField = (await asAdmin()((tx) => entryFieldsFor(tx, [{ id: order.id, testId: hb.id, patientSex: "unknown", patientAge: 30 }]))).get(order.id)![0];
    await asAdmin()((tx) => saveLabResult(tx, clinic.clinicId, order.id, { values: [{ parameterId: hbField.id, value: "9.1" }] }, adminId, today));
    await expect(asAdmin()((tx) => saveLabResult(tx, clinic.clinicId, order.id, { values: [{ parameterId: hbField.id, value: "12" }] }, adminId, today))).rejects.toThrow(AppError);
    await expectLocked(asAdmin()((tx) => tx.execute(sql`update app.lab_orders set result_value = '12' where id = ${order.id}`)));

    const unread = await asDoctor()((tx) => listUnreadResults(tx, doctorId, today));
    expect(unread.map((u) => u.id)).toContain(order.id);
    await expect(as(unregisteredDoctorId)((tx) => markResultRead(tx, order.id, unregisteredDoctorId))).rejects.toThrow(AppError);
    await asDoctor()((tx) => markResultRead(tx, order.id, doctorId));
    expect((await asDoctor()((tx) => listUnreadResults(tx, doctorId, today))).map((u) => u.id)).not.toContain(order.id);
  });

  it("cannot order on a finalised consultation", async () => {
    const { encounterId } = await consultation("LabLate");
    await asDoctor()((tx) => finalizeEncounter(tx, encounterId, doctorId, today));
    const tests = await asDoctor()((tx) => listLabTestOptions(tx));
    await expect(asDoctor()((tx) => orderLab(tx, clinic.clinicId, encounterId, tests[0].id, undefined, doctorId))).rejects.toThrow(AppError);
  });
});

describe("lab tests with their own parameters", () => {
  const cbc = async () => (await owner`select id from app.lab_tests where clinic_id = ${clinic.clinicId} and starter_key = 'cbc'`)[0].id as string;
  const female = async (name: string) => {
    const p = await asAdmin()((tx) => registerPatient(tx, clinic.clinicId, { firstName: name, sex: "female", statedAgeYears: 34 }, { likelyIds: [], actorId: adminId, today }));
    const visit = await walkIn(p.id, doctorId);
    const called = await asDoctor()((tx) => callPatient(tx, clinic.clinicId, visit.id, doctorId, today));
    return { patientId: p.id, encounterId: called.encounterId };
  };
  const fieldsOf = async (orderId: string, patientSex: string, patientAge: number, testId: string) =>
    (await asDoctor()((tx) => entryFieldsFor(tx, [{ id: orderId, testId, patientSex, patientAge }]))).get(orderId)!;

  it("every starter test gets what it reports, ranges included, and re-import adds nothing", async () => {
    const [count] = await owner`select count(*)::int as n from app.lab_test_parameters p join app.lab_tests t on t.id = p.test_id where p.clinic_id = ${clinic.clinicId} and t.starter_key = 'cbc'`;
    expect(count.n).toBeGreaterThanOrEqual(14);
    const again = await asAdmin()((tx) => importStarterCatalog(tx, clinic.clinicId));
    expect(again.labParameters).toBe(0);
  });

  it("flags each value against this patient's own range and sends the doctor a summary", async () => {
    const { encounterId, patientId } = await female("Lakshmi");
    const testId = await cbc();
    const order = await asDoctor()((tx) => orderLab(tx, clinic.clinicId, encounterId, testId, undefined, doctorId));
    const fields = await fieldsOf(order.id, "female", 34, testId);
    const hb = fields.find((f) => f.name === "Haemoglobin")!;
    const plt = fields.find((f) => f.name === "Platelet count")!;
    expect(hb.reference).toBe("12 - 15"); // the female range, not the male one

    await expect(asLab()((tx) => saveLabResult(tx, clinic.clinicId, order.id, { values: [{ parameterId: hb.id, value: "11 g/dL" }] }, labId, today))).rejects.toThrow(/enter a number/);
    await expect(asLab()((tx) => saveLabResult(tx, clinic.clinicId, order.id, { values: [{ parameterId: hb.id, value: " " }] }, labId, today))).rejects.toThrow(/at least one/);

    const result = await asLab()((tx) =>
      saveLabResult(tx, clinic.clinicId, order.id, { values: [{ parameterId: hb.id, value: "6.5" }, { parameterId: plt.id, value: "250000" }], notes: "Repeat sample" }, labId, today),
    );
    expect(result).toMatchObject({ flag: "critical", parameters: 2 });
    const rows = await owner`select name, value, flag, reference_text from app.lab_results where order_id = ${order.id} order by sort_order`;
    expect(rows).toEqual([
      { name: "Haemoglobin", value: "6.5", flag: "critical_low", reference_text: "12 - 15" },
      { name: "Platelet count", value: "250000", flag: "normal", reference_text: "150000 - 410000" },
    ]);
    const [unread] = await asDoctor()((tx) => listUnreadResults(tx, doctorId, today)).then((list) => list.filter((u) => u.id === order.id));
    expect(unread.resultFlag).toBe("critical");
    expect(unread.resultValue).toContain("Haemoglobin 6.5 g/dL (LL)");

    // Saved results are permanent, and a later change to a range leaves them alone.
    await expect(asLab()((tx) => saveLabResult(tx, clinic.clinicId, order.id, { values: [{ parameterId: hb.id, value: "9" }] }, labId, today))).rejects.toThrow(/already been resulted/);
    await expect(owner`update app.lab_results set value = '99' where order_id = ${order.id}`).rejects.toThrow(/append-only/);
    await owner`update app.lab_parameter_ranges set low = 1 where parameter_id = ${hb.id}`;
    const report = (await asDoctor()((tx) => labReport(tx, encounterId, today)))!;
    expect(report.tests[0].lines[0]).toMatchObject({ referenceText: "12 - 15", flag: "critical_low" });
    await owner`update app.lab_parameter_ranges set low = 12 where parameter_id = ${hb.id} and sex = 'female'`;
    await owner`update app.lab_parameter_ranges set low = 13 where parameter_id = ${hb.id} and sex = 'male'`;

    const letterhead = { name: "Clinic", addressLine: null, city: null, phone: null, email: null, letterheadText: null, footerText: null };
    const pdf = await renderLabReportPdf(report, letterhead, TZ);
    expect(Buffer.from(pdf.slice(0, 5)).toString()).toBe("%PDF-");

    const history = await asDoctor()((tx) => patientLabHistory(tx, patientId, TZ));
    expect(history.tests[0].rows.map((r) => r.name)).toContain("Haemoglobin");
  });

  it("a test with no parameter list takes whatever the technician adds", async () => {
    const [custom] = await asAdmin()((tx) => tx.insert(labTests).values({ clinicId: clinic.clinicId, name: "Custom culture" }).returning({ id: labTests.id }));
    const { encounterId } = await female("Radha");
    const order = await asDoctor()((tx) => orderLab(tx, clinic.clinicId, encounterId, custom.id, undefined, doctorId));
    expect(await fieldsOf(order.id, "female", 34, custom.id)).toEqual([]);
    await asLab()((tx) => saveLabResult(tx, clinic.clinicId, order.id, { values: [], added: [{ name: "Custom culture", value: "No growth after 48 hours" }] }, labId, today));
    const report = (await asDoctor()((tx) => labReport(tx, encounterId, today)))!;
    expect(report.tests[0].lines[0]).toMatchObject({ name: "Custom culture", value: "No growth after 48 hours", section: null, parameterId: null });
    expect(report.tests[0].single).toBeNull();
  });

  it("parameters added on the spot sit with the test's own, flag themselves, print and trend", async () => {
    const testId = await cbc();
    const { encounterId } = await female("Added");
    const order = await asDoctor()((tx) => orderLab(tx, clinic.clinicId, encounterId, testId, undefined, doctorId));
    const fields = await fieldsOf(order.id, "female", 34, testId);
    const hb = fields.find((f) => f.name.startsWith("Haemoglobin"))!;

    await expect(asLab()((tx) => saveLabResult(tx, clinic.clinicId, order.id, { values: [{ parameterId: hb.id, value: "13" }], added: [{ name: hb.name.toUpperCase(), value: "13" }] }, labId, today))).rejects.toThrow(/already on this test/);
    await expect(asLab()((tx) => saveLabResult(tx, clinic.clinicId, order.id, { values: [], added: [{ name: "Reticulocytes", value: "1" }, { name: "reticulocytes", value: "2" }] }, labId, today))).rejects.toThrow(/already on this test/);

    await asLab()((tx) =>
      saveLabResult(
        tx,
        clinic.clinicId,
        order.id,
        {
          values: [{ parameterId: hb.id, value: "13" }],
          added: [
            // Outside the range typed, so it cannot be saved as normal.
            { name: "Reticulocytes", value: "9", unit: "%", reference: "0.5 - 2.5", flag: "normal" },
            { name: "Malaria parasite", value: "Seen", flag: "critical" },
            { name: "Sample appearance", value: "Clear" },
          ],
        },
        labId,
        today,
      ),
    );
    const report = (await asDoctor()((tx) => labReport(tx, encounterId, today)))!;
    const lines = report.tests[0].lines;
    expect(lines.map((l) => [l.name, l.section, l.flag])).toEqual([
      [hb.name, hb.section, "normal"],
      ["Reticulocytes", "Additional", "high"],
      ["Malaria parasite", "Additional", "critical"],
      ["Sample appearance", "Additional", "normal"],
    ]);
    expect(lines[1]).toMatchObject({ refLow: "0.5000", refHigh: "2.5000", referenceText: "0.5 - 2.5", valueNumber: "9.0000" });
    expect((await asDoctor()((tx) => listUnreadResults(tx, doctorId, today))).find((u) => u.id === order.id)?.resultFlag).toBe("critical");
  });

  it("opening a starter test fills in its parameters, without undoing what the clinic chose", async () => {
    // As in a clinic set up before parameters existed, where nobody pressed Import.
    const [test] = await owner`select id from app.lab_tests where clinic_id = ${clinic.clinicId} and starter_key = 'lipid'`;
    await owner`delete from app.lab_test_parameters where test_id = ${test.id}`;
    const { encounterId } = await female("Starter");
    const order = await asDoctor()((tx) => orderLab(tx, clinic.clinicId, encounterId, test.id, undefined, doctorId));
    const opened = (await asLab()((tx) => labOrderDetail(tx, clinic.clinicId, order.id, today)))!;
    expect(opened.fields.length).toBeGreaterThan(3);

    // Turned off by the clinic: stays off, even though the starter list has them.
    await owner`update app.lab_test_parameters set is_active = false where test_id = ${test.id}`;
    expect((await asLab()((tx) => labOrderDetail(tx, clinic.clinicId, order.id, today)))!.fields).toEqual([]);
  });

  describe("documents", () => {
    const pdf = (text = "report") => Buffer.from(`%PDF-1.4 ${text}`);
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    const newOrder = async (name: string) => {
      const testId = await cbc();
      const { encounterId, patientId } = await female(name);
      const order = await asDoctor()((tx) => orderLab(tx, clinic.clinicId, encounterId, testId, undefined, doctorId));
      return { order, encounterId, patientId, testId };
    };
    const attach = (orderId: string, name: string, bytes: Buffer) => asLab()((tx) => addLabDocument(tx, clinic.clinicId, orderId, { name, bytes }, labId));

    it("takes the type from the content, the patient from the order, and refuses the rest", async () => {
      const { order, patientId } = await newOrder("Docs");
      await expect(attach(order.id, "report.pdf", Buffer.from("<script>alert(1)</script>"))).rejects.toThrow(/PDF, JPG or PNG/);
      await expect(attach(order.id, "empty.pdf", Buffer.alloc(0))).rejects.toThrow(/empty/);
      await expect(attach(order.id, "big.pdf", Buffer.concat([pdf(), Buffer.alloc(10 * 1024 * 1024)]))).rejects.toThrow(/10 MB/);

      const row = await attach(order.id, "../../scan\\C:\\photo.exe", png);
      const [document] = await asLab()((tx) => listOrderDocuments(tx, order.id));
      expect(document).toMatchObject({ id: row.id, contentType: "image/png", fileName: "photo.exe.png", sizeBytes: png.length, uploadedByName: expect.any(String) });
      expect(row.patientId).toBe(patientId);

      await expect(attach(order.id, "again.png", png)).rejects.toThrow(/already attached/);
      const opened = await asDoctor()((tx) => labDocumentForViewing(tx, row.id));
      expect(Buffer.compare(opened!.content, png)).toBe(0);
      expect((await asDoctor()((tx) => listPatientDocuments(tx, patientId))).map((d) => d.testName)).toEqual([order.testName]);
    });

    it("prints with the report: a PDF keeps its pages, a photo gets one, a bad file never stops the print", async () => {
      const blank = await PDFDocument.create();
      blank.addPage([300, 300]);
      blank.addPage([300, 300]);
      const twoPages = Buffer.from(await blank.save());
      const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

      const { order, encounterId, testId } = await newOrder("Printed");
      const [field] = await fieldsOf(order.id, "female", 34, testId);
      await attach(order.id, "machine-printout.pdf", twoPages);
      await attach(order.id, "smear.png", image);
      await attach(order.id, "corrupt.pdf", pdf("not really a pdf"));
      await asLab()((tx) => saveLabResult(tx, clinic.clinicId, order.id, { values: [{ parameterId: field.id, value: "13" }], added: [{ name: "A long note from the technician", value: "x ".repeat(120).trim() }] }, labId, today));

      const report = (await asDoctor()((tx) => labReport(tx, encounterId, today)))!;
      const letterhead = { name: "Test", addressLine: null, city: null, phone: null, email: null, letterheadText: null, footerText: null };
      const base = await renderLabReportPdf(report, letterhead, "Asia/Kolkata");
      const basePages = (await PDFDocument.load(base)).getPageCount();

      const documents = report.tests.flatMap((t) => t.documents);
      expect(documents.map((d) => d.name)).toEqual(["machine-printout.pdf", "smear.png", "corrupt.pdf"]);
      const contents = await asDoctor()((tx) => labDocumentContents(tx, documents.map((d) => d.id)));
      const full = await appendDocuments(base, documents.map((d) => ({ name: d.name, contentType: d.contentType, content: contents.get(d.id) ?? null })), "Printed MRN1");
      // Two from the PDF, one for the photo, one saying the corrupt file could not print.
      expect((await PDFDocument.load(full)).getPageCount()).toBe(basePages + 4);
    });

    it("limits a test to ten documents and stops at a cancelled test", async () => {
      const { order } = await newOrder("Many");
      for (let i = 0; i < 10; i++) await attach(order.id, `${i}.pdf`, pdf(String(i)));
      await expect(attach(order.id, "11.pdf", pdf("11"))).rejects.toThrow(/up to 10/);

      const other = await newOrder("Cancelled");
      await asDoctor()((tx) => cancelLabOrder(tx, other.order.id, doctorId));
      await expect(attach(other.order.id, "late.pdf", pdf())).rejects.toThrow(/cancelled/);
    });

    it("cannot be reached from another clinic", async () => {
      const { order } = await newOrder("Isolated");
      const row = await attach(order.id, "secret.pdf", pdf("secret"));
      const outsider = await createTestClinic("outsider");
      const stranger = "00000000-0000-4000-8000-000000000001";
      const asOutsider = <T,>(fn: Parameters<typeof withClinic<T>>[1]) => withClinic({ clinicId: outsider.clinicId, userId: stranger }, fn);
      expect(await asOutsider((tx) => labDocumentForViewing(tx, row.id))).toBeNull();
      expect((await asOutsider((tx) => labDocumentContents(tx, [row.id]))).size).toBe(0);
      await expect(asOutsider((tx) => addLabDocument(tx, outsider.clinicId, order.id, { name: "x.pdf", bytes: pdf() }, stranger))).rejects.toThrow(/not found/);
    });

    it("a result can be just the document, and needs an interpretation", async () => {
      const { order, encounterId } = await newOrder("Only");
      await expect(asLab()((tx) => saveLabResult(tx, clinic.clinicId, order.id, { values: [], documentFlag: "normal" }, labId, today))).rejects.toThrow(/attach the report/);
      const row = await attach(order.id, "outside-lab.pdf", pdf("outside"));
      await expect(asLab()((tx) => saveLabResult(tx, clinic.clinicId, order.id, { values: [] }, labId, today))).rejects.toThrow(/interpretation/);
      await asLab()((tx) => saveLabResult(tx, clinic.clinicId, order.id, { values: [], documentFlag: "abnormal" }, labId, today));

      const report = (await asDoctor()((tx) => labReport(tx, encounterId, today)))!;
      expect(report.tests[0].single).toMatchObject({ value: "See attached document", flag: "abnormal" });
      expect(report.tests[0].documents.map((d) => d.name)).toEqual(["outside-lab.pdf"]);

      // The result lives in that file, so it cannot be taken away on its own.
      await expect(asLab()((tx) => removeLabDocument(tx, row.id, "Wrong file", labId))).rejects.toThrow(/Upload the correct one first/);
      await attach(order.id, "right.pdf", pdf("right"));
      await asLab()((tx) => removeLabDocument(tx, row.id, "Wrong file", labId));
    });

    it("a document added after the doctor read the result comes back as unread", async () => {
      const { order, testId } = await newOrder("Late");
      const [field] = await fieldsOf(order.id, "female", 34, testId);
      await asLab()((tx) => saveLabResult(tx, clinic.clinicId, order.id, { values: [{ parameterId: field.id, value: "13" }] }, labId, today));
      await asDoctor()((tx) => markResultRead(tx, order.id, doctorId));
      expect((await asDoctor()((tx) => listUnreadResults(tx, doctorId, today))).map((u) => u.id)).not.toContain(order.id);

      await attach(order.id, "late.pdf", pdf("late"));
      const unread = (await asDoctor()((tx) => listUnreadResults(tx, doctorId, today))).find((u) => u.id === order.id);
      expect(unread?.documents).toBe(1);
    });

    it("removing keeps the record, hides the file, needs no second removal, and the file itself is locked", async () => {
      const { order, patientId } = await newOrder("Removed");
      const row = await attach(order.id, "wrong-patient.pdf", pdf("wrong"));
      await asLab()((tx) => removeLabDocument(tx, row.id, "Wrong patient", labId));
      await expect(asLab()((tx) => removeLabDocument(tx, row.id, "Again", labId))).rejects.toThrow(/not on this test/);

      expect(await asDoctor()((tx) => labDocumentForViewing(tx, row.id))).toBeNull();
      expect(await asDoctor()((tx) => listPatientDocuments(tx, patientId))).toEqual([]);
      expect((await asLab()((tx) => listOrderDocuments(tx, order.id)))[0]).toMatchObject({ removedReason: "Wrong patient", removedByName: expect.any(String) });

      // The same file may go back on once the wrong copy is gone.
      await attach(order.id, "right-this-time.pdf", pdf("wrong"));

      await expectLocked(asAdmin()((tx) => tx.execute(sql`update app.lab_documents set removed_at = null, removed_by = null, removed_reason = null where id = ${row.id}`)));
      await expectLocked(asAdmin()((tx) => tx.execute(sql`update app.lab_documents set file_name = 'x.pdf' where id = ${row.id}`)));
      await expectLocked(asAdmin()((tx) => tx.execute(sql`delete from app.lab_documents where id = ${row.id}`)));
      await expect(asAdmin()((tx) => tx.execute(sql`update app.lab_document_files set content = '\\x00' where document_id = ${row.id}`))).rejects.toThrow();
      await expect(asAdmin()((tx) => tx.execute(sql`delete from app.lab_document_files where document_id = ${row.id}`))).rejects.toThrow();
    });
  });

  it("the clinic can change a test's parameters and ranges", async () => {
    const testId = await cbc();
    const row = await asAdmin()((tx) => saveLabParameter(tx, clinic.clinicId, null, { testId, name: "Reticulocytes", unit: "%", valueType: "number", sortOrder: 99 }));
    await expect(asAdmin()((tx) => saveLabRange(tx, clinic.clinicId, { parameterId: row.id, sex: "any", ageMinYears: 0, ageMaxYears: null, low: 3, high: 1 }))).rejects.toThrow(/Low cannot be above/);
    await expect(asAdmin()((tx) => saveLabRange(tx, clinic.clinicId, { parameterId: row.id, sex: "any", ageMinYears: 0, ageMaxYears: null }))).rejects.toThrow(/low or a high/);
    const range = await asAdmin()((tx) => saveLabRange(tx, clinic.clinicId, { parameterId: row.id, sex: "any", ageMinYears: 0, ageMaxYears: null, low: 0.5, high: 2.5 }));
    const test = await asAdmin()((tx) => getLabTestWithParameters(tx, testId));
    expect(test?.parameters.find((p) => p.id === row.id)?.ranges).toHaveLength(1);
    await asAdmin()((tx) => deleteLabRange(tx, range.id));
  });
});

describe("tenancy", () => {
  it("another clinic sees none of this clinic's consultations", async () => {
    const other = await createTestClinic("peek");
    const [otherAdmin] = await owner`select id from app.users where clinic_id = ${other.clinicId}`;
    const rows = await withClinic({ clinicId: other.clinicId, userId: otherAdmin.id }, (tx) =>
      tx.select({ id: encounters.id }).from(encounters).where(and(eq(encounters.clinicId, clinic.clinicId))),
    );
    expect(rows).toHaveLength(0);
    const visitRows = await withClinic({ clinicId: other.clinicId, userId: otherAdmin.id }, (tx) => tx.select().from(visits));
    expect(visitRows).toHaveLength(0);
    const rules = await withClinic({ clinicId: other.clinicId, userId: otherAdmin.id }, (tx) => tx.select().from(drugInteractions));
    expect(rules.every((r) => r.clinicId === other.clinicId)).toBe(true);
  });
});
