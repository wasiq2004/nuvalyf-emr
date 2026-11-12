// Inpatient care (module "inpatient", docs/INPATIENT_DESIGN.md): beds, an
// admission's stays, its running bill and the discharge summary. An admission
// keeps one open consultation, so vitals, notes, lab tests and the discharge
// prescription use the same screens as outpatient care.
import { boolean, check, foreignKey, index, integer, jsonb, numeric, timestamp, unique, uniqueIndex, uuid, varchar, text } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { appSchema, clinicId, createdAt, id, updatedAt } from "./_shared";
import { encryptedJson } from "./_encrypted";
import { clinics } from "./platform";
import { users } from "./identity";
import { patients, visits } from "./frontdesk";
import { encounters } from "./clinical";

const money = (name: string) => numeric(name, { precision: 12, scale: 2 });

/** One row per clinic; defaults apply until the Clinic Admin saves. */
export const inpatientSettings = appSchema.table(
  "inpatient_settings",
  {
    clinicId: uuid("clinic_id")
      .primaryKey()
      .references(() => clinics.id, { onDelete: "restrict" }),
    /** hourly: exact hours at rate / 24. block: whole 24-hour blocks, rounded up. */
    billingMode: varchar("billing_mode", { length: 10 }).notNull().default("hourly"),
    minimumHours: integer("minimum_hours").notNull().default(24),
    /** Discharge summary sections in print order, the clinic's own included. */
    summarySections: jsonb("summary_sections"),
    updatedBy: uuid("updated_by"),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("inpatient_settings_mode_check", sql`${t.billingMode} IN ('hourly', 'block')`),
    check("inpatient_settings_minimum_check", sql`${t.minimumHours} BETWEEN 0 AND 240`),
  ],
);

export const bedCategories = appSchema.table(
  "bed_categories",
  {
    id: id(),
    clinicId: clinicId().references(() => clinics.id, { onDelete: "restrict" }),
    name: varchar("name", { length: 80 }).notNull(),
    dailyRate: money("daily_rate").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    unique("bed_categories_clinic_id_id_key").on(t.clinicId, t.id),
    uniqueIndex("bed_categories_name_idx").on(t.clinicId, t.name),
    check("bed_categories_rate_check", sql`${t.dailyRate} >= 0`),
  ],
);

export const beds = appSchema.table(
  "beds",
  {
    id: id(),
    clinicId: clinicId().references(() => clinics.id, { onDelete: "restrict" }),
    categoryId: uuid("category_id").notNull(),
    ward: varchar("ward", { length: 80 }),
    code: varchar("code", { length: 30 }).notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    unique("beds_clinic_id_id_key").on(t.clinicId, t.id),
    uniqueIndex("beds_code_idx").on(t.clinicId, t.code),
    foreignKey({ name: "beds_category_fk", columns: [t.clinicId, t.categoryId], foreignColumns: [bedCategories.clinicId, bedCategories.id] }),
  ],
);

