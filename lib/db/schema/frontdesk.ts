// Front desk: patients, appointments, the visit queue and follow-up tasks.
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  primaryKey,
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
import { services } from "./scheduling";

/** Per-clinic counters (patient record numbers, invoice numbers, …). */
export const clinicCounters = appSchema.table(
  "clinic_counters",
  {
    clinicId: clinicId().references(() => clinics.id, { onDelete: "restrict" }),
    key: varchar("key", { length: 40 }).notNull(),
    value: integer("value").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.clinicId, t.key] })],
);

export const patients = appSchema.table(
  "patients",
  {
    id: id(),
    clinicId: clinicId().references(() => clinics.id, { onDelete: "restrict" }),
    /** Medical record number, unique within the clinic. */
    mrn: varchar("mrn", { length: 30 }).notNull(),
    firstName: varchar("first_name", { length: 100 }),
    lastName: varchar("last_name", { length: 100 }),
    sex: varchar("sex", { length: 10 }).notNull().default("unknown"),
    dateOfBirth: date("date_of_birth"),
    /** When only an age is known, it is stored with the date it was stated. */
    statedAgeYears: integer("stated_age_years"),
    statedAgeOn: date("stated_age_on"),
    mobile: varchar("mobile", { length: 20 }),
    altPhone: varchar("alt_phone", { length: 20 }),
    email: varchar("email", { length: 255 }),
    addressLine: text("address_line"),
    city: varchar("city", { length: 100 }),
    /** Emergency admissions start as a placeholder with only a label. */
    isPlaceholder: boolean("is_placeholder").notNull().default(false),
    emergencyLabel: varchar("emergency_label", { length: 200 }),
    /** Set when staff confirm "no known allergies" (cleared by any recorded allergy). */
    noKnownAllergiesAt: timestamp("no_known_allergies_at", { withTimezone: true }),
    noKnownAllergiesBy: uuid("no_known_allergies_by"),
    createdBy: uuid("created_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("patients_clinic_id_id_key").on(t.clinicId, t.id),
    uniqueIndex("patients_clinic_mrn_idx").on(t.clinicId, t.mrn),
    index("patients_clinic_mobile_idx").on(t.clinicId, t.mobile),
    check("patients_sex_check", sql`${t.sex} IN ('male', 'female', 'other', 'unknown')`),
    check(
      "patients_identity_check",
      sql`${t.isPlaceholder} OR (${t.firstName} IS NOT NULL AND length(trim(${t.firstName})) > 0)`,
    ),
    check("patients_age_check", sql`${t.statedAgeYears} IS NULL OR (${t.statedAgeYears} BETWEEN 0 AND 130 AND ${t.statedAgeOn} IS NOT NULL)`),
  ],
);

/** Why a registration went ahead despite likely duplicates. */
export const duplicateOverrides = appSchema.table(
  "duplicate_overrides",
  {
    id: id(),
    clinicId: clinicId(),
    patientId: uuid("patient_id").notNull(),
    candidateIds: uuid("candidate_ids").array().notNull(),
    reason: text("reason").notNull(),
    createdBy: uuid("created_by").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: "duplicate_overrides_patient_fk",
      columns: [t.clinicId, t.patientId],
      foreignColumns: [patients.clinicId, patients.id],
    }),
  ],
);

