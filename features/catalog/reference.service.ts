import "server-only";

// The shared Indian medicine list (ref.medicines): search it, and copy an
// entry into the clinic's own list (app.drugs) the first time it is needed.
// The copy is the clinic's to edit; prices are never copied, because the
// list's MRPs are only what was listed when it was compiled.
import { and, eq, isNull, sql } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import { drugs, referenceDatasets, referenceMedicines } from "@/lib/db/schema";
import { AppError } from "@/lib/errors";
import { createDrug } from "./catalog.service";
import { searchTokens, normalizeItemName } from "./item-rules";
import { getItemOption, nameIndex } from "./items.service";

export type ReferenceHit = {
  id: number;
  name: string;
  manufacturer: string | null;
  composition: string | null;
  genericName: string;
  strength: string | null;
  form: string;
  packLabel: string;
  packSize: number;
  mrp: string | null;
  discontinued: boolean;
  /** The clinic's item already added from this entry. */
  clinicDrugId: string | null;
};

/** Every word of the query, anywhere in the name; current products first. */
export async function searchReference(tx: Tx, query: string, limit = 20): Promise<ReferenceHit[]> {
  const tokens = searchTokens(query);
  if (tokens.length === 0) return [];
  const conditions = tokens.map((t) => sql`${referenceMedicines.normalized} like ${`%${t.replace(/[%_\\]/g, "")}%`}`);
  const rows = await tx
    .select({ ref: referenceMedicines, clinicDrugId: drugs.id })
    .from(referenceMedicines)
    .leftJoin(drugs, eq(drugs.referenceId, referenceMedicines.id))
    .where(and(...conditions))
    .orderBy(
      referenceMedicines.discontinued,
      sql`case when ${referenceMedicines.normalized} like ${`${tokens[0]}%`} then 0 else 1 end`,
      sql`length(${referenceMedicines.name})`,
      referenceMedicines.name,
    )
    .limit(Math.min(limit, 50));
  return rows.map((r) => ({
    id: r.ref.id,
    name: r.ref.name,
    manufacturer: r.ref.manufacturer,
    composition: r.ref.composition,
    genericName: r.ref.genericName,
    strength: r.ref.strength,
    form: r.ref.form,
    packLabel: r.ref.packLabel,
    packSize: r.ref.packSize,
    mrp: r.ref.mrp,
    discontinued: r.ref.discontinued,
    clinicDrugId: r.clinicDrugId,
  }));
}

/** How many medicines the list holds (0 when it has not been loaded). */
export async function referenceSize(tx: Tx): Promise<number> {
  const [row] = await tx.select({ rows: referenceDatasets.rows }).from(referenceDatasets).where(eq(referenceDatasets.name, "indian-medicines")).limit(1);
  return row?.rows ?? 0;
}

/**
 * Adds a list entry to the clinic's own list, once. An existing clinic item
 * with the same name is linked instead of duplicated.
 */
export async function addFromReference(tx: Tx, clinicId: string, referenceId: number) {
  const [linked] = await tx.select({ id: drugs.id }).from(drugs).where(eq(drugs.referenceId, referenceId)).limit(1);
  if (linked) return { item: await getItemOption(tx, linked.id), created: false };

  const [entry] = await tx.select().from(referenceMedicines).where(eq(referenceMedicines.id, referenceId)).limit(1);
  if (!entry) throw new AppError("That medicine is not in the list.");

  const same = (await nameIndex(tx)).get(normalizeItemName(entry.name));
  if (same) {
    await tx.update(drugs).set({ referenceId: entry.id, updatedAt: new Date() }).where(and(eq(drugs.id, same.drugId), isNull(drugs.referenceId)));
    return { item: await getItemOption(tx, same.drugId), created: false };
  }

  const row = await createDrug(tx, clinicId, {
    name: entry.name,
    itemType: "medicine",
    genericName: entry.genericName,
    form: entry.form,
    strength: entry.strength ?? undefined,
    manufacturer: entry.manufacturer ?? undefined,
    packSize: entry.packSize,
    defaultDurationDays: null,
    allergyClassIds: [],
  });
  await tx.update(drugs).set({ referenceId: entry.id }).where(eq(drugs.id, row.id));
  return { item: await getItemOption(tx, row.id), created: true };
}
