// Pure patient rules (unit tested).

/** Digits only; for 11+ digit numbers keep the last 10 (drops +91 / leading 0). */
export function normalizeMobile(value: string | null | undefined): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, "");
  if (digits.length < 7) return null;
  return digits.length > 10 ? digits.slice(-10) : digits;
}

export function normalizeName(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function wholeYearsBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  let years = ty - fy;
  if (tm < fm || (tm === fm && td < fd)) years -= 1;
  return Math.max(0, years);
}

/**
 * Current age in whole years. A stated age is aged forward from the date it
 * was stated, so it does not silently go stale.
 */
export function ageOn(
  patient: { dateOfBirth: string | null; statedAgeYears: number | null; statedAgeOn: string | null },
  today: string,
): number | null {
  if (patient.dateOfBirth) return wholeYearsBetween(patient.dateOfBirth, today);
  if (patient.statedAgeYears != null && patient.statedAgeOn) {
    return patient.statedAgeYears + wholeYearsBetween(patient.statedAgeOn, today);
  }
  return null;
}

export function displayPatientName(p: {
  firstName: string | null;
  lastName: string | null;
  isPlaceholder?: boolean;
  emergencyLabel?: string | null;
}): string {
  const name = [p.firstName, p.lastName].filter(Boolean).join(" ").trim();
  if (name) return name;
  return p.emergencyLabel ?? "Unnamed patient";
}

export type DuplicateCandidate = {
  id: string;
  mrn: string;
  name: string;
  nameSimilarity: number;
  sameMobile: boolean;
  sameDob: boolean;
  ageGap: number | null;
};

/**
 * A candidate is a *likely* duplicate when the name is similar AND something
 * else matches. A shared mobile alone is never enough: families commonly
 * share one number.
 */
export function isLikelyDuplicate(c: DuplicateCandidate): boolean {
  if (c.nameSimilarity < 0.5) return false;
  return c.sameMobile || c.sameDob || (c.ageGap !== null && c.ageGap <= 2);
}

export function matchReasons(c: DuplicateCandidate): string[] {
  const reasons: string[] = [];
  if (c.nameSimilarity >= 0.5) reasons.push(c.nameSimilarity >= 0.9 ? "Same name" : "Similar name");
  if (c.sameMobile) reasons.push("Same mobile");
  if (c.sameDob) reasons.push("Same date of birth");
  else if (c.ageGap !== null && c.ageGap <= 2) reasons.push("Similar age");
  return reasons;
}
