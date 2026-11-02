// Pure GST rules for pharmacy sales (unit tested). docs/PHARMACY_DESIGN.md 4.1.
//
// Retail prices are tax-inclusive (MRP). All arithmetic is in integer paise.
// For each line: gross -> share of the bill discount -> net (tax-inclusive)
// -> taxable value and tax backed out at the line's rate -> CGST + SGST
// (same state) or IGST (a buyer in another state). Round-off is added to the
// invoice total after everything else and is not part of the taxable value.

export const SALE_GST_RATES = [0, 5, 12, 18, 28, 40] as const;
export type TaxMode = "intra" | "inter" | "none";

/**
 * Splits `total` over `weights` in proportion, in whole paise, so the parts
 * add up to `total` exactly (largest remainder; ties go to the earlier line).
 */
export function allocate(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (total === 0 || sum === 0) return weights.map(() => 0);
  const exact = weights.map((w) => (total * w) / sum);
  const parts = exact.map(Math.floor);
  let left = total - parts.reduce((a, b) => a + b, 0);
  const order = exact.map((e, i) => ({ i, r: e - Math.floor(e) })).sort((a, b) => b.r - a.r || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    parts[i] += 1;
    left -= 1;
  }
  return parts;
}

export type LineTax = { taxable: number; cgst: number; sgst: number; igst: number };

/** Taxable value and tax inside a tax-inclusive amount (paise). */
export function backOutTax(net: number, rate: number, mode: TaxMode): LineTax {
  if (mode === "none" || rate === 0) return { taxable: net, cgst: 0, sgst: 0, igst: 0 };
  const taxable = Math.round((net * 100) / (100 + rate));
  const tax = net - taxable;
  if (mode === "inter") return { taxable, cgst: 0, sgst: 0, igst: tax };
  const cgst = Math.floor(tax / 2);
  return { taxable, cgst, sgst: tax - cgst, igst: 0 };
}

/** To the nearest rupee: the round-off (-50 .. +49 paise) and the rounded total. */
export function roundToRupee(total: number): { roundOff: number; total: number } {
  const rounded = Math.round(total / 100) * 100;
  // Exactly half a rupee rounds up, like the counter does.
  return { roundOff: rounded - total, total: rounded };
}

export type PricedLineInput = { gross: number; gstRate: number };
export type PricedLine = LineTax & { gross: number; discount: number; net: number; gstRate: number };

export type PricedSale = {
  lines: PricedLine[];
  gross: number;
  discount: number;
  net: number;
  taxable: number;
  tax: number;
  roundOff: number;
  total: number;
};

/** Prices a whole sale. `discount` is tax-inclusive, in paise, at most the gross. */
export function priceSale(inputs: PricedLineInput[], options: { discount: number; roundOff: boolean; mode: TaxMode }): PricedSale {
  const gross = inputs.reduce((s, l) => s + l.gross, 0);
  const discount = Math.min(Math.max(0, options.discount), gross);
  const shares = allocate(discount, inputs.map((l) => l.gross));
  const lines = inputs.map((l, i) => {
    const net = l.gross - shares[i];
    return { gross: l.gross, discount: shares[i], net, gstRate: options.mode === "none" ? 0 : l.gstRate, ...backOutTax(net, l.gstRate, options.mode) };
  });
  const net = lines.reduce((s, l) => s + l.net, 0);
  const taxable = lines.reduce((s, l) => s + l.taxable, 0);
  const rounded = options.roundOff ? roundToRupee(net) : { roundOff: 0, total: net };
  return { lines, gross, discount, net, taxable, tax: net - taxable, roundOff: rounded.roundOff, total: rounded.total };
}

/** 15-character GSTIN: 2-digit state, PAN, entity number, Z, checksum. */
export const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/** The state code a GSTIN starts with. */
export function stateOfGstin(gstin: string | null | undefined): string | null {
  return gstin && GSTIN_PATTERN.test(gstin) ? gstin.slice(0, 2) : null;
}

/** CGST+SGST unless the buyer is registered in another state. */
export function taxModeFor(scheme: string, sellerState: string | null, buyerState: string | null): TaxMode {
  if (scheme !== "regular") return "none";
  return sellerState && buyerState && buyerState !== sellerState ? "inter" : "intra";
}
