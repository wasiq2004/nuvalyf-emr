// Pure stock rules (unit tested).
import { addDaysToDateString } from "@/lib/time";

export const EXPIRY_WARNING_DAYS = 90;
export const SLOW_MOVING_DAYS = 90;

export type BatchLike = { id: string; expiryDate: string; quantity: number };

export function isExpired(expiryDate: string, today: string) {
  return expiryDate < today;
}

export function expiresWithin(expiryDate: string, today: string, days: number) {
  return !isExpired(expiryDate, today) && expiryDate <= addDaysToDateString(today, days);
}

/** First expiry, first out: the earliest-expiring usable batch with enough stock. */
export function pickBatch<T extends BatchLike>(batches: T[], quantity: number, today: string): T | undefined {
  const usable = batches.filter((b) => b.quantity > 0 && !isExpired(b.expiryDate, today)).sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));
  return usable.find((b) => b.quantity >= quantity) ?? usable[0];
}

const PER_DAY: Record<string, number> = { OD: 1, HS: 1, BD: 2, TDS: 3, QID: 4 };
const COUNTABLE = new Set(["tablet", "capsule", "sachet"]);

/**
 * Units to dispense for a prescription line: the prescribed quantity, or
 * dose x frequency x days for countable forms with a standard frequency.
 */
export function suggestQuantity(item: { quantity: number | null; form: string; dose: string; frequency: string; durationDays: number | null }): number | null {
  if (item.quantity) return item.quantity;
  if (!COUNTABLE.has(item.form) || !item.durationDays) return null;
  const freq = item.frequency.trim().toUpperCase();
  const perDose = Number(/^(\d+(?:\.\d+)?)/.exec(item.dose.trim())?.[1] ?? NaN);
  if (!Number.isFinite(perDose)) return null;
  if (freq === "WEEKLY") return Math.ceil(perDose * Math.ceil(item.durationDays / 7));
  const perDay = PER_DAY[freq];
  if (!perDay) return null;
  return Math.ceil(perDose * perDay * item.durationDays);
}

export type StockFlag = "out" | "low" | "expiring" | "expired" | "slow";

export function stockFlags(input: {
  onHand: number;
  reorderLevel: number;
  batches: BatchLike[];
  /** Last time stock went out, or when it first arrived if it never has. */
  lastMovedAt: Date | null;
  today: string;
  now: Date;
}): StockFlag[] {
  const flags: StockFlag[] = [];
  // "Out" only for what the pharmacy actually stocks: it has held this
  // medicine before, or set a reorder level for it. A starter-list entry the
  // clinic has never bought is not an alert.
  const stocked = input.batches.length > 0 || input.reorderLevel > 0;
  if (input.onHand === 0) {
    if (stocked) flags.push("out");
  } else if (input.reorderLevel > 0 && input.onHand <= input.reorderLevel) {
    flags.push("low");
  }
  const held = input.batches.filter((b) => b.quantity > 0);
  if (held.some((b) => isExpired(b.expiryDate, input.today))) flags.push("expired");
  if (held.some((b) => expiresWithin(b.expiryDate, input.today, EXPIRY_WARNING_DAYS))) flags.push("expiring");
  const quietDays = input.lastMovedAt ? (input.now.getTime() - input.lastMovedAt.getTime()) / 86_400_000 : 0;
  if (input.onHand > 0 && quietDays > SLOW_MOVING_DAYS) flags.push("slow");
  return flags;
}
