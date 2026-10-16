// Clinic-owned catalogues. Every clinic gets a copy of the starter lists
// (lib/catalog/starter) and can add, edit or deactivate any entry. Rows that
// came from the starter list keep their `starter_key`, so importing newer
// starter entries never duplicates or resurrects anything.
import { boolean, check, foreignKey, integer, numeric, primaryKey, text, unique, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { appSchema, clinicId, createdAt, id, updatedAt } from "./_shared";
import { clinics } from "./platform";

export const drugs = appSchema.table(
  "drugs",
  {
    id: id(),
    clinicId: clinicId().references(() => clinics.id, { onDelete: "restrict" }),
    starterKey: varchar("starter_key", { length: 80 }),
    name: varchar("name", { length: 200 }).notNull(),
    genericName: varchar("generic_name", { length: 200 }).notNull(),
    form: varchar("form", { length: 30 }).notNull(),
    strength: varchar("strength", { length: 60 }),
    category: varchar("category", { length: 80 }),
    defaultDose: varchar("default_dose", { length: 60 }),
    defaultFrequency: varchar("default_frequency", { length: 40 }),
    defaultDurationDays: integer("default_duration_days"),
    defaultInstructions: varchar("default_instructions", { length: 200 }),
    /** Selling price per unit (pharmacy module). */
    price: numeric("price", { precision: 10, scale: 2 }),
    /** Alert when stock on hand falls to this level (pharmacy module). */
    reorderLevel: integer("reorder_level").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("drugs_clinic_id_id_key").on(t.clinicId, t.id),
    uniqueIndex("drugs_clinic_starter_idx").on(t.clinicId, t.starterKey),
    check("drugs_form_check", sql`${t.form} IN ('tablet', 'capsule', 'syrup', 'suspension', 'injection', 'ointment', 'cream', 'drops', 'inhaler', 'sachet', 'gel', 'other')`),
  ],
);

export const allergyClasses = appSchema.table(
  "allergy_classes",
  {
    id: id(),
    clinicId: clinicId().references(() => clinics.id, { onDelete: "restrict" }),
    starterKey: varchar("starter_key", { length: 80 }),
    name: varchar("name", { length: 120 }).notNull(),
    description: text("description"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    unique("allergy_classes_clinic_id_id_key").on(t.clinicId, t.id),
    uniqueIndex("allergy_classes_clinic_starter_idx").on(t.clinicId, t.starterKey),
  ],
);

export const drugAllergyClasses = appSchema.table(
  "drug_allergy_classes",
  {
    clinicId: clinicId(),
    drugId: uuid("drug_id").notNull(),
    allergyClassId: uuid("allergy_class_id").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.drugId, t.allergyClassId] }),
    foreignKey({ name: "dac_drug_fk", columns: [t.clinicId, t.drugId], foreignColumns: [drugs.clinicId, drugs.id] }).onDelete("cascade"),
    foreignKey({
      name: "dac_class_fk",
      columns: [t.clinicId, t.allergyClassId],
      foreignColumns: [allergyClasses.clinicId, allergyClasses.id],
    }).onDelete("cascade"),
  ],
);

/** Interaction rules between generic names, so every brand is covered. */
export const drugInteractions = appSchema.table(
  "drug_interactions",
  {
    id: id(),
    clinicId: clinicId().references(() => clinics.id, { onDelete: "restrict" }),
    starterKey: varchar("starter_key", { length: 120 }),
    genericA: varchar("generic_a", { length: 200 }).notNull(),
    genericB: varchar("generic_b", { length: 200 }).notNull(),
    severity: varchar("severity", { length: 20 }).notNull(),
    description: text("description").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("drug_interactions_clinic_starter_idx").on(t.clinicId, t.starterKey),
    check("drug_interactions_severity_check", sql`${t.severity} IN ('minor', 'moderate', 'major', 'contraindicated')`),
  ],
);

/** Frequency / duration / instruction shortcuts shown while prescribing. */
export const prescribingPresets = appSchema.table(
  "prescribing_presets",
  {
    id: id(),
    clinicId: clinicId().references(() => clinics.id, { onDelete: "restrict" }),
    starterKey: varchar("starter_key", { length: 80 }),
    kind: varchar("kind", { length: 20 }).notNull(),
    label: varchar("label", { length: 80 }).notNull(),
    value: varchar("value", { length: 120 }).notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
  },
  (t) => [
    uniqueIndex("prescribing_presets_clinic_starter_idx").on(t.clinicId, t.starterKey),
    check("prescribing_presets_kind_check", sql`${t.kind} IN ('frequency', 'duration', 'instruction')`),
  ],
);

/** Diagnosis codes a clinic uses: starter subset of WHO ICD-10 plus its own. */
export const diagnosisCodes = appSchema.table(
  "diagnosis_codes",
  {
    id: id(),
    clinicId: clinicId().references(() => clinics.id, { onDelete: "restrict" }),
    starterKey: varchar("starter_key", { length: 40 }),
    code: varchar("code", { length: 20 }).notNull(),
    label: varchar("label", { length: 300 }).notNull(),
    isFavourite: boolean("is_favourite").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("diagnosis_codes_clinic_code_idx").on(t.clinicId, sql`upper(${t.code})`),
    uniqueIndex("diagnosis_codes_clinic_starter_idx").on(t.clinicId, t.starterKey),
  ],
);

/** Age-banded reference ranges; vitals are flagged against these on the server. */
export const vitalRanges = appSchema.table(
  "vital_ranges",
  {
    id: id(),
    clinicId: clinicId().references(() => clinics.id, { onDelete: "restrict" }),
    starterKey: varchar("starter_key", { length: 80 }),
    vital: varchar("vital", { length: 30 }).notNull(),
    ageMinYears: integer("age_min_years").notNull().default(0),
    ageMaxYears: integer("age_max_years").notNull().default(150),
    low: numeric("low", { precision: 7, scale: 2 }),
    high: numeric("high", { precision: 7, scale: 2 }),
    criticalLow: numeric("critical_low", { precision: 7, scale: 2 }),
    criticalHigh: numeric("critical_high", { precision: 7, scale: 2 }),
    isActive: boolean("is_active").notNull().default(true),
  },
  (t) => [
    uniqueIndex("vital_ranges_clinic_starter_idx").on(t.clinicId, t.starterKey),
    check(
      "vital_ranges_vital_check",
      sql`${t.vital} IN ('temperature_c', 'systolic', 'diastolic', 'pulse', 'resp_rate', 'spo2', 'weight_kg', 'height_cm')`,
    ),
    check("vital_ranges_age_check", sql`${t.ageMaxYears} >= ${t.ageMinYears}`),
  ],
);

export const labTests = appSchema.table(
  "lab_tests",
  {
    id: id(),
    clinicId: clinicId().references(() => clinics.id, { onDelete: "restrict" }),
    starterKey: varchar("starter_key", { length: 80 }),
    name: varchar("name", { length: 200 }).notNull(),
    sampleType: varchar("sample_type", { length: 60 }),
    unit: varchar("unit", { length: 40 }),
    referenceRange: varchar("reference_range", { length: 200 }),
    price: numeric("price", { precision: 10, scale: 2 }),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    unique("lab_tests_clinic_id_id_key").on(t.clinicId, t.id),
    uniqueIndex("lab_tests_clinic_starter_idx").on(t.clinicId, t.starterKey),
  ],
);
