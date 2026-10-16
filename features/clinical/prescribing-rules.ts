// Pure prescribing checks (unit tested). The same function runs when a drug
// is chosen (live warning) and again on the server when the item is saved,
// so the check cannot be skipped by calling the action directly.

export type InteractionSeverity = "minor" | "moderate" | "major" | "contraindicated";

export type InteractionRule = {
  genericA: string;
  genericB: string;
  severity: InteractionSeverity;
  description: string;
};

export type DrugForCheck = {
  name: string;
  genericName: string;
  /** Allergy classes the drug belongs to. */
  classes: { id: string; name: string }[];
};

export type AllergyForCheck = {
  substance: string;
  allergyClassId: string | null;
  severity: string;
};

export type RxWarning = {
  kind: "allergy" | "interaction" | "duplicate";
  severity: InteractionSeverity | "allergy";
  message: string;
};

const norm = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");

/** "Amoxicillin + Clavulanic acid" -> ["amoxicillin", "clavulanic acid"]. */
export function genericParts(generic: string): string[] {
  return generic
    .split(/\s*(?:\+|,|&|\/|\band\b)\s*/i)
    .map(norm)
    .filter(Boolean);
}

/** Does a recorded allergy apply to this drug? */
export function allergyMatches(allergy: AllergyForCheck, drug: DrugForCheck): boolean {
  if (allergy.allergyClassId && drug.classes.some((c) => c.id === allergy.allergyClassId)) return true;
  const substance = norm(allergy.substance);
  if (substance.length < 3) return false;
  if (genericParts(drug.genericName).some((part) => part === substance || part.startsWith(substance))) return true;
  if (norm(drug.name).includes(substance)) return true;
  // "penicillin" recorded as free text still catches the Penicillins class.
  return drug.classes.some((c) => {
    const cls = norm(c.name);
    return cls.includes(substance) || substance.includes(cls.replace(/s$/, ""));
  });
}

export function checkDrug(
  candidate: DrugForCheck,
  context: { allergies: AllergyForCheck[]; current: DrugForCheck[]; rules: InteractionRule[] },
): RxWarning[] {
  const warnings: RxWarning[] = [];

  for (const allergy of context.allergies) {
    if (allergyMatches(allergy, candidate)) {
      warnings.push({
        kind: "allergy",
        severity: "allergy",
        message: `Recorded allergy: ${allergy.substance}${allergy.severity ? ` (${allergy.severity})` : ""}.`,
      });
    }
  }

  const candidateParts = genericParts(candidate.genericName);
  for (const other of context.current) {
    const otherParts = genericParts(other.genericName);
    const shared = candidateParts.filter((p) => otherParts.includes(p));
    if (shared.length) {
      warnings.push({
        kind: "duplicate",
        severity: "moderate",
        message: `${other.name} already contains ${shared.join(", ")}.`,
      });
    }
    for (const rule of context.rules) {
      const a = norm(rule.genericA);
      const b = norm(rule.genericB);
      const hit =
        (candidateParts.includes(a) && otherParts.includes(b)) || (candidateParts.includes(b) && otherParts.includes(a));
      if (hit) {
        warnings.push({
          kind: "interaction",
          severity: rule.severity,
          message: `With ${other.name}: ${rule.description}`,
        });
      }
    }
  }

  return warnings.sort((x, y) => SEVERITY_RANK[y.severity] - SEVERITY_RANK[x.severity]);
}

const SEVERITY_RANK: Record<RxWarning["severity"], number> = {
  allergy: 5,
  contraindicated: 4,
  major: 3,
  moderate: 2,
  minor: 1,
};

/** Allergy, major and contraindicated warnings need a written reason to proceed. */
export function needsOverride(warnings: RxWarning[]): boolean {
  return warnings.some((w) => w.severity === "allergy" || w.severity === "major" || w.severity === "contraindicated");
}

export const SEVERITY_LABELS: Record<RxWarning["severity"], string> = {
  allergy: "Allergy",
  contraindicated: "Contraindicated",
  major: "Major",
  moderate: "Moderate",
  minor: "Minor",
};
