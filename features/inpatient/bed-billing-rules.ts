// Bed charges (unit tested). docs/INPATIENT_DESIGN.md.
//
// The clock runs from admission. Part hours count as a full hour.
//   hourly: the exact hours stayed, at daily rate / 24. 30 h = rate / 24 x 30.
//   block:  whole 24-hour blocks, rounded up. 26 h is charged as 48 h.
// Either way a stay is charged at least `minimumHours` (default 24).
//
// A patient who changes beds is on one clock: rounding happens once, on the
// whole stay, so moving bed never adds a second minimum or a second block. Any
// hours added by rounding are charged at the latest bed's rate.

export const BILLING_MODES = ["hourly", "block"] as const;
export type BillingMode = (typeof BILLING_MODES)[number];

export const BILLING_MODE_LABELS: Record<BillingMode, string> = {
  hourly: "By the hour",
  block: "Full 24-hour blocks",
};

const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;

export function billedHours(minutes: number, mode: BillingMode, minimumHours: number): number {
  const hours = Math.max(0, Math.ceil(minutes / MINUTES_PER_HOUR));
  const atLeast = Math.max(hours, minimumHours);
  if (mode === "hourly") return atLeast;
  return Math.max(1, Math.ceil(atLeast / HOURS_PER_DAY)) * HOURS_PER_DAY;
}

/** Paise for `hours` at a daily rate in paise. */
export function bedAmount(dailyRate: number, hours: number): number {
  return Math.round((dailyRate * hours) / HOURS_PER_DAY);
}

export type StaySegment = { minutes: number; dailyRate: number; overrideHours?: number | null; overrideRate?: number | null };
export type BilledSegment = { hours: number; rate: number; amount: number; overridden: boolean };

/** Splits the stay's billed hours across its beds, in order. */
export function billSegments(segments: StaySegment[], mode: BillingMode, minimumHours: number): BilledSegment[] {
  if (segments.length === 0) return [];
  const total = billedHours(segments.reduce((s, x) => s + x.minutes, 0), mode, minimumHours);
  let elapsed = 0;
  let given = 0;
  return segments.map((segment, index) => {
    elapsed += segment.minutes;
    const upTo = index === segments.length - 1 ? total : Math.min(total, Math.ceil(elapsed / MINUTES_PER_HOUR));
    const computed = Math.max(0, upTo - given);
    given += computed;
    const hours = segment.overrideHours ?? computed;
    const rate = segment.overrideRate ?? segment.dailyRate;
    return { hours, rate, amount: bedAmount(rate, hours), overridden: segment.overrideHours != null || segment.overrideRate != null };
  });
}

/** Whole days and hours for people: 30 h is "30 h (1 day 6 h)". */
export function hoursText(hours: number): string {
  const days = Math.floor(hours / HOURS_PER_DAY);
  if (days === 0) return `${hours} h`;
  const rest = hours % HOURS_PER_DAY;
  return `${hours} h (${days} ${days === 1 ? "day" : "days"}${rest ? ` ${rest} h` : ""})`;
}

export type BillTotals = { bed: number; charges: number; gross: number; discount: number; net: number; paid: number; balance: number };

/** A negative balance is money to give back. */
export function billTotals(bed: number, charges: number, discount: number, paid: number): BillTotals {
  const gross = bed + charges;
  const net = gross - discount;
  return { bed, charges, gross, discount, net, paid, balance: net - paid };
}