export const admissions = appSchema.table(
  "admissions",
  {
    id: id(),
    clinicId: clinicId().references(() => clinics.id, { onDelete: "restrict" }),
    /** IP/2627/000001 */
    number: varchar("number", { length: 30 }).notNull(),
    patientId: uuid("patient_id").notNull(),
    visitId: uuid("visit_id").notNull(),
    encounterId: uuid("encounter_id").notNull(),
    doctorId: uuid("doctor_id").notNull(),
    reason: varchar("reason", { length: 500 }).notNull(),
    attendantName: varchar("attendant_name", { length: 120 }),
    attendantPhone: varchar("attendant_phone", { length: 20 }),
    status: varchar("status", { length: 15 }).notNull().default("admitted"),
    admittedAt: timestamp("admitted_at", { withTimezone: true }).notNull(),
    dischargedAt: timestamp("discharged_at", { withTimezone: true }),
    dischargedBy: uuid("discharged_by"),
    /** The billing rule at admission: changing the setting never reprices a stay. */
    billingMode: varchar("billing_mode", { length: 10 }).notNull(),
    minimumHours: integer("minimum_hours").notNull(),
    discount: money("discount").notNull().default("0"),
    discountReason: varchar("discount_reason", { length: 300 }),
    discountBy: uuid("discount_by"),
    createdBy: uuid("created_by").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("admissions_clinic_id_id_key").on(t.clinicId, t.id),
    uniqueIndex("admissions_number_idx").on(t.clinicId, t.number),
    uniqueIndex("admissions_open_patient_idx").on(t.clinicId, t.patientId).where(sql`${t.status} = 'admitted'`),
    uniqueIndex("admissions_visit_idx").on(t.visitId),
    foreignKey({ name: "admissions_patient_fk", columns: [t.clinicId, t.patientId], foreignColumns: [patients.clinicId, patients.id] }),
    foreignKey({ name: "admissions_visit_fk", columns: [t.clinicId, t.visitId], foreignColumns: [visits.clinicId, visits.id] }),
    foreignKey({ name: "admissions_encounter_fk", columns: [t.clinicId, t.encounterId], foreignColumns: [encounters.clinicId, encounters.id] }),
    foreignKey({ name: "admissions_doctor_fk", columns: [t.clinicId, t.doctorId], foreignColumns: [users.clinicId, users.id] }),
    index("admissions_status_idx").on(t.clinicId, t.status, t.admittedAt),
    index("admissions_patient_idx").on(t.clinicId, t.patientId),
    check("admissions_status_check", sql`${t.status} IN ('admitted', 'discharged')`),
    check("admissions_mode_check", sql`${t.billingMode} IN ('hourly', 'block')`),
    check("admissions_discount_check", sql`${t.discount} >= 0`),
    check("admissions_discharge_check", sql`(${t.status} = 'admitted' AND ${t.dischargedAt} IS NULL) OR (${t.status} = 'discharged' AND ${t.dischargedAt} >= ${t.admittedAt})`),
  ],
);

/** Each bed the patient has been in; the rate is copied in when the stay starts. */
export const bedStays = appSchema.table(
  "bed_stays",
  {
    id: id(),
    clinicId: clinicId(),
    admissionId: uuid("admission_id").notNull(),
    bedId: uuid("bed_id").notNull(),
    bedLabel: varchar("bed_label", { length: 120 }).notNull(),
    categoryName: varchar("category_name", { length: 80 }).notNull(),
    dailyRate: money("daily_rate").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    /** An authorised change to the bill, with its reason. */
    overrideHours: integer("override_hours"),
    overrideRate: money("override_rate"),
    overrideReason: varchar("override_reason", { length: 300 }),
    overrideBy: uuid("override_by"),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({ name: "bed_stays_admission_fk", columns: [t.clinicId, t.admissionId], foreignColumns: [admissions.clinicId, admissions.id] }),
    foreignKey({ name: "bed_stays_bed_fk", columns: [t.clinicId, t.bedId], foreignColumns: [beds.clinicId, beds.id] }),
    index("bed_stays_admission_idx").on(t.admissionId),
    uniqueIndex("bed_stays_open_bed_idx").on(t.clinicId, t.bedId).where(sql`${t.endedAt} IS NULL`),
    uniqueIndex("bed_stays_open_admission_idx").on(t.clinicId, t.admissionId).where(sql`${t.endedAt} IS NULL`),
    check("bed_stays_range_check", sql`${t.endedAt} IS NULL OR ${t.endedAt} >= ${t.startedAt}`),
    check("bed_stays_override_check", sql`(${t.overrideHours} IS NULL AND ${t.overrideRate} IS NULL) OR ${t.overrideReason} IS NOT NULL`),
  ],
);

