"use server";

import { z } from "zod";
import { clinicAction } from "@/lib/auth/actions";
import {
  booleanField,
  checkbox,
  idField,
  optionalId,
  optionalInt,
  optionalMoney,
  optionalNumber,
  optionalText,
  requiredText,
  stringList,
} from "@/lib/validation";
import { AppError } from "@/lib/errors";
import { importStarterCatalog } from "@/lib/catalog/seed";
import { DRUG_FORMS, PRESET_KINDS, SEVERITIES, VITAL_KEYS } from "./catalog-options";
import {
  ENTRY_KINDS,
  createDrug,
  saveAllergyClass,
  saveDiagnosisCode,
  saveInteraction,
  saveLabTest,
  savePreset,
  saveVitalRange,
  setDiagnosisFavourite,
  setEntryActive,
  updateDrug,
} from "./catalog.service";

// ---------------------------------------------------------------------------
// Medicines (Pharmacist + Clinic Admin)
// ---------------------------------------------------------------------------

export const saveDrugAction = clinicAction(
  {
    name: "catalog.saveDrug",
    permission: "medicine:manage",
    schema: z.object({
      id: optionalId,
      name: requiredText(200, "Name"),
      genericName: requiredText(200, "Generic name"),
      form: z.enum(DRUG_FORMS, { message: "Choose a form" }),
      strength: optionalText(60),
      category: optionalText(80),
      defaultDose: optionalText(60),
      defaultFrequency: optionalText(40),
      defaultDurationDays: optionalInt(1, 365, "Duration"),
      defaultInstructions: optionalText(200),
      price: optionalMoney,
      allergyClassIds: stringList.pipe(z.array(idField)),
    }),
  },
  async ({ session, db, audit }, input) =>
    db(async (tx) => {
      const { id, ...values } = input;
      const row = id ? await updateDrug(tx, session.clinicId, id, values) : await createDrug(tx, session.clinicId, values);
      await audit(tx, { action: id ? "MEDICINE_UPDATED" : "MEDICINE_ADDED", targetType: "drug", targetId: row.id, details: { name: values.name } });
      return row;
    }),
);

export const setDrugActiveAction = clinicAction(
  { name: "catalog.setDrugActive", permission: "medicine:manage", schema: z.object({ id: idField, isActive: booleanField }) },
  async ({ db, audit }, input) =>
    db(async (tx) => {
      await setEntryActive(tx, "drug", input.id, input.isActive);
      await audit(tx, { action: input.isActive ? "MEDICINE_ACTIVATED" : "MEDICINE_DEACTIVATED", targetType: "drug", targetId: input.id });
    }),
);

// ---------------------------------------------------------------------------
// Clinical catalogues (Clinic Admin)
// ---------------------------------------------------------------------------

export const saveAllergyClassAction = clinicAction(
  {
    name: "catalog.saveAllergyClass",
    permission: "catalog:manage",
    schema: z.object({ id: optionalId, name: requiredText(120, "Name"), description: optionalText(500) }),
  },
  async ({ session, db, audit }, input) =>
    db(async (tx) => {
      const row = await saveAllergyClass(tx, session.clinicId, input.id, input);
      await audit(tx, { action: input.id ? "ALLERGY_CLASS_UPDATED" : "ALLERGY_CLASS_ADDED", targetType: "allergy_class", targetId: row.id, details: { name: input.name } });
      return row;
    }),
);

export const saveInteractionAction = clinicAction(
  {
    name: "catalog.saveInteraction",
    permission: "catalog:manage",
    schema: z.object({
      id: optionalId,
      genericA: requiredText(200, "First medicine"),
      genericB: requiredText(200, "Second medicine"),
      severity: z.enum(SEVERITIES),
      description: requiredText(1000, "What happens"),
    }),
  },
  async ({ session, db, audit }, input) =>
    db(async (tx) => {
      const { id, ...values } = input;
      const row = await saveInteraction(tx, session.clinicId, id, values);
      await audit(tx, {
        action: id ? "INTERACTION_RULE_UPDATED" : "INTERACTION_RULE_ADDED",
        targetType: "drug_interaction",
        targetId: row.id,
        details: { pair: `${values.genericA} + ${values.genericB}`, severity: values.severity },
      });
      return row;
    }),
);

export const savePresetAction = clinicAction(
  {
    name: "catalog.savePreset",
    permission: "catalog:manage",
    schema: z.object({
      id: optionalId,
      kind: z.enum(PRESET_KINDS),
      label: requiredText(80, "Label"),
      value: requiredText(120, "Value"),
      sortOrder: optionalInt(0, 999, "Order").transform((v) => v ?? 0),
    }),
  },
  async ({ session, db, audit }, input) =>
    db(async (tx) => {
      const { id, ...values } = input;
      if (values.kind === "duration" && !/^\d{1,3}$/.test(values.value)) {
        throw new AppError("A duration preset's value is a number of days.");
      }
      const row = await savePreset(tx, session.clinicId, id, values);
      await audit(tx, { action: id ? "PRESET_UPDATED" : "PRESET_ADDED", targetType: "preset", targetId: row.id, details: { kind: values.kind, label: values.label } });
      return row;
    }),
);

