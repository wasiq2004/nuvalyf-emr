// Pure analytics rules (unit tested).
//
// Nothing here ever handles a name, mobile number or record number:
//   - inputs are strict schemas, so an unexpected field (e.g. "mrn") is refused
//   - patients appear only as a cohort-specific pseudonym and an age band
//   - any count below the clinic's threshold is returned as null, and the
//     number of suppressed cells is reported instead
import { createHmac } from "crypto";
import { z } from "zod";

export const PLATFORM_MIN_CELL = 3;
export const DEFAULT_MIN_CELL = 5;

export const AGE_BANDS = ["0-4", "5-14", "15-24", "25-44", "45-64", "65+"] as const;
export type AgeBand = (typeof AGE_BANDS)[number] | "unknown";

export function ageBand(age: number | null): AgeBand {
  if (age === null || age < 0) return "unknown";
  if (age <= 4) return "0-4";
  if (age <= 14) return "5-14";
  if (age <= 24) return "15-24";
  if (age <= 44) return "25-44";
  if (age <= 64) return "45-64";
  return "65+";
}

export type Cell = number | null;

/**
 * Small-cell suppression: counts from 1 to threshold-1 become null. Zero is
 * not identifying and stays. Returns how many cells were hidden.
 */
export function suppress<T extends { count: number }>(rows: T[], threshold: number): { rows: (Omit<T, "count"> & { count: Cell })[]; suppressed: number } {
  const limit = Math.max(threshold, PLATFORM_MIN_CELL);
  let suppressed = 0;
  return {
    rows: rows.map((row) => {
      if (row.count > 0 && row.count < limit) {
        suppressed += 1;
        return { ...row, count: null };
      }
      return row;
    }),
    suppressed,
  };
}

export function suppressValue(count: number, threshold: number): Cell {
  return count > 0 && count < Math.max(threshold, PLATFORM_MIN_CELL) ? null : count;
}

/** A pseudonym that only means something inside one cohort. */
export function pseudonym(cohortSalt: string, patientId: string): string {
  return `p_${createHmac("sha256", Buffer.from(cohortSalt, "hex")).update(patientId).digest("hex").slice(0, 16)}`;
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use yyyy-mm-dd");

/** Last day of the month a date falls in. */
export function monthEnd(date: string): string {
  const [y, m] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

export function monthStart(date: string): string {
  return `${date.slice(0, 7)}-01`;
}
const MAX_WINDOW_DAYS = 3 * 366;

/**
 * What a cohort may select on. Strict: any other field is refused, so
 * identifiers cannot be smuggled into a definition.
 */
export const cohortDefinitionSchema = z
  .object({
    from: isoDate,
    to: isoDate,
    diagnosisPrefixes: z.array(z.string().trim().toUpperCase().regex(/^[A-Z][0-9A-Z.]{0,9}$/, "ICD-10 codes or prefixes, like E11 or J06.9")).max(20).default([]),
    drugGenerics: z.array(z.string().trim().toLowerCase().regex(/^[a-z][a-z0-9 \-]{1,60}$/, "Generic names, like metformin")).max(20).default([]),
    sex: z.enum(["male", "female", "other", "unknown"]).optional(),
    ageMin: z.number().int().min(0).max(130).optional(),
    ageMax: z.number().int().min(0).max(130).optional(),
  })
  .strict()
  .refine((d) => d.from <= d.to, { message: "The window must end after it starts", path: ["to"] })
  // Coarse windows and age bounds: two cohorts that differ by a single day or
  // a single year of age could otherwise single a patient out by subtraction.
  .refine((d) => d.from === monthStart(d.from) && d.to === monthEnd(d.to), { message: "Use whole months: from the 1st to the last day of a month", path: ["from"] })
  .refine((d) => d.ageMin === undefined || d.ageMin % 5 === 0, { message: "Age bounds go in 5-year steps (0, 5, 10…)", path: ["ageMin"] })
  .refine((d) => d.ageMax === undefined || (d.ageMax + 1) % 5 === 0, { message: "Age bounds go in 5-year steps (…44, 49, 54)", path: ["ageMax"] })
  .refine((d) => (Date.parse(d.to) - Date.parse(d.from)) / 86_400_000 <= MAX_WINDOW_DAYS, { message: "The window can be at most 3 years", path: ["to"] })
  .refine((d) => d.ageMin === undefined || d.ageMax === undefined || d.ageMin <= d.ageMax, { message: "Minimum age is above maximum", path: ["ageMax"] });

export type CohortDefinition = z.output<typeof cohortDefinitionSchema>;

export function describeDefinition(d: CohortDefinition): string[] {
  const parts = [`Visited between ${d.from} and ${d.to}`];
  if (d.diagnosisPrefixes.length) parts.push(`Diagnosed: ${d.diagnosisPrefixes.join(", ")}`);
  if (d.drugGenerics.length) parts.push(`Prescribed: ${d.drugGenerics.join(", ")}`);
  if (d.sex) parts.push(`Sex: ${d.sex}`);
  if (d.ageMin !== undefined || d.ageMax !== undefined) parts.push(`Age ${d.ageMin ?? 0}–${d.ageMax ?? "any"}`);
  return parts;
}

/** Row-level export columns. Deliberately no identifiers and no exact age. */
export const EXPORT_COLUMNS = ["pseudonym", "age_band", "sex", "visits_in_window", "diagnosis_codes", "medicine_generics"] as const;

/** Whether a definition changed in a way that needs a new version. */
export function definitionChanged(a: CohortDefinition, b: CohortDefinition): boolean {
  const norm = (d: CohortDefinition) =>
    JSON.stringify({ ...d, diagnosisPrefixes: [...d.diagnosisPrefixes].sort(), drugGenerics: [...d.drugGenerics].sort() });
  return norm(a) !== norm(b);
}
