// The clinical record: consultations, vitals, allergies, diagnoses,
// prescriptions, amendments, private notes and lab work.
//
// Once an encounter is finalised, a trigger refuses any change to it or its
// vitals / diagnoses / prescription (db/migrations/*_clinical_guards.sql).
// Private notes are restricted to their author by a restrictive RLS policy.
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { appSchema, clinicId, createdAt, id, updatedAt } from "./_shared";
import { clinics } from "./platform";
import { users } from "./identity";
import { patients, visits } from "./frontdesk";
import { allergyClasses, labTests } from "./catalog";

export const encounters = appSchema.table(
  "encounters",
  {
    id: id(),
    clinicId: clinicId().references(() => clinics.id, { onDelete: "restrict" }),
    visitId: uuid("visit_id").notNull(),
    patientId: uuid("patient_id").notNull(),
    doctorId: uuid("doctor_id"),
    status: varchar("status", { length: 20 }).notNull().default("open"),
    chiefComplaint: text("chief_complaint"),
    history: text("history"),
    examination: text("examination"),
    plan: text("plan"),
    followUp: varchar("follow_up", { length: 200 }),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
    finalizedAt: timestamp("finalized_at", { withTimezone: true }),
    finalizedBy: uuid("finalized_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("encounters_clinic_id_id_key").on(t.clinicId, t.id),
    uniqueIndex("encounters_visit_idx").on(t.visitId),
    foreignKey({ name: "encounters_visit_fk", columns: [t.clinicId, t.visitId], foreignColumns: [visits.clinicId, visits.id] }),
    foreignKey({ name: "encounters_patient_fk", columns: [t.clinicId, t.patientId], foreignColumns: [patients.clinicId, patients.id] }),
    foreignKey({ name: "encounters_doctor_fk", columns: [t.clinicId, t.doctorId], foreignColumns: [users.clinicId, users.id] }),
    index("encounters_patient_idx").on(t.clinicId, t.patientId, t.openedAt),
    check("encounters_status_check", sql`${t.status} IN ('open', 'finalized')`),
  ],
);

export const vitals = appSchema.table(
  "vitals",
  {
    id: id(),
    clinicId: clinicId(),
    encounterId: uuid("encounter_id").notNull(),
    patientId: uuid("patient_id").notNull(),
    temperatureC: numeric("temperature_c", { precision: 4, scale: 1 }),
    systolic: integer("systolic"),
    diastolic: integer("diastolic"),
    pulse: integer("pulse"),
    respRate: integer("resp_rate"),
    spo2: integer("spo2"),
    weightKg: numeric("weight_kg", { precision: 5, scale: 2 }),
    heightCm: numeric("height_cm", { precision: 5, scale: 1 }),
    /** Computed on the server against the clinic's age-banded ranges. */
    flags: jsonb("flags").notNull().default({}),
    notes: text("notes"),
    recordedBy: uuid("recorded_by").notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ name: "vitals_encounter_fk", columns: [t.clinicId, t.encounterId], foreignColumns: [encounters.clinicId, encounters.id] }),
    index("vitals_patient_idx").on(t.clinicId, t.patientId, t.recordedAt),
  ],
);

/** Allergies are patient-level and can be added but never deleted. */
export const allergies = appSchema.table(
  "allergies",
  {
    id: id(),
    clinicId: clinicId(),
    patientId: uuid("patient_id").notNull(),
    substance: varchar("substance", { length: 200 }).notNull(),
    allergyClassId: uuid("allergy_class_id"),
    reaction: varchar("reaction", { length: 300 }),
    severity: varchar("severity", { length: 20 }).notNull().default("moderate"),
    status: varchar("status", { length: 20 }).notNull().default("active"),
    recordedBy: uuid("recorded_by").notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("allergies_clinic_id_id_key").on(t.clinicId, t.id),
    foreignKey({ name: "allergies_patient_fk", columns: [t.clinicId, t.patientId], foreignColumns: [patients.clinicId, patients.id] }),
    foreignKey({
      name: "allergies_class_fk",
      columns: [t.clinicId, t.allergyClassId],
      foreignColumns: [allergyClasses.clinicId, allergyClasses.id],
    }),
    index("allergies_patient_idx").on(t.clinicId, t.patientId),
    check("allergies_severity_check", sql`${t.severity} IN ('mild', 'moderate', 'severe')`),
    check("allergies_status_check", sql`${t.status} IN ('active', 'resolved', 'entered_in_error')`),
  ],
);

/** Every correction to an allergy, with its reason (append-only). */
export const allergyHistory = appSchema.table(
  "allergy_history",
  {
    id: id(),
    clinicId: clinicId(),
    allergyId: uuid("allergy_id").notNull(),
    previous: jsonb("previous").notNull(),
    reason: text("reason").notNull(),
    changedBy: uuid("changed_by").notNull(),
    changedAt: createdAt(),
  },
  (t) => [
    foreignKey({ name: "allergy_history_allergy_fk", columns: [t.clinicId, t.allergyId], foreignColumns: [allergies.clinicId, allergies.id] }),
  ],
);

export const diagnoses = appSchema.table(
  "diagnoses",
  {
    id: id(),
    clinicId: clinicId(),
    encounterId: uuid("encounter_id").notNull(),
    code: varchar("code", { length: 20 }).notNull(),
    label: varchar("label", { length: 300 }).notNull(),
    isPrimary: boolean("is_primary").notNull().default(false),
    createdBy: uuid("created_by").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({ name: "diagnoses_encounter_fk", columns: [t.clinicId, t.encounterId], foreignColumns: [encounters.clinicId, encounters.id] }),
    index("diagnoses_encounter_idx").on(t.encounterId),
  ],
);