export const appointments = appSchema.table(
  "appointments",
  {
    id: id(),
    clinicId: clinicId().references(() => clinics.id, { onDelete: "restrict" }),
    patientId: uuid("patient_id").notNull(),
    doctorId: uuid("doctor_id").notNull(),
    serviceId: uuid("service_id"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    status: varchar("status", { length: 20 }).notNull().default("booked"),
    notes: text("notes"),
    cancelReason: text("cancel_reason"),
    createdBy: uuid("created_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("appointments_clinic_id_id_key").on(t.clinicId, t.id),
    foreignKey({
      name: "appointments_patient_fk",
      columns: [t.clinicId, t.patientId],
      foreignColumns: [patients.clinicId, patients.id],
    }),
    foreignKey({
      name: "appointments_doctor_fk",
      columns: [t.clinicId, t.doctorId],
      foreignColumns: [users.clinicId, users.id],
    }),
    foreignKey({
      name: "appointments_service_fk",
      columns: [t.clinicId, t.serviceId],
      foreignColumns: [services.clinicId, services.id],
    }),
    index("appointments_doctor_time_idx").on(t.clinicId, t.doctorId, t.startsAt),
    index("appointments_patient_time_idx").on(t.clinicId, t.patientId, t.startsAt),
    check("appointments_status_check", sql`${t.status} IN ('booked', 'checked_in', 'completed', 'cancelled', 'no_show')`),
    check("appointments_range_check", sql`${t.endsAt} > ${t.startsAt}`),
  ],
);

/**
 * One row per patient visit on a day: the queue. Walk-ins and emergencies
 * have no appointment. Encounters (Phase 4) hang off a visit.
 */
export const visits = appSchema.table(
  "visits",
  {
    id: id(),
    clinicId: clinicId().references(() => clinics.id, { onDelete: "restrict" }),
    patientId: uuid("patient_id").notNull(),
    appointmentId: uuid("appointment_id"),
    doctorId: uuid("doctor_id"),
    serviceId: uuid("service_id"),
    /** Clinic-local calendar date of the visit. */
    visitDate: date("visit_date").notNull(),
    status: varchar("status", { length: 20 }).notNull().default("waiting"),
    isEmergency: boolean("is_emergency").notNull().default(false),
    /** Phone of whoever brought an emergency patient in. */
    companionPhone: varchar("companion_phone", { length: 20 }),
    /** Manual order among non-emergency patients. */
    position: integer("position").notNull().default(0),
    arrivedAt: timestamp("arrived_at", { withTimezone: true }).notNull().defaultNow(),
    triageStartedAt: timestamp("triage_started_at", { withTimezone: true }),
    readyAt: timestamp("ready_at", { withTimezone: true }),
    calledAt: timestamp("called_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    checkedInBy: uuid("checked_in_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("visits_clinic_id_id_key").on(t.clinicId, t.id),
    uniqueIndex("visits_appointment_idx").on(t.appointmentId),
    foreignKey({
      name: "visits_patient_fk",
      columns: [t.clinicId, t.patientId],
      foreignColumns: [patients.clinicId, patients.id],
    }),
    foreignKey({
      name: "visits_appointment_fk",
      columns: [t.clinicId, t.appointmentId],
      foreignColumns: [appointments.clinicId, appointments.id],
    }),
    foreignKey({
      name: "visits_doctor_fk",
      columns: [t.clinicId, t.doctorId],
      foreignColumns: [users.clinicId, users.id],
    }),
    index("visits_queue_idx").on(t.clinicId, t.visitDate, t.status),
    index("visits_patient_idx").on(t.clinicId, t.patientId),
    check(
      "visits_status_check",
      sql`${t.status} IN ('waiting', 'in_triage', 'ready', 'with_doctor', 'completed', 'left', 'cancelled')`,
    ),
  ],
);

export const tasks = appSchema.table(
  "tasks",
  {
    id: id(),
    clinicId: clinicId().references(() => clinics.id, { onDelete: "restrict" }),
    type: varchar("type", { length: 50 }).notNull(),
    priority: varchar("priority", { length: 10 }).notNull().default("normal"),
    title: varchar("title", { length: 300 }).notNull(),
    patientId: uuid("patient_id"),
    status: varchar("status", { length: 10 }).notNull().default("open"),
    createdBy: uuid("created_by"),
    createdAt: createdAt(),
    completedBy: uuid("completed_by"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    index("tasks_open_idx").on(t.clinicId, t.status, t.priority),
    check("tasks_priority_check", sql`${t.priority} IN ('urgent', 'normal')`),
    check("tasks_status_check", sql`${t.status} IN ('open', 'done')`),
  ],
);
