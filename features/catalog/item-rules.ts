// Pure rules for catalogue items (unit tested): item types and how names are
// compared. Suppliers spell the same product differently ("Clinic needle",
// "CLINIC NEEDLE 24G", "Needle clinic"); an item keeps its own name plus any
// number of alternate names, and matching works on a normalised form.

export const ITEM_TYPES = ["medicine", "consumable", "instrument"] as const;
export type ItemType = (typeof ITEM_TYPES)[number];

export const ITEM_TYPE_LABELS: Record<ItemType, string> = {
  medicine: "Medicine",
  consumable: "Consumable",
  instrument: "Instrument",
};

export function isItemType(value: string): value is ItemType {
  return (ITEM_TYPES as readonly string[]).includes(value);
}

/**
 * Comparable form of a name: lower case, punctuation and repeated spaces
 * collapsed. Word order is kept on purpose: "Amoxicillin 250 Clav 125" and
 * "Amoxicillin 125 Clav 250" are different products. Re-ordered names are
 * found by search (searchTokens) and confirmed by a person, never assumed.
 */
export function normalizeItemName(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9.+%]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Words to search for, in any order (at most five, two letters or more). */
export function searchTokens(query: string): string[] {
  return [...new Set(normalizeItemName(query).split(" ").filter((t) => t.length >= 2))].slice(0, 5);
}

/** Whether a typed name should be offered to remember as an alternate name. */
export function isNewAlias(typed: string, itemName: string, aliases: readonly string[]): boolean {
  const n = normalizeItemName(typed);
  if (!n) return false;
  return n !== normalizeItemName(itemName) && !aliases.some((a) => normalizeItemName(a) === n);
}
