// Pure reorder rule (unit tested). docs/PHARMACY_DESIGN.md 4.7.
//
// Order when stock is at or below the reorder level, or will not last the
// supplier's lead time at the current rate of sale. Order enough to cover
// lead time + cover days, in whole packs.

export type ReorderInput = {
  onHand: number;
  reorderLevel: number;
  /** Units sold or dispensed over the last `days`. */
  unitsOut: number;
  days: number;
  packSize: number;
  leadDays: number;
  coverDays: number;
};

export type ReorderSuggestion = { units: number; packs: number; daily: number; reason: "reorder_level" | "running_out" };

export function suggestOrder(input: ReorderInput): ReorderSuggestion | null {
  const daily = input.days > 0 ? input.unitsOut / input.days : 0;
  const belowLevel = input.reorderLevel > 0 && input.onHand <= input.reorderLevel;
  const runningOut = daily > 0 && input.onHand < daily * input.leadDays;
  if (!belowLevel && !runningOut) return null;

  const target = Math.ceil(daily * (input.leadDays + input.coverDays));
  // With no sales history, top up to twice the reorder level.
  const wanted = Math.max(target, belowLevel ? input.reorderLevel * 2 : 0) - input.onHand;
  if (wanted <= 0) return null;
  const pack = Math.max(1, input.packSize);
  const packs = Math.ceil(wanted / pack);
  return { units: packs * pack, packs, daily: Math.round(daily * 100) / 100, reason: belowLevel ? "reorder_level" : "running_out" };
}
