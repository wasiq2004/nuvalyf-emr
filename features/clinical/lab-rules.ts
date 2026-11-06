// Pure lab result rules (unit tested). The range and flag are decided on the
// server when a result is saved, against the patient's age and sex, and kept
// with the result: changing a range later never alters an old report.

export type LabRange = {
  sex: "any" | "male" | "female";
  ageMinYears: number;
  ageMaxYears: number | null;
  low: number | null;
  high: number | null;
  criticalLow: number | null;
  criticalHigh: number | null;
};

export const LAB_FLAGS = ["normal", "low", "high", "critical_low", "critical_high", "abnormal", "critical"] as const;
export type LabFlag = (typeof LAB_FLAGS)[number];

/** What a technician can choose for a parameter they added themselves. */
export const CHOSEN_LAB_FLAGS = ["normal", "low", "high", "abnormal", "critical"] as const satisfies readonly LabFlag[];
export type ChosenLabFlag = (typeof CHOSEN_LAB_FLAGS)[number];

export const LAB_FLAG_LABELS: Record<LabFlag, string> = { normal: "", low: "Low", high: "High", critical_low: "Critical low", critical_high: "Critical high", abnormal: "Abnormal", critical: "Critical" };
/** The short mark printed beside a value. */
export const LAB_FLAG_MARKS: Record<LabFlag, string> = { normal: "", low: "L", high: "H", critical_low: "LL", critical_high: "HH", abnormal: "*", critical: "**" };

export const isCriticalFlag = (flag: string) => flag === "critical" || flag === "critical_low" || flag === "critical_high";

/** Sex-specific beats "any"; among those, the narrowest age band that fits. */
export function pickRange(ranges: LabRange[], sex: string, age: number | null): LabRange | null {
  const fits = ranges.filter((r) => {
    if (r.sex !== "any" && r.sex !== sex) return false;
    if (age === null) return r.ageMinYears === 0 && r.ageMaxYears === null;
    return age >= r.ageMinYears && (r.ageMaxYears === null || age <= r.ageMaxYears);
  });
  const span = (r: LabRange) => (r.ageMaxYears ?? 200) - r.ageMinYears;
  return [...fits].sort((a, b) => Number(b.sex !== "any") - Number(a.sex !== "any") || span(a) - span(b))[0] ?? null;
}

export function numericFlag(value: number, range: LabRange | null): LabFlag {
  if (!range) return "normal";
  if (range.criticalLow !== null && value < range.criticalLow) return "critical_low";
  if (range.criticalHigh !== null && value > range.criticalHigh) return "critical_high";
  if (range.low !== null && value < range.low) return "low";
  if (range.high !== null && value > range.high) return "high";
  return "normal";
}

export function textFlag(value: string, normal: string | null): LabFlag {
  if (!normal) return "normal";
  return value.trim().toLowerCase() === normal.trim().toLowerCase() ? "normal" : "abnormal";
}

/** "13 - 17", "< 200", "> 40", or the expected word. */
export function rangeText(range: LabRange | null, normal?: string | null): string {
  if (normal) return normal;
  if (!range) return "";
  if (range.low !== null && range.high !== null) return `${range.low} - ${range.high}`;
  if (range.high !== null) return `< ${range.high}`;
  if (range.low !== null) return `> ${range.low}`;
  return "";
}

/** The order's overall flag, for the doctor's unread list. */
export function overallFlag(flags: LabFlag[]): "normal" | "abnormal" | "critical" {
  if (flags.some(isCriticalFlag)) return "critical";
  return flags.every((f) => f === "normal") ? "normal" : "abnormal";
}

/** A numeric result as typed: no units, no words. */
export function parseLabNumber(text: string): number | null {
  const t = text.trim();
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : null;
}

/** Limits from a range the technician typed: "13 - 17", "13 to 17", "< 5", "> 40". */
export function parseReference(text: string | null | undefined): { low: number | null; high: number | null } | null {
  const t = (text ?? "").trim();
  const between = /^(\d+(?:\.\d+)?)\s*(?:-|–|to)\s*(\d+(?:\.\d+)?)$/i.exec(t);
  if (between) {
    const [low, high] = [Number(between[1]), Number(between[2])];
    return low <= high ? { low, high } : null;
  }
  const below = /^(?:<=?|≤|upto|up to)\s*(\d+(?:\.\d+)?)$/i.exec(t);
  if (below) return { low: null, high: Number(below[1]) };
  const above = /^(?:>=?|≥)\s*(\d+(?:\.\d+)?)$/i.exec(t);
  if (above) return { low: Number(above[1]), high: null };
  return null;
}

/**
 * The flag on a parameter the technician added. Their choice stands, except that
 * a number outside the range they typed can never be saved as normal.
 */
export function addedLineFlag(value: string, reference: string | null | undefined, chosen: ChosenLabFlag | undefined): LabFlag {
  const picked = chosen ?? "normal";
  const number = parseLabNumber(value);
  const limits = parseReference(reference);
  if (picked === "critical" || number === null || !limits) return picked;
  const computed = numericFlag(number, { sex: "any", ageMinYears: 0, ageMaxYears: null, criticalLow: null, criticalHigh: null, ...limits });
  return computed === "normal" ? picked : computed;
}

export type ResultLine = { name: string; value: string; unit: string | null; flag: LabFlag };

/** One line for the doctor's lists: what is off first, or everything if nothing is. */
export function resultSummary(lines: ResultLine[]): string {
  const off = lines.filter((l) => l.flag !== "normal");
  const shown = (off.length ? off : lines).map((l) => `${l.name} ${l.value}${l.unit ? ` ${l.unit}` : ""}${l.flag !== "normal" ? ` (${LAB_FLAG_MARKS[l.flag]})` : ""}`);
  const text = shown.join("; ");
  if (off.length === 0 && lines.length > 3) return `All ${lines.length} parameters within range`;
  return text.length > 480 ? `${text.slice(0, 477)}...` : text;
}

export type TrendCell = { date: string; orderId: string; value: string; number: number | null; flag: LabFlag; ref: string };
export type TrendRow = { key: string; name: string; unit: string | null; cells: TrendCell[] };

type Flat = { key: string; name: string; unit: string | null; date: string; orderId: string; value: string; number: number | null; flag: LabFlag; ref: string };

/**
 * Results as parameter-by-date rows. A parameter measured in a different unit
 * becomes its own row, so unlike values are never compared on one line.
 */
export function cumulativeRows(results: Flat[]): { dates: { date: string; orderId: string }[]; rows: TrendRow[] } {
  const seen = new Map<string, { date: string; orderId: string }>();
  for (const r of results) seen.set(`${r.date}|${r.orderId}`, { date: r.date, orderId: r.orderId });
  const dates = [...seen.values()].sort((a, b) => a.date.localeCompare(b.date) || a.orderId.localeCompare(b.orderId));
  const rows = new Map<string, TrendRow>();
  for (const r of results) {
    const key = `${r.key}|${r.unit ?? ""}`;
    const row = rows.get(key) ?? { key, name: r.name, unit: r.unit, cells: [] };
    row.cells.push({ date: r.date, orderId: r.orderId, value: r.value, number: r.number, flag: r.flag, ref: r.ref });
    rows.set(key, row);
  }
  return { dates, rows: [...rows.values()] };
}
