// Filling a prescription differently from how it was written (unit tested).
// docs/PHARMACY_DISPENSING.md. The pharmacist decides: a patient prescribed 30
// days may buy 15 now and the rest later, or the dose or medicine may change.
// The doctor's signed copy is never edited; each sale line keeps its own copy.
import { suggestQuantity } from "./stock-rules";

export type Dosage = { dose: string | null; frequency: string | null; durationDays: number | null; instructions: string | null };

export const LINE_CHANGES = ["none", "as_prescribed", "changed", "substituted", "added"] as const;
export type LineChange = (typeof LINE_CHANGES)[number];

export const LINE_CHANGE_LABELS: Record<LineChange, string> = {
  none: "",
  as_prescribed: "As prescribed",
  changed: "Dosage changed",
  substituted: "Medicine changed",
  added: "Added by pharmacy",
};

const same = (a: string | null | undefined, b: string | null | undefined) => (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();

/** "1 tablet · BD · 15 days · after food" */
export function dosageText(d: Dosage): string {
  return [d.dose, d.frequency, d.durationDays ? `${d.durationDays} ${d.durationDays === 1 ? "day" : "days"}` : null, d.instructions]
    .map((part) => (typeof part === "string" ? part.trim() : part))
    .filter(Boolean)
    .join(" · ");
}

export function classifyLine(prescribed: (Dosage & { drugId: string | null }) | null, given: Dosage, drugId: string): LineChange {
  if (!prescribed) return "added";
  if (prescribed.drugId && prescribed.drugId !== drugId) return "substituted";
  const changed =
    !same(prescribed.dose, given.dose) ||
    !same(prescribed.frequency, given.frequency) ||
    !same(prescribed.instructions, given.instructions) ||
    (prescribed.durationDays ?? null) !== (given.durationDays ?? null);
  return changed ? "changed" : "as_prescribed";
}

/** Units for a number of days at this dosage; null when it cannot be worked out. */
export function quantityForDays(item: { form: string; dose: string; frequency: string }, days: number): number | null {
  if (!Number.isInteger(days) || days <= 0) return null;
  return suggestQuantity({ ...item, quantity: null, durationDays: days });
}

/** Days of the course still to collect, to start the form with on a return visit. */
export function daysLeft(needed: number | null, durationDays: number | null, remaining: number | null): number | null {
  if (!durationDays || !needed || remaining === null) return durationDays;
  return Math.max(0, Math.ceil((remaining / needed) * durationDays));
}
