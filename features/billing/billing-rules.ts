// Pure billing rules (unit tested). All arithmetic in minor units.
import { fromMinor, toMinor } from "@/lib/money";

export const PAYMENT_METHODS = ["cash", "upi", "card", "other"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: "Cash",
  upi: "UPI",
  card: "Card",
  other: "Other",
};

export const ITEM_KINDS = ["service", "lab", "medicine", "other"] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

export function lineAmount(unitPrice: string, quantity: number): string {
  return fromMinor(toMinor(unitPrice) * quantity);
}

export function invoiceTotals(lines: { amount: string }[], discount: string) {
  const subtotal = lines.reduce((sum, l) => sum + toMinor(l.amount), 0);
  const off = toMinor(discount);
  if (off > subtotal) throw new RangeError("The discount is larger than the invoice.");
  return { subtotal: fromMinor(subtotal), total: fromMinor(subtotal - off) };
}

export type PaymentState = "unpaid" | "partial" | "paid";

export function paymentState(total: string, paid: string): PaymentState {
  const t = toMinor(total);
  const p = toMinor(paid);
  if (p <= 0 && t > 0) return "unpaid";
  return p >= t ? "paid" : "partial";
}

export function balanceOf(total: string, paid: string): string {
  return fromMinor(Math.max(0, toMinor(total) - toMinor(paid)));
}
