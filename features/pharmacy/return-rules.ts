// Pure rules for returns (unit tested). docs/PHARMACY_DESIGN.md 4.2 and 4.3.
//
// A sale line can be returned in parts. Each part refunds its share of the
// line's tax-inclusive value and reverses its share of the tax, in paise; the
// part that takes the last unit takes exactly what is left, so a fully
// returned line always refunds its exact value and reverses its exact tax.

export type LineValue = { net: number; taxable: number; cgst: number; sgst: number; igst: number };

const ZERO: LineValue = { net: 0, taxable: 0, cgst: 0, sgst: 0, igst: 0 };
const KEYS = ["net", "taxable", "cgst", "sgst", "igst"] as const;

/** Units still returnable on a line. */
export function returnable(sold: number, returned: number): number {
  return Math.max(0, sold - returned);
}

/**
 * The value of returning `units` of a line that sold `sold` units for `line`,
 * when `returned` units worth `refunded` already came back.
 */
export function returnValue(line: LineValue, sold: number, returned: number, refunded: LineValue, units: number): LineValue {
  if (units <= 0) return { ...ZERO };
  if (units > returnable(sold, returned)) throw new Error("More than was sold");
  if (returned + units === sold) {
    // The last units: exactly what is left, so the totals reconcile.
    return Object.fromEntries(KEYS.map((k) => [k, line[k] - refunded[k]])) as LineValue;
  }
  const share = (v: number) => Math.floor((v * units) / sold);
  const out = { taxable: share(line.taxable), cgst: share(line.cgst), sgst: share(line.sgst), igst: share(line.igst), net: 0 };
  out.net = out.taxable + out.cgst + out.sgst + out.igst;
  return out;
}

export function addValues(a: LineValue, b: LineValue): LineValue {
  return Object.fromEntries(KEYS.map((k) => [k, a[k] + b[k]])) as LineValue;
}

export const emptyValue = (): LineValue => ({ ...ZERO });

/** Debit note line: units back to the supplier at the batch cost plus GST. */
export function purchaseReturnValue(unitCost: number, units: number, gstRate: number): { taxable: number; tax: number } {
  const taxable = unitCost * units;
  return { taxable, tax: Math.round((taxable * gstRate) / 100) };
}
