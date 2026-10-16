"use server";

import { z } from "zod";
import { clinicAction } from "@/lib/auth/actions";
import { can } from "@/lib/auth/clinic-session";
import { checkbox, idField, optionalId, optionalInt, optionalNumber, optionalText, requiredText } from "@/lib/validation";
import { todayInTimeZone } from "@/lib/time";
import { AppError } from "@/lib/errors";
import {
  addAmendment,
  callNext,
  callPatient,
  finalizeEncounter,
  handOver,
  saveNotes,
  savePrivateNote,
  startTriage,
  takeOverEncounter,
} from "./encounters.service";
import { recordVitals } from "./vitals.service";
import { ALLERGY_SEVERITIES, ALLERGY_STATUSES, addAllergy, correctAllergy, recordNoKnownAllergies } from "./allergies.service";
import { addDiagnosis, removeDiagnosis, searchDiagnosisCodes } from "./diagnoses.service";
import { addPrescriptionItem, getDraftPrescription, removePrescriptionItem, searchDrugs, warningsFor } from "./prescriptions.service";
import { needsOverride } from "./prescribing-rules";
import { VITAL_FIELDS, type VitalKey } from "./vital-rules";

// ---------------------------------------------------------------------------
// Queue: triage and calling
// ---------------------------------------------------------------------------

export const startTriageAction = clinicAction(
  { name: "clinical.startTriage", permission: ["queue:call", "vitals:write"], schema: z.object({ visitId: idField }) },
  async ({ session, db, audit }, input) =>
    db(async (tx) => {
      const result = await startTriage(tx, session.clinicId, input.visitId, todayInTimeZone(session.timezone));
      await audit(tx, { action: "TRIAGE_STARTED", targetType: "visit", targetId: result.visitId, patientId: result.patientId });
      return result;
    }),
);

export const handOverAction = clinicAction(
  { name: "clinical.handOver", permission: ["queue:call", "vitals:write"], schema: z.object({ encounterId: idField }) },
  async ({ db, audit }, input) =>
    db(async (tx) => {
      const result = await handOver(tx, input.encounterId);
      await audit(tx, { action: "PATIENT_READY_FOR_DOCTOR", targetType: "visit", targetId: result.visitId, patientId: result.patientId });
      return result;
    }),
);

export const callPatientAction = clinicAction(
  { name: "clinical.callPatient", permission: ["queue:call", "encounter:write"], schema: z.object({ visitId: idField }) },
  async ({ session, db, audit }, input) =>
    db(async (tx) => {
      const result = await callPatient(tx, session.clinicId, input.visitId, session.userId, todayInTimeZone(session.timezone));
      await audit(tx, { action: "PATIENT_CALLED", targetType: "visit", targetId: result.visitId, patientId: result.patientId });
      return result;
    }),
);

export const callNextAction = clinicAction(
  { name: "clinical.callNext", permission: ["queue:call", "encounter:write"], schema: z.object({}) },
  async ({ session, db, audit }) =>
    db(async (tx) => {
      const result = await callNext(tx, session.clinicId, session.userId, todayInTimeZone(session.timezone));
      await audit(tx, { action: "PATIENT_CALLED", targetType: "visit", targetId: result.visitId, patientId: result.patientId, details: { next: true } });
      return result;
    }),
);

// ---------------------------------------------------------------------------
// Vitals and allergies
// ---------------------------------------------------------------------------

const vitalsSchema = z.object({
  encounterId: idField,
  notes: optionalText(500),
  ...(Object.fromEntries(VITAL_FIELDS.map((f) => [f.key, optionalNumber(f.min, f.max, f.label)])) as Record<
    VitalKey,
    ReturnType<typeof optionalNumber>
  >),
});

export const recordVitalsAction = clinicAction(
  { name: "clinical.recordVitals", permission: "vitals:write", schema: vitalsSchema },
  async ({ session, db, audit }, input) =>
    db(async (tx) => {
      const { encounterId, notes, ...values } = input;
      const result = await recordVitals(tx, session.clinicId, encounterId, values, notes, session.userId, todayInTimeZone(session.timezone));
      await audit(tx, {
        action: "VITALS_RECORDED",
        targetType: "encounter",
        targetId: encounterId,
        patientId: result.patientId,
        details: { flagged: Object.keys(result.flags) },
      });
      return { flags: result.flags };
    }),
);

export const addAllergyAction = clinicAction(
  {
    name: "clinical.addAllergy",
    permission: "allergy:write",
    schema: z.object({
      patientId: idField,
      substance: requiredText(200, "Substance"),
      allergyClassId: optionalId,
      reaction: optionalText(300),
      severity: z.enum(ALLERGY_SEVERITIES),
    }),
  },
  async ({ session, db, audit }, input) =>
    db(async (tx) => {
      const { patientId, ...rest } = input;
      const row = await addAllergy(tx, session.clinicId, patientId, rest, session.userId);
      await audit(tx, { action: "ALLERGY_RECORDED", targetType: "allergy", targetId: row.id, patientId, details: { severity: input.severity } });
      return row;
    }),
);