export const saveDiagnosisCodeAction = clinicAction(
  {
    name: "catalog.saveDiagnosisCode",
    permission: "catalog:manage",
    schema: z.object({
      id: optionalId,
      code: z
        .string({ message: "Code is required" })
        .trim()
        .min(1, "Code is required")
        .max(20)
        .regex(/^[A-Za-z0-9.\-]+$/, "Letters, numbers, dots and hyphens only"),
      label: requiredText(300, "Description"),
      isFavourite: checkbox,
    }),
  },
  async ({ session, db, audit }, input) =>
    db(async (tx) => {
      const { id, ...values } = input;
      const row = await saveDiagnosisCode(tx, session.clinicId, id, values);
      await audit(tx, { action: id ? "DIAGNOSIS_CODE_UPDATED" : "DIAGNOSIS_CODE_ADDED", targetType: "diagnosis_code", targetId: row.id, details: { code: values.code } });
      return row;
    }),
);

export const setDiagnosisFavouriteAction = clinicAction(
  { name: "catalog.setDiagnosisFavourite", permission: "catalog:manage", schema: z.object({ id: idField, isFavourite: booleanField }) },
  async ({ db, audit }, input) =>
    db(async (tx) => {
      await setDiagnosisFavourite(tx, input.id, input.isFavourite);
      await audit(tx, { action: "DIAGNOSIS_FAVOURITE_CHANGED", targetType: "diagnosis_code", targetId: input.id, details: { isFavourite: input.isFavourite } });
    }),
);

const limit = (label: string) => optionalNumber(-1000, 10000, label);

export const saveVitalRangeAction = clinicAction(
  {
    name: "catalog.saveVitalRange",
    permission: "catalog:manage",
    schema: z.object({
      id: optionalId,
      vital: z.enum(VITAL_KEYS),
      ageMinYears: optionalInt(0, 150, "From age").transform((v) => v ?? 0),
      ageMaxYears: optionalInt(0, 150, "To age").transform((v) => v ?? 150),
      low: limit("Low"),
      high: limit("High"),
      criticalLow: limit("Critical low"),
      criticalHigh: limit("Critical high"),
    }),
  },
  async ({ session, db, audit }, input) =>
    db(async (tx) => {
      const { id, ...values } = input;
      const row = await saveVitalRange(tx, session.clinicId, id, values);
      await audit(tx, { action: id ? "VITAL_RANGE_UPDATED" : "VITAL_RANGE_ADDED", targetType: "vital_range", targetId: row.id, details: values });
      return row;
    }),
);

export const saveLabTestAction = clinicAction(
  {
    name: "catalog.saveLabTest",
    permission: "catalog:manage",
    module: "lab",
    schema: z.object({
      id: optionalId,
      name: requiredText(200, "Name"),
      sampleType: optionalText(60),
      unit: optionalText(40),
      referenceRange: optionalText(200),
      price: optionalMoney,
    }),
  },
  async ({ session, db, audit }, input) =>
    db(async (tx) => {
      const { id, ...values } = input;
      const row = await saveLabTest(tx, session.clinicId, id, values);
      await audit(tx, { action: id ? "LAB_TEST_UPDATED" : "LAB_TEST_ADDED", targetType: "lab_test", targetId: row.id, details: { name: values.name } });
      return row;
    }),
);

export const setCatalogEntryActiveAction = clinicAction(
  {
    name: "catalog.setActive",
    permission: "catalog:manage",
    schema: z.object({ kind: z.enum(ENTRY_KINDS.filter((k) => k !== "drug") as [string, ...string[]]), id: idField, isActive: booleanField }),
  },
  async ({ db, audit }, input) =>
    db(async (tx) => {
      await setEntryActive(tx, input.kind as (typeof ENTRY_KINDS)[number], input.id, input.isActive);
      await audit(tx, {
        action: input.isActive ? "CATALOG_ENTRY_ACTIVATED" : "CATALOG_ENTRY_DEACTIVATED",
        targetType: input.kind,
        targetId: input.id,
      });
    }),
);

/** Adds starter entries the clinic does not have yet; never touches its own edits. */
export const importStarterAction = clinicAction(
  { name: "catalog.importStarter", permission: "catalog:manage", schema: z.object({}) },
  async ({ session, db, audit }) =>
    db(async (tx) => {
      const added = await importStarterCatalog(tx, session.clinicId);
      await audit(tx, { action: "STARTER_CATALOG_IMPORTED", targetType: "catalog", details: added });
      return added;
    }),
);
