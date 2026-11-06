// Pure rules for counting the shelves (unit tested).

export const COUNT_REASONS = {
  unexplained: "Missing, cause unknown",
  billing: "Sale or bill entered wrongly",
  damaged: "Damaged: write off",
  expired: "Expired: write off",
  found: "Found on the shelf",
  other: "Other",
} as const;
export type CountReason = keyof typeof COUNT_REASONS;
export const COUNT_REASON_KEYS = Object.keys(COUNT_REASONS) as CountReason[];

/** Items in a daily count: small enough to do before opening. */
export const CYCLE_SIZE = 20;
/** H1 and X stock is counted at least this often, however little it sells. */
export const CONTROLLED_COUNT_DAYS = 30;

export type CountedLine = { firstCount: number | null; firstSystem: number | null; recount: number | null; recountSystem: number | null };

/** The latest count and what the ledger said at that moment, or null if uncounted. */
export function settled(line: CountedLine): { counted: number; system: number } | null {
  if (line.recount !== null) return { counted: line.recount, system: line.recountSystem ?? 0 };
  if (line.firstCount !== null) return { counted: line.firstCount, system: line.firstSystem ?? 0 };
  return null;
}

/** Shelf minus ledger: negative is a shortage. Null if uncounted. */
export function difference(line: CountedLine): number | null {
  const s = settled(line);
  return s ? s.counted - s.system : null;
}

/** The ledger's word for a correction. A write-off can only take stock away. */
export function movementReason(reason: CountReason, change: number): "adjustment" | "damaged" | "expired" {
  if (change < 0 && (reason === "damaged" || reason === "expired")) return reason;
  return "adjustment";
}

/** What must be settled before a line can post, or null. */
export function lineProblem(line: CountedLine & { reason: string | null; note: string | null; name: string; batchNo: string }): string | null {
  const change = difference(line);
  if (!change) return null;
  if (!line.reason) return `${line.name} batch ${line.batchNo}: choose why it differs.`;
  if (line.reason === "other" && !line.note?.trim()) return `${line.name} batch ${line.batchNo}: add a note.`;
  if (change > 0 && (line.reason === "damaged" || line.reason === "expired")) return `${line.name} batch ${line.batchNo}: a write-off cannot add stock.`;
  return null;
}

export type CycleCandidate = { drugId: string; schedule: string; lastCounted: string | null; unitsSold: number };

const isControlled = (schedule: string) => schedule === "H1" || schedule === "X";

/**
 * Today's count: controlled stock that is due first, then whatever has gone
 * longest without a count, the fastest sellers first among equals. Every item
 * comes round in time without anyone keeping a list.
 */
export function pickCycleItems(items: CycleCandidate[], size: number, cutoff: string): string[] {
  const due = (i: CycleCandidate) => isControlled(i.schedule) && (i.lastCounted === null || i.lastCounted < cutoff);
  return [...items]
    .sort((a, b) => {
      if (due(a) !== due(b)) return due(a) ? -1 : 1;
      const last = (a.lastCounted ?? "").localeCompare(b.lastCounted ?? "");
      return last !== 0 ? last : b.unitsSold - a.unitsSold;
    })
    .slice(0, size)
    .map((i) => i.drugId);
}
