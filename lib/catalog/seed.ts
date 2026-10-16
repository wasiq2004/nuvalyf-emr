import "server-only";

// Copies the starter templates into a clinic's own catalogue tables.
//
// Used at onboarding (provisioner role) and by "import new starter entries"
// in clinic settings (app role). Only entries whose starter key the clinic
// does not have yet are added, so anything the clinic edited or deactivated
// stays exactly as it is.
import { and, eq, inArray, isNotNull } from "drizzle-orm";
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
import {
  STARTER_ALLERGY_CLASSES,
  STARTER_DIAGNOSES,
  STARTER_DRUGS,
  STARTER_INTERACTIONS,
  STARTER_LAB_TESTS,
  STARTER_PRESETS,
  STARTER_VITAL_RANGES,
  vitalRangeKey,
} from "./starter";

export const CATALOG_SECTIONS = ["drugs", "allergyClasses", "interactions", "presets", "diagnoses", "vitalRanges", "labTests"] as const;
export type CatalogSection = (typeof CATALOG_SECTIONS)[number];

type StarterKeys = Record<CatalogSection, string[]>;

function starterKeys(): StarterKeys {
  return {
    drugs: STARTER_DRUGS.map((d) => d.key),
    allergyClasses: STARTER_ALLERGY_CLASSES.map((c) => c.key),
    interactions: STARTER_INTERACTIONS.map((i) => i.key),
    presets: STARTER_PRESETS.map((p) => p.key),
    diagnoses: STARTER_DIAGNOSES.map((d) => d.code),
    vitalRanges: STARTER_VITAL_RANGES.map(vitalRangeKey),
    labTests: STARTER_LAB_TESTS.map((t) => t.key),
  };
}

const TABLES = {
  drugs,
  allergyClasses,
  interactions: drugInteractions,
  presets: prescribingPresets,
  diagnoses: diagnosisCodes,
  vitalRanges,
  labTests,
} as const;

async function existingKeys(tx: Tx, clinicId: string): Promise<Record<CatalogSection, Set<string>>> {
  const result = {} as Record<CatalogSection, Set<string>>;
  for (const section of CATALOG_SECTIONS) {
    const table = TABLES[section];
    const rows = await tx
      .select({ key: table.starterKey })
      .from(table)
      .where(and(eq(table.clinicId, clinicId), isNotNull(table.starterKey)));
    result[section] = new Set(rows.map((r) => r.key!));
  }
  return result;
}

/** How many starter entries per section the clinic does not have yet. */
export async function missingStarterCounts(tx: Tx, clinicId: string): Promise<Record<CatalogSection, number>> {
  const have = await existingKeys(tx, clinicId);
  const all = starterKeys();
  const result = {} as Record<CatalogSection, number>;
  for (const section of CATALOG_SECTIONS) {
    result[section] = all[section].filter((key) => !have[section].has(key)).length;
  }
  return result;
}

const num = (value: number | undefined) => (value === undefined ? null : String(value));

