import "server-only";

// Catalogue items beyond the clinical view: alternate names, matching a
// supplier's spelling to an item, and the search used by bill entry and the
// pharmacy counter. Normalisation rules live in item-rules.ts.
import { and, asc, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import { drugAliases, drugs } from "@/lib/db/schema";
import { AppError } from "@/lib/errors";
import { normalizeItemName, searchTokens, type ItemType } from "./item-rules";

export type ItemOption = {
  id: string;
  name: string;
  itemType: ItemType;
  genericName: string;
  form: string;
  strength: string | null;
  manufacturer: string | null;
  packSize: number;
  price: string | null;
  aliases: string[];
  /** The alternate name the search matched, when it was not the item's own name. */
  matchedAlias: string | null;
};

/** Every alternate name, grouped by item. */
export async function aliasesFor(tx: Tx, drugIds: string[]) {
  if (drugIds.length === 0) return new Map<string, { id: string; alias: string; manufacturer: string | null }[]>();
  const rows = await tx
    .select({ id: drugAliases.id, drugId: drugAliases.drugId, alias: drugAliases.alias, manufacturer: drugAliases.manufacturer })
    .from(drugAliases)
    .where(inArray(drugAliases.drugId, drugIds))
    .orderBy(asc(drugAliases.alias));
  const map = new Map<string, { id: string; alias: string; manufacturer: string | null }[]>();
  for (const r of rows) map.set(r.drugId, [...(map.get(r.drugId) ?? []), { id: r.id, alias: r.alias, manufacturer: r.manufacturer }]);
  return map;
}

/** All aliases of an item, as one searchable string. */
const aliasText = sql<string>`coalesce((select string_agg(a.alias, ' ') from app.drug_aliases a where a.drug_id = ${drugs.id}), '')`;

/**
 * Items whose name, generic name, manufacturer or any alternate name contains
 * every word of the query, in any order: "needle clinic" finds "Clinic
 * needle". Exact name matches first.
 */
export async function searchItems(tx: Tx, query: string, options: { types?: ItemType[]; limit?: number } = {}): Promise<ItemOption[]> {
  const tokens = searchTokens(query);
  if (tokens.length === 0) return [];
  const haystack = sql`(${drugs.name} || ' ' || ${drugs.genericName} || ' ' || coalesce(${drugs.manufacturer}, '') || ' ' || ${aliasText})`;
  const conditions: SQL[] = [eq(drugs.isActive, true), ...tokens.map((t) => sql`${haystack} ilike ${`%${t.replace(/[%_\\]/g, "")}%`}`)];
  if (options.types?.length) conditions.push(inArray(drugs.itemType, options.types));
  const rows = await tx
    .select()
    .from(drugs)
    .where(and(...conditions))
    .orderBy(sql`case when lower(${drugs.name}) like ${`${tokens[0]}%`} then 0 else 1 end`, asc(drugs.name))
    .limit(options.limit ?? 15);
  const aliases = await aliasesFor(tx, rows.map((r) => r.id));
  const wanted = normalizeItemName(query);
  return rows.map((r) => {
    const own = (aliases.get(r.id) ?? []).map((a) => a.alias);
    const nameHit = tokens.every((t) => normalizeItemName(`${r.name} ${r.genericName} ${r.manufacturer ?? ""}`).includes(t));
    // An exact other name always says so; a partial one only when the item's own name did not match.
    const exact = own.find((a) => normalizeItemName(a) === wanted);
    const matched = exact ?? (nameHit ? null : (own.find((a) => tokens.every((t) => normalizeItemName(a).includes(t))) ?? null));
    return {
      id: r.id,
      name: r.name,
      itemType: r.itemType as ItemType,
      genericName: r.genericName,
      form: r.form,
      strength: r.strength,
      manufacturer: r.manufacturer,
      packSize: r.packSize,
      price: r.price,
      aliases: own,
      matchedAlias: matched,
    };
  });
}

export type NameIndex = Map<string, { drugId: string; name: string; via: "name" | "alias" }>;

/** Normalised item names and alternate names -> item, for exact matching. */
export async function nameIndex(tx: Tx): Promise<NameIndex> {
  const index: NameIndex = new Map();
  const items = await tx.select({ id: drugs.id, name: drugs.name }).from(drugs);
  const byId = new Map(items.map((i) => [i.id, i.name]));
  for (const i of items) {
    const key = normalizeItemName(i.name);
    if (key && !index.has(key)) index.set(key, { drugId: i.id, name: i.name, via: "name" });
  }
  const aliases = await tx.select({ drugId: drugAliases.drugId, normalized: drugAliases.normalized }).from(drugAliases);
  for (const a of aliases) {
    if (!index.has(a.normalized)) index.set(a.normalized, { drugId: a.drugId, name: byId.get(a.drugId) ?? "", via: "alias" });
  }
  return index;
}

/**
 * Records another name for an item. Refused if the name already belongs to a
 * different item (as its name or one of its alternate names), so a match is
 * never ambiguous. Returns null when there is nothing new to remember.
 */
export async function addAlias(
  tx: Tx,
  clinicId: string,
  input: { drugId: string; alias: string; manufacturer?: string | null },
  actorId: string,
  index?: NameIndex,
) {
  const alias = input.alias.trim().replace(/\s+/g, " ");
  const normalized = normalizeItemName(alias);
  if (!normalized) throw new AppError("Enter the other name.");
  const [item] = await tx.select({ id: drugs.id, name: drugs.name }).from(drugs).where(eq(drugs.id, input.drugId)).limit(1);
  if (!item) throw new AppError("Item not found.");

  const known = (index ?? (await nameIndex(tx))).get(normalized);
  if (known?.drugId === item.id) return null;
  if (known) throw new AppError(`"${alias}" is already ${known.via === "name" ? "the name" : "another name"} of ${known.name}.`);

  const [row] = await tx
    .insert(drugAliases)
    .values({ clinicId, drugId: item.id, alias: alias.slice(0, 200), normalized: normalized.slice(0, 200), manufacturer: input.manufacturer || null, createdBy: actorId })
    .returning({ id: drugAliases.id });
  index?.set(normalized, { drugId: item.id, name: item.name, via: "alias" });
  return { id: row.id, itemName: item.name, alias };
}

export async function removeAlias(tx: Tx, id: string) {
  const [row] = await tx.delete(drugAliases).where(eq(drugAliases.id, id)).returning({ drugId: drugAliases.drugId, alias: drugAliases.alias });
  if (!row) throw new AppError("That name was already removed.");
  return row;
}