export const correctAllergyAction = clinicAction(
  {
    name: "clinical.correctAllergy",
    permission: "allergy:write",
    schema: z.object({
      id: idField,
      severity: z.enum(ALLERGY_SEVERITIES),
      status: z.enum(ALLERGY_STATUSES),
      reaction: optionalText(300),
      reason: requiredText(500, "A reason"),
    }),
  },
  async ({ session, db, audit }, input) =>
    db(async (tx) => {
      const { id, reason, ...change } = input;
      const result = await correctAllergy(tx, session.clinicId, id, change, reason, session.userId);
      await audit(tx, {
        action: "ALLERGY_CORRECTED",
        targetType: "allergy",
        targetId: id,
        patientId: result.patientId,
        severity: "warning",
        details: { status: change.status, severity: change.severity, reason },
      });
    }),
);

export const noKnownAllergiesAction = clinicAction(
  { name: "clinical.noKnownAllergies", permission: "allergy:write", schema: z.object({ patientId: idField }) },
  async ({ session, db, audit }, input) =>
    db(async (tx) => {
      await recordNoKnownAllergies(tx, input.patientId, session.userId);
      await audit(tx, { action: "NO_KNOWN_ALLERGIES_RECORDED", targetType: "patient", targetId: input.patientId, patientId: input.patientId });
    }),
);

// ---------------------------------------------------------------------------
// Notes and diagnoses
// ---------------------------------------------------------------------------

export const saveNotesAction = clinicAction(
  {
    name: "clinical.saveNotes",
    permission: "encounter:write",
    schema: z.object({
      encounterId: idField,
      chiefComplaint: optionalText(2000),
      history: optionalText(8000),
      examination: optionalText(8000),
      plan: optionalText(8000),
      followUp: optionalText(200),
    }),
  },
  async ({ session, db, audit }, input) =>
    db(async (tx) => {
      const { encounterId, ...notes } = input;
      const row = await saveNotes(tx, encounterId, notes, session.userId);
      await audit(tx, { action: "CONSULTATION_NOTES_SAVED", targetType: "encounter", targetId: encounterId, patientId: row.patientId });
    }),
);

export const searchDiagnosisCodesAction = clinicAction(
  { name: "clinical.searchDiagnoses", permission: "encounter:write", schema: z.object({ query: z.string().max(100).default("") }) },
  async ({ db }, input) => db((tx) => searchDiagnosisCodes(tx, input.query)),
);

export const addDiagnosisAction = clinicAction(
  {
    name: "clinical.addDiagnosis",
    permission: "encounter:write",
    schema: z.object({
      encounterId: idField,
      code: z
        .string({ message: "Code is required" })
        .trim()
        .min(1, "Code is required")
        .max(20)
        .regex(/^[A-Za-z0-9.\-]+$/, "Letters, numbers, dots and hyphens only"),
      label: requiredText(300, "Description"),
      isPrimary: checkbox,
    }),
  },
  async ({ session, db, audit }, input) =>
    db(async (tx) => {
      const { encounterId, ...rest } = input;
      const row = await addDiagnosis(tx, session.clinicId, encounterId, rest, session.userId);
      await audit(tx, { action: "DIAGNOSIS_ADDED", targetType: "encounter", targetId: encounterId, patientId: row.patientId, details: { code: row.code } });
      return row;
    }),
);

export const removeDiagnosisAction = clinicAction(
  { name: "clinical.removeDiagnosis", permission: "encounter:write", schema: z.object({ id: idField }) },
  async ({ session, db, audit }, input) =>
    db(async (tx) => {
      const row = await removeDiagnosis(tx, input.id, session.userId);
      await audit(tx, { action: "DIAGNOSIS_REMOVED", targetType: "diagnosis", targetId: input.id, patientId: row.patientId, details: { code: row.code } });
    }),
);

// ---------------------------------------------------------------------------
// Prescribing
// ---------------------------------------------------------------------------

const PRESCRIBE: ["encounter:write", "prescription:sign"] = ["encounter:write", "prescription:sign"];

export const searchDrugsAction = clinicAction(
  { name: "clinical.searchDrugs", permission: PRESCRIBE, schema: z.object({ query: z.string().max(100).default("") }) },
  async ({ db }, input) => db((tx) => searchDrugs(tx, input.query)),
);