/** Adds every starter entry the clinic is missing. Returns how many were added per section. */
export async function importStarterCatalog(tx: Tx, clinicId: string): Promise<Record<CatalogSection, number>> {
  const have = await existingKeys(tx, clinicId);
  const added = Object.fromEntries(CATALOG_SECTIONS.map((s) => [s, 0])) as Record<CatalogSection, number>;

  const newClasses = STARTER_ALLERGY_CLASSES.filter((c) => !have.allergyClasses.has(c.key));
  if (newClasses.length) {
    await tx.insert(allergyClasses).values(
      newClasses.map((c) => ({ clinicId, starterKey: c.key, name: c.name, description: c.description })),
    );
    added.allergyClasses = newClasses.length;
  }

  const newDrugs = STARTER_DRUGS.filter((d) => !have.drugs.has(d.key));
  if (newDrugs.length) {
    const inserted = await tx
      .insert(drugs)
      .values(
        newDrugs.map((d) => ({
          clinicId,
          starterKey: d.key,
          name: d.name,
          genericName: d.generic,
          form: d.form,
          strength: d.strength ?? null,
          category: d.category,
          defaultDose: d.dose ?? null,
          defaultFrequency: d.frequency ?? null,
          defaultDurationDays: d.days ?? null,
          defaultInstructions: d.instructions ?? null,
        })),
      )
      .returning({ id: drugs.id, starterKey: drugs.starterKey });
    added.drugs = inserted.length;

    // Allergy-class links only for drugs added now: a link the clinic removed
    // from an existing drug is not put back.
    const classKeys = [...new Set(newDrugs.flatMap((d) => d.classes ?? []))];
    if (classKeys.length) {
      const classRows = await tx
        .select({ id: allergyClasses.id, key: allergyClasses.starterKey })
        .from(allergyClasses)
        .where(and(eq(allergyClasses.clinicId, clinicId), inArray(allergyClasses.starterKey, classKeys)));
      const classIds = new Map(classRows.map((r) => [r.key!, r.id]));
      const drugIds = new Map(inserted.map((r) => [r.starterKey!, r.id]));
      const links = newDrugs.flatMap((d) =>
        (d.classes ?? [])
          .filter((key) => classIds.has(key))
          .map((key) => ({ clinicId, drugId: drugIds.get(d.key)!, allergyClassId: classIds.get(key)! })),
      );
      if (links.length) await tx.insert(drugAllergyClasses).values(links).onConflictDoNothing();
    }
  }

  const newInteractions = STARTER_INTERACTIONS.filter((i) => !have.interactions.has(i.key));
  if (newInteractions.length) {
    await tx.insert(drugInteractions).values(
      newInteractions.map((i) => ({
        clinicId,
        starterKey: i.key,
        genericA: i.a,
        genericB: i.b,
        severity: i.severity,
        description: i.description,
      })),
    );
    added.interactions = newInteractions.length;
  }

  const newPresets = STARTER_PRESETS.filter((p) => !have.presets.has(p.key));
  if (newPresets.length) {
    await tx.insert(prescribingPresets).values(
      newPresets.map((p) => ({
        clinicId,
        starterKey: p.key,
        kind: p.kind,
        label: p.label,
        value: p.value,
        sortOrder: STARTER_PRESETS.indexOf(p),
      })),
    );
    added.presets = newPresets.length;
  }

  const newDiagnoses = STARTER_DIAGNOSES.filter((d) => !have.diagnoses.has(d.code));
  if (newDiagnoses.length) {
    // A clinic may already have added the same code by hand; keep theirs.
    const inserted = await tx
      .insert(diagnosisCodes)
      .values(newDiagnoses.map((d) => ({ clinicId, starterKey: d.code, code: d.code, label: d.label, isFavourite: d.favourite ?? false })))
      .onConflictDoNothing()
      .returning({ id: diagnosisCodes.id });
    added.diagnoses = inserted.length;
  }

  const newRanges = STARTER_VITAL_RANGES.filter((r) => !have.vitalRanges.has(vitalRangeKey(r)));
  if (newRanges.length) {
    await tx.insert(vitalRanges).values(
      newRanges.map((r) => ({
        clinicId,
        starterKey: vitalRangeKey(r),
        vital: r.vital,
        ageMinYears: r.ageMin,
        ageMaxYears: r.ageMax,
        low: num(r.low),
        high: num(r.high),
        criticalLow: num(r.criticalLow),
        criticalHigh: num(r.criticalHigh),
      })),
    );
    added.vitalRanges = newRanges.length;
  }

  const newTests = STARTER_LAB_TESTS.filter((t) => !have.labTests.has(t.key));
  if (newTests.length) {
    await tx.insert(labTests).values(
      newTests.map((t) => ({
        clinicId,
        starterKey: t.key,
        name: t.name,
        sampleType: t.sample ?? null,
        unit: t.unit ?? null,
        referenceRange: t.range ?? null,
      })),
    );
    added.labTests = newTests.length;
  }

  return added;
}
