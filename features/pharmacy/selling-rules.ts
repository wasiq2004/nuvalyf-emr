// Pure rules for selling loose or by the pack (unit tested). Stock is always
// kept in single units (tablets, needles). A sale line is either a number of
// units at the unit price, or a number of packs (a strip of 15) at the pack
// price - the printed MRP when known, so a strip never costs a few paise more
// or less than the strip's MRP because of rounding.
import { fromMinor, toMinor } from "@/lib/money";

export const SOLD_AS = ["unit", "pack"] as const;
export type SoldAs = (typeof SOLD_AS)[number];

export type Sellable = { price: string | null; packPrice: string | null; packSize: number };

/** Price of one unit or one pack, or null when the item cannot be sold that way. */
export function sellingPrice(item: Sellable, soldAs: SoldAs): string | null {
  if (soldAs === "unit") return item.price;
  if (item.packPrice) return item.packPrice;
  return item.price ? fromMinor(toMinor(item.price) * item.packSize) : null;
}

/** Units that leave stock for a line. */
export function unitsFor(quantity: number, soldAs: SoldAs, packSize: number): number {
  return soldAs === "pack" ? quantity * packSize : quantity;
}

const TABLETS = new Set(["tablet", "capsule"]);

/** "strip" for tablets and capsules, otherwise "pack". */
export function packWord(form: string, count = 1): string {
  const word = TABLETS.has(form) ? "strip" : "pack";
  return count === 1 ? word : `${word}s`;
}

/** "tablet" / "capsule", otherwise "unit". */
export function unitWord(form: string, count = 1): string {
  const word = TABLETS.has(form) ? form : "unit";
  return count === 1 ? word : `${word}s`;
}

/** "2 strips (30 tablets)" or "9 tablets". */
export function describeQuantity(line: { soldAs: string; quantity: number; packs: number | null; packSize: number }, form: string): string {
  if (line.soldAs === "pack" && line.packs) {
    return `${line.packs} ${packWord(form, line.packs)} (${line.quantity} ${unitWord(form, line.quantity)})`;
  }
  return `${line.quantity} ${unitWord(form, line.quantity)}`;
}