/** Everything on the bill besides the bed. A return is a negative line. */
export const admissionCharges = appSchema.table(
  "admission_charges",
  {
    id: id(),
    clinicId: clinicId(),
    admissionId: uuid("admission_id").notNull(),
    kind: varchar("kind", { length: 15 }).notNull(),
    description: varchar("description", { length: 300 }).notNull(),
    quantity: integer("quantity").notNull().default(1),
    unitAmount: money("unit_amount").notNull(),
    amount: money("amount").notNull(),
    /** The pharmacy sale, credit note or lab order behind an automatic line. */
    sourceType: varchar("source_type", { length: 20 }),
    sourceId: uuid("source_id"),
    createdBy: uuid("created_by").notNull(),
    createdAt: createdAt(),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    voidedBy: uuid("voided_by"),
    voidReason: varchar("void_reason", { length: 300 }),
  },
  (t) => [
    foreignKey({ name: "admission_charges_admission_fk", columns: [t.clinicId, t.admissionId], foreignColumns: [admissions.clinicId, admissions.id] }),
    index("admission_charges_admission_idx").on(t.admissionId),
    uniqueIndex("admission_charges_source_idx").on(t.clinicId, t.sourceType, t.sourceId),
    check("admission_charges_kind_check", sql`${t.kind} IN ('doctor', 'nursing', 'procedure', 'lab', 'pharmacy', 'other')`),
    check("admission_charges_amount_check", sql`${t.amount} = ${t.unitAmount} * ${t.quantity}`),
    check("admission_charges_quantity_check", sql`${t.quantity} > 0`),
    check("admission_charges_void_check", sql`${t.voidedAt} IS NULL OR ${t.voidReason} IS NOT NULL`),
  ],
);

/** Advances, part payments and refunds. Append-only. */
export const admissionPayments = appSchema.table(
  "admission_payments",
  {
    id: id(),
    clinicId: clinicId(),
    admissionId: uuid("admission_id").notNull(),
    /** IR/2627/000001 */
    number: varchar("number", { length: 30 }).notNull(),
    kind: varchar("kind", { length: 10 }).notNull(),
    amount: money("amount").notNull(),
    method: varchar("method", { length: 10 }).notNull(),
    reference: varchar("reference", { length: 100 }),
    note: varchar("note", { length: 300 }),
    idempotencyKey: varchar("idempotency_key", { length: 64 }).notNull(),
    receivedBy: uuid("received_by").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ name: "admission_payments_admission_fk", columns: [t.clinicId, t.admissionId], foreignColumns: [admissions.clinicId, admissions.id] }),
    uniqueIndex("admission_payments_number_idx").on(t.clinicId, t.number),
    uniqueIndex("admission_payments_idempotency_idx").on(t.clinicId, t.idempotencyKey),
    index("admission_payments_admission_idx").on(t.admissionId),
    index("admission_payments_received_idx").on(t.clinicId, t.receivedAt),
    check("admission_payments_kind_check", sql`${t.kind} IN ('advance', 'payment', 'refund')`),
    check("admission_payments_amount_check", sql`${t.amount} > 0`),
    check("admission_payments_method_check", sql`${t.method} IN ('cash', 'upi', 'card', 'other')`),
  ],
);

/** Drafted from the record, edited by the doctor, locked on signing. */
export const dischargeSummaries = appSchema.table(
  "discharge_summaries",
  {
    id: id(),
    clinicId: clinicId(),
    admissionId: uuid("admission_id").notNull(),
    status: varchar("status", { length: 10 }).notNull().default("draft"),
    /** [{ key, title, body }] in print order. Encrypted in the application. */
    sections: encryptedJson<unknown>("discharge_summaries", "sections").notNull(),
    signedBy: uuid("signed_by"),
    signedByName: varchar("signed_by_name", { length: 200 }),
    signedRegistration: text("signed_registration"),
    signedAt: timestamp("signed_at", { withTimezone: true }),
    createdBy: uuid("created_by").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({ name: "discharge_summaries_admission_fk", columns: [t.clinicId, t.admissionId], foreignColumns: [admissions.clinicId, admissions.id] }),
    uniqueIndex("discharge_summaries_admission_idx").on(t.admissionId),
    check("discharge_summaries_status_check", sql`${t.status} IN ('draft', 'signed')`),
  ],
);
