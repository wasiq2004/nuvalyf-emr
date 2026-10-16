import "server-only";

// Prescribing. Items snapshot the catalogue entry when added, and the
// allergy / interaction check runs again here on save, whatever the browser
// showed. Signing happens with finalisation (encounters.service).
import { and, asc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import {
  allergies,
  allergyClasses,
  drugAllergyClasses,
  drugInteractions,
  drugs,
  prescribingPresets,
  prescriptionItems,
  prescriptions,
} from "@/lib/db/schema";
import { AppError } from "@/lib/errors";
import { requireOpenEncounter, requireOwnOpenEncounter } from "./encounters.service";
import { checkDrug, needsOverride, type DrugForCheck, type InteractionSeverity, type RxWarning } from "./prescribing-rules";

export type DrugOption = {
  id: string;
  name: string;
  genericName: string;
  form: string;
  strength: string | null;
  defaultDose: string | null;
  defaultFrequency: string | null;
  defaultDurationDays: number | null;
  defaultInstructions: string | null;
};

export async function searchDrugs(tx: Tx, query: string, limit = 15): Promise<DrugOption[]> {
  const term = query.trim().replace(/[%_\\]/g, "");
  if (!term) return [];
  return tx
    .select({
      id: drugs.id,
      name: drugs.name,
      genericName: drugs.genericName,
      form: drugs.form,
      strength: drugs.strength,
      defaultDose: drugs.defaultDose,
      defaultFrequency: drugs.defaultFrequency,
      defaultDurationDays: drugs.defaultDurationDays,
      defaultInstructions: drugs.defaultInstructions,
    })
    .from(drugs)
    .where(and(eq(drugs.isActive, true), or(ilike(drugs.name, `%${term}%`), ilike(drugs.genericName, `%${term}%`))))
    .orderBy(sql`case when ${drugs.name} ilike ${`${term}%`} then 0 else 1 end`, asc(drugs.name))
    .limit(limit);
}

export async function listPresets(tx: Tx) {
  const rows = await tx
    .select({ kind: prescribingPresets.kind, label: prescribingPresets.label, value: prescribingPresets.value })
    .from(prescribingPresets)
    .where(eq(prescribingPresets.isActive, true))
    .orderBy(asc(prescribingPresets.sortOrder), asc(prescribingPresets.label));
  return {
    frequency: rows.filter((r) => r.kind === "frequency"),
    duration: rows.filter((r) => r.kind === "duration"),
    instruction: rows.filter((r) => r.kind === "instruction"),
  };
}

export type PrescriptionPresets = Awaited<ReturnType<typeof listPresets>>;

async function classesFor(tx: Tx, drugIds: string[]) {
  if (drugIds.length === 0) return new Map<string, { id: string; name: string }[]>();
  const rows = await tx
    .select({ drugId: drugAllergyClasses.drugId, id: allergyClasses.id, name: allergyClasses.name })
    .from(drugAllergyClasses)
    .innerJoin(allergyClasses, eq(allergyClasses.id, drugAllergyClasses.allergyClassId))
    .where(inArray(drugAllergyClasses.drugId, drugIds));
  const map = new Map<string, { id: string; name: string }[]>();
  for (const r of rows) map.set(r.drugId, [...(map.get(r.drugId) ?? []), { id: r.id, name: r.name }]);
  return map;
}

export async function getDraftPrescription(tx: Tx, encounterId: string) {
  const [rx] = await tx.select().from(prescriptions).where(eq(prescriptions.encounterId, encounterId)).limit(1);
  if (!rx) return null;
  const items = await tx
    .select()
    .from(prescriptionItems)
    .where(eq(prescriptionItems.prescriptionId, rx.id))
    .orderBy(asc(prescriptionItems.sortOrder), asc(prescriptionItems.createdAt));
  return { ...rx, items };
}

/** Warnings for adding `drugId` to this consultation's prescription. */
export async function warningsFor(tx: Tx, encounterId: string, drugId: string): Promise<{ drug: typeof drugs.$inferSelect; warnings: RxWarning[] }> {
  const encounter = await requireOpenEncounter(tx, encounterId);
  const [drug] = await tx.select().from(drugs).where(eq(drugs.id, drugId)).limit(1);
  if (!drug) throw new AppError("Medicine not found.");
  if (!drug.isActive) throw new AppError("This medicine has been deactivated in the clinic's list.");

  const draft = await getDraftPrescription(tx, encounterId);
  const items = draft?.items ?? [];
  const classes = await classesFor(tx, [drug.id, ...items.map((i) => i.drugId).filter((v): v is string => Boolean(v))]);

  const patientAllergies = await tx
    .select({ substance: allergies.substance, allergyClassId: allergies.allergyClassId, severity: allergies.severity })
    .from(allergies)
    .where(and(eq(allergies.patientId, encounter.patientId), eq(allergies.status, "active")));
  const rules = await tx
    .select({ genericA: drugInteractions.genericA, genericB: drugInteractions.genericB, severity: drugInteractions.severity, description: drugInteractions.description })
    .from(drugInteractions)
    .where(eq(drugInteractions.isActive, true));

  const candidate: DrugForCheck = { name: drug.name, genericName: drug.genericName, classes: classes.get(drug.id) ?? [] };
  const current: DrugForCheck[] = items.map((i) => ({
    name: i.drugName,
    genericName: i.genericName,
    classes: i.drugId ? (classes.get(i.drugId) ?? []) : [],
  }));
  const warnings = checkDrug(candidate, {
    allergies: patientAllergies,
    current,
    rules: rules.map((r) => ({ ...r, severity: r.severity as InteractionSeverity })),
  });
  return { drug, warnings };
}

export type PrescriptionItemInput = {
  drugId: string;
  dose: string;
  frequency: string;
  durationDays: number | null;
  instructions?: string;
  quantity: number | null;
  overrideReason?: string;
};

export async function addPrescriptionItem(tx: Tx, clinicId: string, encounterId: string, input: PrescriptionItemInput, userId: string) {
  const encounter = await requireOwnOpenEncounter(tx, encounterId, userId);
  const { drug, warnings } = await warningsFor(tx, encounterId, input.drugId);
  if (needsOverride(warnings) && !input.overrideReason) {
    throw new AppError("This medicine has a serious warning for this patient. Give a reason to prescribe it anyway.");
  }

  let draft = await getDraftPrescription(tx, encounterId);
  if (!draft) {
    const [created] = await tx
      .insert(prescriptions)
      .values({ clinicId, encounterId, patientId: encounter.patientId, prescriberId: userId })
      .onConflictDoNothing({ target: prescriptions.encounterId })
      .returning();
    draft = created ? { ...created, items: [] } : await getDraftPrescription(tx, encounterId);
  }
  if (!draft || draft.status !== "draft") throw new AppError("This prescription is already signed.");

  const [row] = await tx
    .insert(prescriptionItems)
    .values({
      clinicId,
      prescriptionId: draft.id,
      drugId: drug.id,
      drugName: drug.name,
      genericName: drug.genericName,
      form: drug.form,
      strength: drug.strength,
      dose: input.dose,
      frequency: input.frequency,
      durationDays: input.durationDays,
      instructions: input.instructions ?? null,
      quantity: input.quantity,
      warnings,
      overrideReason: warnings.length ? (input.overrideReason ?? null) : null,
      sortOrder: draft.items.length,
    })
    .returning({ id: prescriptionItems.id });
  return { id: row.id, patientId: encounter.patientId, drugName: drug.name, warnings, overridden: needsOverride(warnings) };
}

export async function removePrescriptionItem(tx: Tx, itemId: string, userId: string) {
  const [item] = await tx
    .select({ id: prescriptionItems.id, drugName: prescriptionItems.drugName, encounterId: prescriptions.encounterId })
    .from(prescriptionItems)
    .innerJoin(prescriptions, eq(prescriptions.id, prescriptionItems.prescriptionId))
    .where(eq(prescriptionItems.id, itemId))
    .limit(1);
  if (!item) throw new AppError("Item not found.");
  const encounter = await requireOwnOpenEncounter(tx, item.encounterId, userId);
  await tx.delete(prescriptionItems).where(eq(prescriptionItems.id, itemId));
  return { patientId: encounter.patientId, drugName: item.drugName };
}

export async function getSignedPrescription(tx: Tx, encounterId: string) {
  const [rx] = await tx
    .select()
    .from(prescriptions)
    .where(and(eq(prescriptions.encounterId, encounterId), eq(prescriptions.status, "signed")))
    .limit(1);
  return rx ?? null;
}
