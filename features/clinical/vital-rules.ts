// Pure vital-sign rules (unit tested). Flags are always computed on the
// server against the clinic's own age-banded ranges; the browser only shows
// what the server decided.
import type { VitalKey } from "@/lib/catalog/starter";

export type { VitalKey };

export type VitalField = {
  key: VitalKey;
  label: string;
  short: string;
  unit: string;
  /** Plausibility bounds: values outside are typing mistakes, not readings. */
  min: number;
  max: number;
  step: number;
};

export const VITAL_FIELDS: VitalField[] = [
  { key: "temperature_c", label: "Temperature", short: "Temp", unit: "°C", min: 25, max: 45, step: 0.1 },
  { key: "systolic", label: "Systolic BP", short: "SBP", unit: "mmHg", min: 40, max: 300, step: 1 },
  { key: "diastolic", label: "Diastolic BP", short: "DBP", unit: "mmHg", min: 20, max: 200, step: 1 },
  { key: "pulse", label: "Pulse", short: "Pulse", unit: "/min", min: 20, max: 300, step: 1 },
  { key: "resp_rate", label: "Respiratory rate", short: "RR", unit: "/min", min: 4, max: 100, step: 1 },
  { key: "spo2", label: "SpO₂", short: "SpO₂", unit: "%", min: 30, max: 100, step: 1 },
  { key: "weight_kg", label: "Weight", short: "Wt", unit: "kg", min: 0.3, max: 400, step: 0.1 },
  { key: "height_cm", label: "Height", short: "Ht", unit: "cm", min: 20, max: 250, step: 0.1 },
];

export const VITAL_LABELS = Object.fromEntries(VITAL_FIELDS.map((f) => [f.key, f.label])) as Record<VitalKey, string>;

export type VitalFlag = "low" | "high" | "critical_low" | "critical_high";

export type VitalRange = {
  vital: string;
  ageMinYears: number;
  ageMaxYears: number;
  low: number | null;
  high: number | null;
  criticalLow: number | null;
  criticalHigh: number | null;
};

/**
 * The range that applies to a patient of this age: the narrowest active band
 * containing the age. With no known age, only bands covering every age apply,
 * so a child of unknown age is never judged against adult limits.
 */
export function pickRange(ranges: VitalRange[], vital: string, ageYears: number | null): VitalRange | undefined {
  const candidates = ranges.filter((r) => {
    if (r.vital !== vital) return false;
    if (ageYears === null) return r.ageMinYears <= 0 && r.ageMaxYears >= 120;
    return ageYears >= r.ageMinYears && ageYears <= r.ageMaxYears;
  });
  return candidates.sort((a, b) => a.ageMaxYears - a.ageMinYears - (b.ageMaxYears - b.ageMinYears))[0];
}

export function flagValue(value: number, range: VitalRange | undefined): VitalFlag | null {
  if (!range) return null;
  if (range.criticalLow !== null && value <= range.criticalLow) return "critical_low";
  if (range.criticalHigh !== null && value >= range.criticalHigh) return "critical_high";
  if (range.low !== null && value < range.low) return "low";
  if (range.high !== null && value > range.high) return "high";
  return null;
}

export type VitalValues = Partial<Record<VitalKey, number | null>>;

export function computeVitalFlags(values: VitalValues, ranges: VitalRange[], ageYears: number | null): Partial<Record<VitalKey, VitalFlag>> {
  const flags: Partial<Record<VitalKey, VitalFlag>> = {};
  for (const field of VITAL_FIELDS) {
    const value = values[field.key];
    if (value === null || value === undefined) continue;
    const flag = flagValue(value, pickRange(ranges, field.key, ageYears));
    if (flag) flags[field.key] = flag;
  }
  return flags;
}

export function isCritical(flag: VitalFlag | null | undefined) {
  return flag === "critical_low" || flag === "critical_high";
}

export function bmi(weightKg: number | null | undefined, heightCm: number | null | undefined): number | null {
  if (!weightKg || !heightCm) return null;
  const m = heightCm / 100;
  return Math.round((weightKg / (m * m)) * 10) / 10;
}

export const FLAG_LABELS: Record<VitalFlag, string> = {
  low: "Low",
  high: "High",
  critical_low: "Critically low",
  critical_high: "Critically high",
};