/** The live check shown as soon as a medicine is chosen. */
export const checkDrugAction = clinicAction(
  { name: "clinical.checkDrug", permission: PRESCRIBE, schema: z.object({ encounterId: idField, drugId: idField }) },
  async ({ db }, input) =>
    db(async (tx) => {
      const { warnings } = await warningsFor(tx, input.encounterId, input.drugId);
      return { warnings, needsOverride: needsOverride(warnings) };
    }),
);

export const addPrescriptionItemAction = clinicAction(
  {
    name: "clinical.addPrescriptionItem",
    permission: PRESCRIBE,
    schema: z.object({
      encounterId: idField,
      drugId: idField,
      dose: requiredText(60, "Dose"),
      frequency: requiredText(40, "Frequency"),
      durationDays: optionalInt(1, 365, "Duration"),
      instructions: optionalText(300),
      quantity: optionalInt(1, 10000, "Quantity"),
      overrideReason: optionalText(500),
    }),
  },
  async ({ session, db, audit }, input) =>
    db(async (tx) => {
      const { encounterId, ...item } = input;
      const row = await addPrescriptionItem(tx, session.clinicId, encounterId, item, session.userId);
      await audit(tx, {
        action: row.overridden ? "PRESCRIPTION_WARNING_OVERRIDDEN" : "PRESCRIPTION_ITEM_ADDED",
        targetType: "encounter",
        targetId: encounterId,
        patientId: row.patientId,
        severity: row.overridden ? "warning" : "info",
        details: {
          drug: row.drugName,
          ...(row.warnings.length ? { warnings: row.warnings.map((w) => w.severity), reason: item.overrideReason } : {}),
        },
      });
      return { id: row.id };
    }),
);

export const removePrescriptionItemAction = clinicAction(
  { name: "clinical.removePrescriptionItem", permission: PRESCRIBE, schema: z.object({ id: idField }) },
  async ({ session, db, audit }, input) =>
    db(async (tx) => {
      const row = await removePrescriptionItem(tx, input.id, session.userId);
      await audit(tx, { action: "PRESCRIPTION_ITEM_REMOVED", targetType: "prescription_item", targetId: input.id, patientId: row.patientId, details: { drug: row.drugName } });
    }),
);

// ---------------------------------------------------------------------------
// Sign & finalise, amendments, private notes
// ---------------------------------------------------------------------------

export const finalizeEncounterAction = clinicAction(
  { name: "clinical.finalize", permission: "encounter:finalize", schema: z.object({ encounterId: idField }) },
  async ({ session, db, audit }, input) =>
    db(async (tx) => {
      const draft = await getDraftPrescription(tx, input.encounterId);
      if (draft && draft.items.length > 0 && !can(session, "prescription:sign")) {
        throw new AppError("Only a prescriber can sign a consultation with medicines on it.");
      }
      const result = await finalizeEncounter(tx, input.encounterId, session.userId, todayInTimeZone(session.timezone));
      await audit(tx, {
        action: "CONSULTATION_FINALISED",
        targetType: "encounter",
        targetId: input.encounterId,
        patientId: result.patientId,
        details: { prescriptionSigned: Boolean(result.prescriptionId) },
      });
      if (result.prescriptionId) {
        await audit(tx, { action: "PRESCRIPTION_SIGNED", targetType: "prescription", targetId: result.prescriptionId, patientId: result.patientId });
      }
      return result;
    }),
);

export const addAmendmentAction = clinicAction(
  {
    name: "clinical.addAmendment",
    permission: "encounter:write",
    schema: z.object({ encounterId: idField, text: requiredText(4000, "The amendment") }),
  },
  async ({ session, db, audit }, input) =>
    db(async (tx) => {
      const row = await addAmendment(tx, session.clinicId, input.encounterId, input.text, session.userId);
      await audit(tx, { action: "CONSULTATION_AMENDED", targetType: "encounter", targetId: input.encounterId, patientId: row.patientId });
      return { id: row.id };
    }),
);

export const takeOverEncounterAction = clinicAction(
  { name: "clinical.takeOver", permission: ["encounter:write", "prescription:sign"], schema: z.object({ encounterId: idField }) },
  async ({ session, db, audit }, input) =>
    db(async (tx) => {
      const result = await takeOverEncounter(tx, input.encounterId, session.userId);
      if (result.changed) {
        await audit(tx, {
          action: "CONSULTATION_TAKEN_OVER",
          targetType: "encounter",
          targetId: input.encounterId,
          patientId: result.patientId,
          severity: "warning",
          details: { previousDoctorId: result.previousDoctorId },
        });
      }
    }),
);

/** Never audited with its text: the note is the author's alone. */
export const savePrivateNoteAction = clinicAction(
  { name: "clinical.savePrivateNote", permission: "encounter:write", schema: z.object({ encounterId: idField, text: optionalText(4000) }) },
  async ({ session, db }, input) =>
    db((tx) => savePrivateNote(tx, session.clinicId, input.encounterId, input.text, session.userId)),
);
