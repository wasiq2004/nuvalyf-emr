import "server-only";

// The clinic's own catalogues (decision D6): medicines, allergy classes,
// interaction rules, prescribing presets, diagnosis codes, vital ranges and
// lab tests. Entries are deactivated, never deleted, so signed prescriptions
// and past orders keep pointing at real rows.
import { and, asc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import {
  allergyClasses,
  diagnosisCodes,
  drugAllergyClasses,
  drugInteractions,
  drugs,
  labTests,
  prescribingPresets,
  vitalRanges,
} from "@/lib/db/schema";
import { AppError, isUniqueViolation } from "@/lib/errors";
import type { ItemType } from "./item-rules";
import { aliasesFor } from "./items.service";

const money = (v: string | undefined) => (v === undefined ? null : v);
const decimal = (v: number | null | undefined) => (v === null || v === undefined ? null : String(v));

// ---------------------------------------------------------------------------
// Medicines
// ---------------------------------------------------------------------------

export type DrugInput = {
  name: string;
  /** Default medicine. */
  itemType?: ItemType;
  /** Optional for consumables and instruments (the name is used). */
  genericName?: string;
  form: string;
  manufacturer?: string;
  /** Default 1. */
  packSize?: number;
  strength?: string;
  category?: string;
  defaultDose?: string;
  defaultFrequency?: string;
  defaultDurationDays: number | null;
  defaultInstructions?: string;
  price?: string;
  /** Price of a whole pack (a strip's MRP). */
  packPrice?: string;
  allergyClassIds: string[];
};

export async function listDrugs(tx: Tx, query: string) {
  const term = query.trim().replace(/[%_\\]/g, "");
  const where: SQL | undefined = term
    ? or(
        ilike(drugs.name, `%${term}%`),
        ilike(drugs.genericName, `%${term}%`),
        ilike(drugs.category, `%${term}%`),
        ilike(drugs.manufacturer, `%${term}%`),
        sql`exists (select 1 from app.drug_aliases a where a.drug_id = ${drugs.id} and a.alias ilike ${`%${term}%`})`,
      )
    : undefined;
  const rows = await tx.select().from(drugs).where(where).orderBy(sql`${drugs.isActive} desc`, asc(drugs.name));
  const aliases = await aliasesFor(tx, rows.map((r) => r.id));
  const links = rows.length
    ? await tx
        .select({ drugId: drugAllergyClasses.drugId, id: allergyClasses.id, name: allergyClasses.name })
        .from(drugAllergyClasses)
        .innerJoin(allergyClasses, eq(allergyClasses.id, drugAllergyClasses.allergyClassId))
        .where(inArray(drugAllergyClasses.drugId, rows.map((r) => r.id)))
    : [];
  return rows.map((r) => ({
    ...r,
    classes: links.filter((l) => l.drugId === r.id).map((l) => ({ id: l.id, name: l.name })),
    aliases: aliases.get(r.id) ?? [],
  }));
}

async function setDrugClasses(tx: Tx, clinicId: string, drugId: string, classIds: string[]) {
  await tx.delete(drugAllergyClasses).where(eq(drugAllergyClasses.drugId, drugId));
  if (classIds.length) {
    await tx.insert(drugAllergyClasses).values([...new Set(classIds)].map((allergyClassId) => ({ clinicId, drugId, allergyClassId })));
  }
}

function drugValues(input: DrugInput) {
  const itemType = input.itemType ?? "medicine";
  const medicine = itemType === "medicine";
  if (medicine && !input.genericName) throw new AppError("A medicine needs its generic name.");
  return {
    name: input.name,
    itemType,
    genericName: input.genericName || input.name,
    form: input.form,
    manufacturer: input.manufacturer ?? null,
    packSize: input.packSize ?? 1,
    strength: input.strength ?? null,
    category: input.category ?? null,
    // Prescribing defaults only mean something for medicines.
    defaultDose: medicine ? (input.defaultDose ?? null) : null,
    defaultFrequency: medicine ? (input.defaultFrequency ?? null) : null,
    defaultDurationDays: medicine ? input.defaultDurationDays : null,
    defaultInstructions: medicine ? (input.defaultInstructions ?? null) : null,
    price: money(input.price),
    packPrice: (input.packSize ?? 1) > 1 ? money(input.packPrice) : null,
  };
}

export async function createDrug(tx: Tx, clinicId: string, input: DrugInput) {
  const [row] = await tx.insert(drugs).values({ clinicId, ...drugValues(input) }).returning({ id: drugs.id });
  await setDrugClasses(tx, clinicId, row.id, (input.itemType ?? "medicine") === "medicine" ? input.allergyClassIds : []);
  return row;
}

export async function updateDrug(tx: Tx, clinicId: string, id: string, input: DrugInput) {
  const [row] = await tx
    .update(drugs)
    .set({ ...drugValues(input), updatedAt: new Date() })
    .where(eq(drugs.id, id))
    .returning({ id: drugs.id });
  if (!row) throw new AppError("Medicine not found.");
  await setDrugClasses(tx, clinicId, id, (input.itemType ?? "medicine") === "medicine" ? input.allergyClassIds : []);
  return row;
}

// ---------------------------------------------------------------------------
// Allergy classes
// ---------------------------------------------------------------------------

export function listAllergyClasses(tx: Tx) {
  return tx.select().from(allergyClasses).orderBy(sql`${allergyClasses.isActive} desc`, asc(allergyClasses.name));
}

export async function saveAllergyClass(tx: Tx, clinicId: string, id: string | null, input: { name: string; description?: string }) {
  const values = { name: input.name, description: input.description ?? null };
  if (id) {
    const [row] = await tx.update(allergyClasses).set(values).where(eq(allergyClasses.id, id)).returning({ id: allergyClasses.id });
    if (!row) throw new AppError("Allergy class not found.");
    return row;
  }
  const [row] = await tx.insert(allergyClasses).values({ clinicId, ...values }).returning({ id: allergyClasses.id });
  return row;
}

// ---------------------------------------------------------------------------
// Interaction rules
// ---------------------------------------------------------------------------

export function listInteractions(tx: Tx) {
  return tx
    .select()
    .from(drugInteractions)
    .orderBy(sql`${drugInteractions.isActive} desc`, asc(drugInteractions.genericA), asc(drugInteractions.genericB));
}

export async function saveInteraction(
  tx: Tx,
  clinicId: string,
  id: string | null,
  input: { genericA: string; genericB: string; severity: string; description: string },
) {
  if (input.genericA.trim().toLowerCase() === input.genericB.trim().toLowerCase()) {
    throw new AppError("An interaction needs two different medicines.");
  }
  const values = { ...input, updatedAt: new Date() };
  if (id) {
    const [row] = await tx.update(drugInteractions).set(values).where(eq(drugInteractions.id, id)).returning({ id: drugInteractions.id });
    if (!row) throw new AppError("Interaction rule not found.");
    return row;
  }
  const [row] = await tx.insert(drugInteractions).values({ clinicId, ...values }).returning({ id: drugInteractions.id });
  return row;
}

/** Generic names in the medicine list, offered when writing interaction rules. */
export async function listGenericNames(tx: Tx) {
  const rows = await tx.selectDistinct({ name: drugs.genericName }).from(drugs).orderBy(asc(drugs.genericName));
  const parts = new Set<string>();
  for (const r of rows) for (const p of r.name.split(/\s*\+\s*/)) if (p) parts.add(p);
  return [...parts].sort((a, b) => a.localeCompare(b));
}

// ---------------------------------------------------------------------------
// Prescribing presets
// ---------------------------------------------------------------------------

export function listPresetsForEdit(tx: Tx) {
  return tx
    .select()
    .from(prescribingPresets)
    .orderBy(asc(prescribingPresets.kind), sql`${prescribingPresets.isActive} desc`, asc(prescribingPresets.sortOrder), asc(prescribingPresets.label));
}

export async function savePreset(
  tx: Tx,
  clinicId: string,
  id: string | null,
  input: { kind: string; label: string; value: string; sortOrder: number },
) {
  if (id) {
    const [row] = await tx.update(prescribingPresets).set(input).where(eq(prescribingPresets.id, id)).returning({ id: prescribingPresets.id });
    if (!row) throw new AppError("Preset not found.");
    return row;
  }
  const [row] = await tx.insert(prescribingPresets).values({ clinicId, ...input }).returning({ id: prescribingPresets.id });
  return row;
}

// ---------------------------------------------------------------------------
// Diagnosis codes
// ---------------------------------------------------------------------------

export function listDiagnosisCodes(tx: Tx, query: string) {
  const term = query.trim().replace(/[%_\\]/g, "");
  const where = term ? or(ilike(diagnosisCodes.code, `${term}%`), ilike(diagnosisCodes.label, `%${term}%`)) : undefined;
  return tx
    .select()
    .from(diagnosisCodes)
    .where(where)
    .orderBy(sql`${diagnosisCodes.isActive} desc`, sql`${diagnosisCodes.isFavourite} desc`, asc(diagnosisCodes.code));
}

export async function saveDiagnosisCode(
  tx: Tx,
  clinicId: string,
  id: string | null,
  input: { code: string; label: string; isFavourite: boolean },
) {
  const values = { code: input.code.trim().toUpperCase(), label: input.label, isFavourite: input.isFavourite };
  try {
    if (id) {
      const [row] = await tx.update(diagnosisCodes).set(values).where(eq(diagnosisCodes.id, id)).returning({ id: diagnosisCodes.id });
      if (!row) throw new AppError("Code not found.");
      return row;
    }
    const [row] = await tx.insert(diagnosisCodes).values({ clinicId, ...values }).returning({ id: diagnosisCodes.id });
    return row;
  } catch (error) {
    if (isUniqueViolation(error)) throw new AppError(`The code ${values.code} is already in the list.`);
    throw error;
  }
}

export async function setDiagnosisFavourite(tx: Tx, id: string, isFavourite: boolean) {
  const [row] = await tx.update(diagnosisCodes).set({ isFavourite }).where(eq(diagnosisCodes.id, id)).returning({ id: diagnosisCodes.id });
  if (!row) throw new AppError("Code not found.");
}

// ---------------------------------------------------------------------------
// Vital ranges
// ---------------------------------------------------------------------------

export function listVitalRanges(tx: Tx) {
  return tx
    .select()
    .from(vitalRanges)
    .orderBy(asc(vitalRanges.vital), sql`${vitalRanges.isActive} desc`, asc(vitalRanges.ageMinYears));
}

export type VitalRangeInput = {
  vital: string;
  ageMinYears: number;
  ageMaxYears: number;
  low: number | null;
  high: number | null;
  criticalLow: number | null;
  criticalHigh: number | null;
};

/** Ordered critical-low ≤ low < high ≤ critical-high, where given. */
export function validateVitalRange(input: VitalRangeInput): string | null {
  if (input.ageMaxYears < input.ageMinYears) return "The age band ends before it starts.";
  const ordered = [input.criticalLow, input.low, input.high, input.criticalHigh].filter((v): v is number => v !== null);
  for (let i = 1; i < ordered.length; i++) {
    if (ordered[i] < ordered[i - 1]) return "Limits must run critical low ≤ low < high ≤ critical high.";
  }
  if (input.low !== null && input.high !== null && input.low >= input.high) return "Low must be below high.";
  if (ordered.length === 0) return "Set at least one limit.";
  return null;
}

export async function saveVitalRange(tx: Tx, clinicId: string, id: string | null, input: VitalRangeInput) {
  const problem = validateVitalRange(input);
  if (problem) throw new AppError(problem);
  const values = {
    vital: input.vital,
    ageMinYears: input.ageMinYears,
    ageMaxYears: input.ageMaxYears,
    low: decimal(input.low),
    high: decimal(input.high),
    criticalLow: decimal(input.criticalLow),
    criticalHigh: decimal(input.criticalHigh),
  };
  if (id) {
    const [row] = await tx.update(vitalRanges).set(values).where(eq(vitalRanges.id, id)).returning({ id: vitalRanges.id });
    if (!row) throw new AppError("Range not found.");
    return row;
  }
  const [row] = await tx.insert(vitalRanges).values({ clinicId, ...values }).returning({ id: vitalRanges.id });
  return row;
}

// ---------------------------------------------------------------------------
// Lab tests
// ---------------------------------------------------------------------------

export function listLabTests(tx: Tx) {
  return tx.select().from(labTests).orderBy(sql`${labTests.isActive} desc`, asc(labTests.name));
}

export async function saveLabTest(
  tx: Tx,
  clinicId: string,
  id: string | null,
  input: { name: string; sampleType?: string; unit?: string; referenceRange?: string; price?: string },
) {
  const values = {
    name: input.name,
    sampleType: input.sampleType ?? null,
    unit: input.unit ?? null,
    referenceRange: input.referenceRange ?? null,
    price: money(input.price),
  };
  if (id) {
    const [row] = await tx.update(labTests).set(values).where(eq(labTests.id, id)).returning({ id: labTests.id });
    if (!row) throw new AppError("Test not found.");
    return row;
  }
  const [row] = await tx.insert(labTests).values({ clinicId, ...values }).returning({ id: labTests.id });
  return row;
}

// ---------------------------------------------------------------------------
// Activate / deactivate (all sections)
// ---------------------------------------------------------------------------

export const ENTRY_KINDS = ["drug", "allergyClass", "interaction", "preset", "diagnosis", "vitalRange", "labTest"] as const;
export type EntryKind = (typeof ENTRY_KINDS)[number];

const ENTRY_TABLES = {
  drug: drugs,
  allergyClass: allergyClasses,
  interaction: drugInteractions,
  preset: prescribingPresets,
  diagnosis: diagnosisCodes,
  vitalRange: vitalRanges,
  labTest: labTests,
} as const;

export async function setEntryActive(tx: Tx, kind: EntryKind, id: string, isActive: boolean) {
  const table = ENTRY_TABLES[kind];
  const rows = await tx.update(table).set({ isActive }).where(and(eq(table.id, id))).returning({ id: table.id });
  if (rows.length === 0) throw new AppError("Entry not found.");
}
