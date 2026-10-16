import { describe, expect, it } from "vitest";
import { ageBand, cohortDefinitionSchema, definitionChanged, describeDefinition, pseudonym, suppress, suppressValue } from "@/features/analytics/analytics-rules";

describe("bands and suppression", () => {
  it("bands ages", () => {
    expect([0, 4, 5, 14, 15, 24, 25, 44, 45, 64, 65, 100].map(ageBand)).toEqual(["0-4", "0-4", "5-14", "5-14", "15-24", "15-24", "25-44", "25-44", "45-64", "45-64", "65+", "65+"]);
    expect(ageBand(null)).toBe("unknown");
  });

  it("hides 1..threshold-1, keeps 0 and larger counts, and never goes below the platform minimum", () => {
    const { rows, suppressed } = suppress([{ k: "a", count: 0 }, { k: "b", count: 1 }, { k: "c", count: 4 }, { k: "d", count: 5 }, { k: "e", count: 40 }], 5);
    expect(rows.map((r) => r.count)).toEqual([0, null, null, 5, 40]);
    expect(suppressed).toBe(2);
    expect(suppressValue(2, 1)).toBeNull(); // a clinic cannot go below 3
    expect(suppressValue(3, 1)).toBe(3);
  });
});

describe("pseudonyms", () => {
  const saltA = "a".repeat(64);
  const saltB = "b".repeat(64);
  const patient = "8d4f0e8e-2b1a-4c3d-9f00-1234567890ab";
  it("are stable within a cohort and unrelated across cohorts", () => {
    expect(pseudonym(saltA, patient)).toBe(pseudonym(saltA, patient));
    expect(pseudonym(saltA, patient)).not.toBe(pseudonym(saltB, patient));
    expect(pseudonym(saltA, patient)).toMatch(/^p_[0-9a-f]{16}$/);
    expect(pseudonym(saltA, patient)).not.toContain(patient.slice(0, 8));
  });
});

describe("cohort definitions", () => {
  const base = { from: "2026-01-01", to: "2026-06-30" };
  it("require a window, and accept only known criteria", () => {
    expect(cohortDefinitionSchema.safeParse({}).success).toBe(false);
    expect(cohortDefinitionSchema.parse(base)).toEqual({ ...base, diagnosisPrefixes: [], drugGenerics: [] });
    for (const extra of ["mrn", "name", "mobile", "patientId"]) {
      expect(cohortDefinitionSchema.safeParse({ ...base, [extra]: "x" }).success, extra).toBe(false);
    }
  });

  it("validate codes, generics, ages and the window", () => {
    expect(cohortDefinitionSchema.parse({ ...base, diagnosisPrefixes: [" e11 "], drugGenerics: ["Metformin"] })).toMatchObject({ diagnosisPrefixes: ["E11"], drugGenerics: ["metformin"] });
    expect(cohortDefinitionSchema.safeParse({ ...base, diagnosisPrefixes: ["E11'; drop"] }).success).toBe(false);
    expect(cohortDefinitionSchema.safeParse({ ...base, ageMin: 50, ageMax: 40 }).success).toBe(false);
    expect(cohortDefinitionSchema.safeParse({ from: "2026-06-30", to: "2026-01-01" }).success).toBe(false);
    expect(cohortDefinitionSchema.safeParse({ from: "2020-01-01", to: "2026-01-01" }).success).toBe(false);
  });

  it("only version a real change", () => {
    const a = cohortDefinitionSchema.parse({ ...base, diagnosisPrefixes: ["E11", "I10"] });
    expect(definitionChanged(a, cohortDefinitionSchema.parse({ ...base, diagnosisPrefixes: ["I10", "E11"] }))).toBe(false);
    expect(definitionChanged(a, cohortDefinitionSchema.parse({ ...base, diagnosisPrefixes: ["E11"] }))).toBe(true);
    expect(describeDefinition(a)).toEqual(["Visited between 2026-01-01 and 2026-06-30", "Diagnosed: E11, I10"]);
  });
});
