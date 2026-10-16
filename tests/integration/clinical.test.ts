// Phase 4: triage, consultation, prescribing, signing, immutability, lab,
// and the clinic-owned catalogues.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { ownerSql } from "./test-db";
import { createTestClinic } from "./fixtures";
import { withClinic } from "@/lib/db";
import { AppError, isLockedRecord, pgError } from "@/lib/errors";
import { allergyClasses, drugs, drugInteractions, encounters, prescriptions, visits } from "@/lib/db/schema";
import { createStaff } from "@/features/staff/staff.service";
import { registerPatient } from "@/features/patients/patients.service";
import { addWalkIn } from "@/features/scheduling/booking.service";
import { importStarterCatalog, missingStarterCounts } from "@/lib/catalog/seed";
import {
  addAmendment,
  callNext,
  callPatient,
  finalizeEncounter,
  getPrivateNote,
  handOver,
  saveNotes,
  savePrivateNote,
  startTriage,
  takeOverEncounter,
} from "@/features/clinical/encounters.service";
import { recordVitals } from "@/features/clinical/vitals.service";
import { addAllergy, correctAllergy, listAllergyHistory, recordNoKnownAllergies } from "@/features/clinical/allergies.service";
import { addDiagnosis, searchDiagnosisCodes } from "@/features/clinical/diagnoses.service";
import { addPrescriptionItem, getDraftPrescription, getSignedPrescription, searchDrugs, warningsFor } from "@/features/clinical/prescriptions.service";
import { enterResult, listLabTestOptions, listUnreadResults, markResultRead, orderLab } from "@/features/clinical/lab.service";
import { createDrug, saveVitalRange, setEntryActive } from "@/features/catalog/catalog.service";
import { todayInTimeZone } from "@/lib/time";

const TZ = "Asia/Kolkata";
const owner = ownerSql();
const today = todayInTimeZone(TZ);

let clinic: Awaited<ReturnType<typeof createTestClinic>>;
let adminId: string;
let doctorId: string;
let unregisteredDoctorId: string;
let nurseId: string;

const as = (userId: string) => <T,>(fn: Parameters<typeof withClinic<T>>[1]) => withClinic({ clinicId: clinic.clinicId, userId }, fn);
const asAdmin = () => as(adminId);
const asDoctor = () => as(doctorId);
const asNurse = () => as(nurseId);

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

    await asAdmin()((tx) => enterResult(tx, order.id, { value: "9.1", flag: "abnormal" }, adminId));
    await expect(asAdmin()((tx) => enterResult(tx, order.id, { value: "12", flag: "normal" }, adminId))).rejects.toThrow(AppError);
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
