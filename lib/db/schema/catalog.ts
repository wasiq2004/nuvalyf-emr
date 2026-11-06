// Clinic-owned catalogues. Every clinic gets a copy of the starter lists
// (lib/catalog/starter) and can add, edit or deactivate any entry. Rows that
// came from the starter list keep their `starter_key`, so importing newer
// starter entries never duplicates or resurrects anything.
import { boolean, check, foreignKey, index, integer, numeric, primaryKey, text, unique, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { appSchema, clinicId, createdAt, id, updatedAt } from "./_shared";
import { clinics } from "./platform";

export const drugs = appSchema.table(
  "drugs",
  {
    id: id(),
    clinicId: clinicId().references(() => clinics.id, { onDelete: "restrict" }),
    starterKey: varchar("starter_key", { length: 80 }),
    /** The shared Indian medicine list entry it was added from (ref.medicines.id). */
    referenceId: integer("reference_id"),
    /** medicine (prescribable), consumable (needles, gauze) or instrument. */
    itemType: varchar("item_type", { length: 20 }).notNull().default("medicine"),
    name: varchar("name", { length: 200 }).notNull(),
    manufacturer: varchar("manufacturer", { length: 120 }),
    /** Units in one pack as suppliers sell it (a strip of 10 = 10); pre-fills bills. */
    packSize: integer("pack_size").notNull().default(1),
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
    /** Selling price per pack (a strip's MRP). Empty: units x unit price. */
    packPrice: numeric("pack_price", { precision: 10, scale: 2 }),
    /** GST: HSN code and rate; empty = the pharmacy's defaults for medicines. */
    hsn: varchar("hsn", { length: 8 }),
    gstRate: numeric("gst_rate", { precision: 5, scale: 2 }),
    /** Drugs and Cosmetics Rules schedule: none, G, H, H1 or X. */
    schedule: varchar("schedule", { length: 5 }).notNull().default("none"),
    /** Where it sits in the pharmacy, e.g. "A3". */
    rack: varchar("rack", { length: 40 }),
    /** Printed or manufacturer barcode; unique in the clinic. */
    barcode: varchar("barcode", { length: 64 }),
    /** Alert when stock on hand falls to this level (pharmacy module). */
    reorderLevel: integer("reorder_level").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("drugs_clinic_id_id_key").on(t.clinicId, t.id),
    uniqueIndex("drugs_clinic_starter_idx").on(t.clinicId, t.starterKey),
    uniqueIndex("drugs_clinic_reference_idx").on(t.clinicId, t.referenceId),
    uniqueIndex("drugs_clinic_barcode_idx").on(t.clinicId, t.barcode),
    check("drugs_form_check", sql`${t.form} IN ('tablet', 'capsule', 'syrup', 'suspension', 'injection', 'ointment', 'cream', 'drops', 'inhaler', 'sachet', 'gel', 'other')`),
    check("drugs_item_type_check", sql`${t.itemType} IN ('medicine', 'consumable', 'instrument')`),
    check("drugs_pack_size_check", sql`${t.packSize} BETWEEN 1 AND 10000`),
    check("drugs_schedule_check", sql`${t.schedule} IN ('none', 'G', 'H', 'H1', 'X')`),
    check("drugs_gst_rate_check", sql`${t.gstRate} IS NULL OR ${t.gstRate} BETWEEN 0 AND 40`),
  ],
);

/**
 * Other names an item is known by: a supplier's spelling, another company's
 * brand of the same product. Learned when a person confirms a match on a
 * supplier bill or listed in an import; matching uses `normalized`
 * (features/catalog/item-rules.ts), which is unique in a clinic.
 */
export const drugAliases = appSchema.table(
  "drug_aliases",
  {
    id: id(),
    clinicId: clinicId(),
    drugId: uuid("drug_id").notNull(),
    alias: varchar("alias", { length: 200 }).notNull(),
    normalized: varchar("normalized", { length: 200 }).notNull(),
    manufacturer: varchar("manufacturer", { length: 120 }),
    createdBy: uuid("created_by").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({ name: "drug_aliases_drug_fk", columns: [t.clinicId, t.drugId], foreignColumns: [drugs.clinicId, drugs.id] }),
    uniqueIndex("drug_aliases_normalized_idx").on(t.clinicId, t.normalized),
    index("drug_aliases_drug_idx").on(t.clinicId, t.drugId),
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

/**
 * What a test reports: one row per parameter (Haemoglobin, Platelets...).
 * A test with no parameters takes a single free-text result.
 */
export const labTestParameters = appSchema.table(
  "lab_test_parameters",
  {
    id: id(),
    clinicId: clinicId().references(() => clinics.id, { onDelete: "restrict" }),
    testId: uuid("test_id").notNull(),
    starterKey: varchar("starter_key", { length: 80 }),
    name: varchar("name", { length: 120 }).notNull(),
    /** Heading on the report, e.g. "Differential count". */
    section: varchar("section", { length: 80 }),
    unit: varchar("unit", { length: 40 }),
    /** number: checked against ranges. text: a word, checked against normalText. */
    valueType: varchar("value_type", { length: 10 }).notNull().default("number"),
    normalText: varchar("normal_text", { length: 60 }),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    unique("lab_test_parameters_clinic_id_id_key").on(t.clinicId, t.id),
    uniqueIndex("lab_test_parameters_starter_idx").on(t.clinicId, t.starterKey),
    foreignKey({ name: "lab_test_parameters_test_fk", columns: [t.clinicId, t.testId], foreignColumns: [labTests.clinicId, labTests.id] }),
    index("lab_test_parameters_test_idx").on(t.testId),
    check("lab_test_parameters_type_check", sql`${t.valueType} IN ('number', 'text')`),
  ],
);

/** Reference and critical limits by sex and age band; each clinic sets its own. */
export const labParameterRanges = appSchema.table(
  "lab_parameter_ranges",
  {
    id: id(),
    clinicId: clinicId().references(() => clinics.id, { onDelete: "restrict" }),
    parameterId: uuid("parameter_id").notNull(),
    sex: varchar("sex", { length: 10 }).notNull().default("any"),
    ageMinYears: integer("age_min_years").notNull().default(0),
    /** Null = no upper age limit. */
    ageMaxYears: integer("age_max_years"),
    low: numeric("low", { precision: 14, scale: 4 }),
    high: numeric("high", { precision: 14, scale: 4 }),
    criticalLow: numeric("critical_low", { precision: 14, scale: 4 }),
    criticalHigh: numeric("critical_high", { precision: 14, scale: 4 }),
  },
  (t) => [
    foreignKey({ name: "lab_parameter_ranges_parameter_fk", columns: [t.clinicId, t.parameterId], foreignColumns: [labTestParameters.clinicId, labTestParameters.id] }).onDelete("cascade"),
    index("lab_parameter_ranges_parameter_idx").on(t.parameterId),
    check("lab_parameter_ranges_sex_check", sql`${t.sex} IN ('any', 'male', 'female')`),
    check("lab_parameter_ranges_age_check", sql`${t.ageMaxYears} IS NULL OR ${t.ageMaxYears} >= ${t.ageMinYears}`),
  ],
);