export const prescriptions = appSchema.table(
  "prescriptions",
  {
    id: id(),
    clinicId: clinicId(),
    encounterId: uuid("encounter_id").notNull(),
    patientId: uuid("patient_id").notNull(),
    prescriberId: uuid("prescriber_id").notNull(),
    status: varchar("status", { length: 20 }).notNull().default("draft"),
    /** Legal snapshot taken at signing: prescriber, registration, clinic letterhead. */
    signedSnapshot: jsonb("signed_snapshot"),
    signedAt: timestamp("signed_at", { withTimezone: true }),
    /** Pharmacy workflow (Phase 6). */
    dispenseStatus: varchar("dispense_status", { length: 20 }).notNull().default("pending"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("prescriptions_clinic_id_id_key").on(t.clinicId, t.id),
    uniqueIndex("prescriptions_encounter_idx").on(t.encounterId),
    foreignKey({ name: "prescriptions_encounter_fk", columns: [t.clinicId, t.encounterId], foreignColumns: [encounters.clinicId, encounters.id] }),
    check("prescriptions_status_check", sql`${t.status} IN ('draft', 'signed')`),
    check("prescriptions_dispense_check", sql`${t.dispenseStatus} IN ('pending', 'partial', 'dispensed', 'not_required')`),
  ],
);

export const prescriptionItems = appSchema.table(
  "prescription_items",
  {
    id: id(),
    clinicId: clinicId(),
    prescriptionId: uuid("prescription_id").notNull(),
    drugId: uuid("drug_id"),
    /** Snapshot of the catalogue entry at the time of prescribing. */
    drugName: varchar("drug_name", { length: 200 }).notNull(),
    genericName: varchar("generic_name", { length: 200 }).notNull(),
    form: varchar("form", { length: 30 }).notNull(),
    strength: varchar("strength", { length: 60 }),
    dose: varchar("dose", { length: 60 }).notNull(),
    frequency: varchar("frequency", { length: 40 }).notNull(),
    durationDays: integer("duration_days"),
    instructions: varchar("instructions", { length: 300 }),
    quantity: integer("quantity"),
    /** Warnings shown when prescribed, and the reason they were overridden. */
    warnings: jsonb("warnings").notNull().default([]),
    overrideReason: text("override_reason"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: "prescription_items_prescription_fk",
      columns: [t.clinicId, t.prescriptionId],
      foreignColumns: [prescriptions.clinicId, prescriptions.id],
    }).onDelete("cascade"),
    index("prescription_items_prescription_idx").on(t.prescriptionId),
  ],
);

/** Corrections after finalisation: the original stays, addenda accumulate. */
export const encounterAmendments = appSchema.table(
  "encounter_amendments",
  {
    id: id(),
    clinicId: clinicId(),
    encounterId: uuid("encounter_id").notNull(),
    authorId: uuid("author_id").notNull(),
    text: text("text").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({ name: "amendments_encounter_fk", columns: [t.clinicId, t.encounterId], foreignColumns: [encounters.clinicId, encounters.id] }),
  ],
);

/** Not part of the clinical record: visible to the author only, never printed. */
export const privateNotes = appSchema.table(
  "private_notes",
  {
    id: id(),
    clinicId: clinicId(),
    encounterId: uuid("encounter_id").notNull(),
    authorId: uuid("author_id").notNull(),
    text: text("text").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({ name: "private_notes_encounter_fk", columns: [t.clinicId, t.encounterId], foreignColumns: [encounters.clinicId, encounters.id] }),
    uniqueIndex("private_notes_author_encounter_idx").on(t.encounterId, t.authorId),
  ],
);

export const labOrders = appSchema.table(
  "lab_orders",
  {
    id: id(),
    clinicId: clinicId(),
    encounterId: uuid("encounter_id").notNull(),
    patientId: uuid("patient_id").notNull(),
    testId: uuid("test_id"),
    testName: varchar("test_name", { length: 200 }).notNull(),
    unit: varchar("unit", { length: 40 }),
    referenceRange: varchar("reference_range", { length: 200 }),
    notes: text("notes"),
    status: varchar("status", { length: 20 }).notNull().default("ordered"),
    orderedBy: uuid("ordered_by").notNull(),
    orderedAt: timestamp("ordered_at", { withTimezone: true }).notNull().defaultNow(),
    resultValue: varchar("result_value", { length: 500 }),
    resultFlag: varchar("result_flag", { length: 20 }),
    resultNotes: text("result_notes"),
    resultedBy: uuid("resulted_by"),
    resultedAt: timestamp("resulted_at", { withTimezone: true }),
    /** Results return to the ordering doctor and stay visible until read. */
    readAt: timestamp("read_at", { withTimezone: true }),
  },
  (t) => [
    unique("lab_orders_clinic_id_id_key").on(t.clinicId, t.id),
    foreignKey({ name: "lab_orders_encounter_fk", columns: [t.clinicId, t.encounterId], foreignColumns: [encounters.clinicId, encounters.id] }),
    foreignKey({ name: "lab_orders_test_fk", columns: [t.clinicId, t.testId], foreignColumns: [labTests.clinicId, labTests.id] }),
    index("lab_orders_status_idx").on(t.clinicId, t.status, t.orderedAt),
    index("lab_orders_unread_idx").on(t.clinicId, t.orderedBy, t.readAt),
    check("lab_orders_status_check", sql`${t.status} IN ('ordered', 'resulted', 'cancelled')`),
    check("lab_orders_flag_check", sql`${t.resultFlag} IS NULL OR ${t.resultFlag} IN ('normal', 'abnormal', 'critical')`),
  ],
);

