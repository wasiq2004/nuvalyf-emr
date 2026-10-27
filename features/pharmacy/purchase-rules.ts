// Pure rules for supplier bills (unit tested). A bill is read the way it is
// printed: quantities, free quantities, rate and MRP per pack. Stock is kept
// in single units, so a line becomes (quantity + free) x units-per-pack units,
// at a cost and selling price per unit.
import { fromMinor, toMinor } from "@/lib/money";

export const GST_RATES = [0, 5, 12, 18, 28] as const;
export const MAX_BILL_LINES = 100;

export type BillLineInput = {
  quantity: number;
  freeQuantity: number;
  packSize: number;
  /** Rate per pack, before tax. */
  rate: string;
  /** Maximum retail price per pack, if printed. */
  mrp?: string;
  gstRate: number;
};

export type BillLineTotals = {
  /** Units added to stock (paid + free). */
  units: number;
  /** quantity x rate, before tax. */
  amount: string;
  taxAmount: string;
  /** Cost per unit, spreading the paid amount over every unit received. */
  unitCost: string;
  /** Selling price per unit from the MRP, if given. */
  unitMrp: string | null;
};

/** Divides minor units, rounding half up to the paisa. */
function divideMinor(minor: number, by: number): number {
  return Math.round(minor / by);
}

export function lineTotals(line: BillLineInput): BillLineTotals {
  const units = (line.quantity + line.freeQuantity) * line.packSize;
  const amountMinor = toMinor(line.rate) * line.quantity;
  const taxMinor = Math.round((amountMinor * line.gstRate) / 100);
  return {
    units,
    amount: fromMinor(amountMinor),
    taxAmount: fromMinor(taxMinor),
    unitCost: fromMinor(units > 0 ? divideMinor(amountMinor, units) : 0),
    unitMrp: line.mrp ? fromMinor(divideMinor(toMinor(line.mrp), line.packSize)) : null,
  };
}

export function billTotals(lines: BillLineInput[]): { subtotal: string; tax: string; total: string; units: number } {
  let subtotal = 0;
  let tax = 0;
  let units = 0;
  for (const line of lines) {
    const t = lineTotals(line);
    subtotal += toMinor(t.amount);
    tax += toMinor(t.taxAmount);
    units += t.units;
  }
  return { subtotal: fromMinor(subtotal), tax: fromMinor(tax), total: fromMinor(subtotal + tax), units };
}

/** Same batch of the same item twice on one bill is almost always a typing slip. */
export function duplicateLines(lines: { drugId: string; batchNo: string; expiryDate: string }[]): number[] {
  const seen = new Set<string>();
  const dupes: number[] = [];
  lines.forEach((l, i) => {
    const key = `${l.drugId}|${l.batchNo.trim().toUpperCase()}|${l.expiryDate}`;
    if (seen.has(key)) dupes.push(i);
    else seen.add(key);
  });
  return dupes;
}

/**
 * Expiry as printed on packs and bills: "12/27" or "12/2027" (the month's
 * last day), dd/mm/yyyy, or yyyy-mm-dd. Anything else is returned unchanged
 * for the caller to reject.
 */
export function normalizeExpiry(value: string): string {
  const v = value.trim();
  const my = /^(\d{1,2})[/.-](\d{2}|\d{4})$/.exec(v);
  if (my) {
    const month = Number(my[1]);
    const year = my[2].length === 2 ? 2000 + Number(my[2]) : Number(my[2]);
    if (month >= 1 && month <= 12) {
      const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
      return `${year}-${String(month).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
    }
  }
  const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(v);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  return v;
}

