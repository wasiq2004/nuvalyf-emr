import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { bmi, computeVitalFlags, flagValue, pickRange, type VitalRange } from "@/features/clinical/vital-rules";
import { allergyMatches, checkDrug, genericParts, needsOverride, type DrugForCheck } from "@/features/clinical/prescribing-rules";
import { pickNext } from "@/features/clinical/encounters.service";
import { validateVitalRange } from "@/features/catalog/catalog.service";
import { homeForRoles } from "@/lib/access/roles";
import {
  STARTER_ALLERGY_CLASSES,
  STARTER_DIAGNOSES,
  STARTER_DRUGS,
  STARTER_INTERACTIONS,
  STARTER_LAB_TESTS,
  STARTER_PRESETS,
  STARTER_VITAL_RANGES,
  vitalRangeKey,
} from "@/lib/catalog/starter";
import type { QueueItem } from "@/features/queue/queue.service";

const ranges: VitalRange[] = STARTER_VITAL_RANGES.map((r) => ({
  vital: r.vital,
  ageMinYears: r.ageMin,
  ageMaxYears: r.ageMax,
  low: r.low ?? null,
  high: r.high ?? null,
  criticalLow: r.criticalLow ?? null,
  criticalHigh: r.criticalHigh ?? null,
}));

describe("vital flags", () => {
  it("uses the band for the patient's age", () => {
    expect(pickRange(ranges, "pulse", 3)?.ageMaxYears).toBe(5);
    expect(pickRange(ranges, "pulse", 40)?.ageMinYears).toBe(13);
    expect(pickRange(ranges, "pulse", 0)?.ageMaxYears).toBe(0);
  });

  it("with no known age, only all-ages bands apply", () => {
    expect(pickRange(ranges, "pulse", null)).toBeUndefined();
    expect(pickRange(ranges, "temperature_c", null)).toBeDefined();
  });

  it("prefers the narrowest band when bands overlap", () => {
    const overlapping: VitalRange[] = [
      { vital: "pulse", ageMinYears: 0, ageMaxYears: 150, low: 50, high: 110, criticalLow: null, criticalHigh: null },
      { vital: "pulse", ageMinYears: 60, ageMaxYears: 150, low: 55, high: 95, criticalLow: null, criticalHigh: null },
    ];
    expect(pickRange(overlapping, "pulse", 70)?.ageMinYears).toBe(60);
  });

  it("flags low/high and critical limits inclusively", () => {
    const r = pickRange(ranges, "pulse", 40)!;
    expect(flagValue(59, r)).toBe("low");
    expect(flagValue(60, r)).toBeNull();
    expect(flagValue(101, r)).toBe("high");
    expect(flagValue(130, r)).toBe("critical_high");
    expect(flagValue(40, r)).toBe("critical_low");
  });

  it("computes flags for a set, skipping blanks and unflagged vitals", () => {
    expect(computeVitalFlags({ spo2: 89, temperature_c: 37, weight_kg: 70, pulse: null }, ranges, 30)).toEqual({ spo2: "critical_low" });
  });

  it("computes BMI", () => {
    expect(bmi(70, 175)).toBe(22.9);
    expect(bmi(null, 175)).toBeNull();
  });
});

const drug = (name: string, genericName: string, classes: { id: string; name: string }[] = []): DrugForCheck => ({ name, genericName, classes });

describe("prescribing checks", () => {
  const rules = [{ genericA: "Warfarin", genericB: "Aspirin", severity: "major" as const, description: "Bleeding" }];

  it("splits combination generics", () => {
    expect(genericParts("Amoxicillin + Clavulanic acid")).toEqual(["amoxicillin", "clavulanic acid"]);
    expect(genericParts("Sulfamethoxazole/Trimethoprim")).toEqual(["sulfamethoxazole", "trimethoprim"]);
  });

  it("matches allergies by class, generic, brand name or class name", () => {
    const amox = drug("Amoxicillin + Clavulanate 625", "Amoxicillin + Clavulanic acid", [{ id: "pen", name: "Penicillins" }]);
    expect(allergyMatches({ substance: "anything", allergyClassId: "pen", severity: "severe" }, amox)).toBe(true);
    expect(allergyMatches({ substance: "Amoxicillin", allergyClassId: null, severity: "mild" }, amox)).toBe(true);
    expect(allergyMatches({ substance: "penicillin", allergyClassId: null, severity: "mild" }, amox)).toBe(true);
    expect(allergyMatches({ substance: "Sulfa", allergyClassId: null, severity: "mild" }, amox)).toBe(false);
    expect(allergyMatches({ substance: "pe", allergyClassId: null, severity: "mild" }, amox)).toBe(false);
  });

  it("finds interactions in either order and duplicates of the same molecule", () => {
    const aspirin = drug("Aspirin 75", "Aspirin");
    const warfarin = drug("Warfarin 5", "Warfarin");
    const ctx = { allergies: [], rules, current: [warfarin, drug("Paracetamol 500", "Paracetamol")] };
    expect(checkDrug(aspirin, ctx).map((w) => w.severity)).toEqual(["major"]);
    expect(checkDrug(drug("Paracetamol 650", "Paracetamol"), ctx).map((w) => w.kind)).toEqual(["duplicate"]);
    expect(checkDrug(warfarin, { ...ctx, current: [aspirin] })[0].kind).toBe("interaction");
  });

  it("puts allergies first and needs a reason for allergy/major/contraindicated", () => {
    const aspirin = drug("Aspirin 75", "Aspirin", [{ id: "sal", name: "Aspirin / salicylates" }]);
    const warnings = checkDrug(aspirin, {
      allergies: [{ substance: "Aspirin", allergyClassId: null, severity: "severe" }],
      current: [drug("Warfarin 5", "Warfarin")],
      rules,
    });
    expect(warnings[0].kind).toBe("allergy");
    expect(needsOverride(warnings)).toBe(true);
    expect(needsOverride([{ kind: "interaction", severity: "moderate", message: "" }])).toBe(false);
  });
});

describe("call next", () => {
  const item = (id: string, over: Partial<QueueItem>): QueueItem =>
    ({ id, status: "waiting", isEmergency: false, doctorId: null, position: 0, arrivedAt: new Date(), ...over }) as QueueItem;

  it("takes emergencies first, then ready, then waiting; never another doctor's patient", () => {
    const queue = [
      item("other", { status: "ready", doctorId: "dr-b" }),
      item("waiting", { status: "waiting" }),
      item("ready", { status: "ready", doctorId: "dr-a" }),
      item("emergency", { status: "waiting", isEmergency: true }),
      item("triage", { status: "in_triage" }),
    ];
    expect(pickNext(queue, "dr-a")?.id).toBe("emergency");
    expect(pickNext(queue.filter((q) => q.id !== "emergency"), "dr-a")?.id).toBe("ready");
    expect(pickNext([queue[0], queue[4]], "dr-a")).toBeUndefined();
  });
});

describe("catalogue rules", () => {
  it("validates the order of range limits", () => {
    const base = { vital: "pulse", ageMinYears: 13, ageMaxYears: 150, low: 60, high: 100, criticalLow: 40, criticalHigh: 130 };
    expect(validateVitalRange(base)).toBeNull();
    expect(validateVitalRange({ ...base, low: 100, high: 60 })).not.toBeNull();
    expect(validateVitalRange({ ...base, criticalLow: 70 })).not.toBeNull();
    expect(validateVitalRange({ ...base, ageMinYears: 20, ageMaxYears: 10 })).not.toBeNull();
    expect(validateVitalRange({ ...base, low: null, high: null, criticalLow: null, criticalHigh: null })).not.toBeNull();
  });

  it("lands the lab technician on /lab only when the clinic has the lab module", () => {
    expect(homeForRoles(["lab_tech"], new Set(["lab"]))).toBe("/lab");
    expect(homeForRoles(["lab_tech"], new Set())).toBe("/today");
  });
});

describe("starter templates", () => {
  const unique = (values: string[]) => new Set(values).size === values.length;

  it("have unique, stable keys", () => {
    expect(unique(STARTER_DRUGS.map((d) => d.key))).toBe(true);
    expect(unique(STARTER_ALLERGY_CLASSES.map((c) => c.key))).toBe(true);
    expect(unique(STARTER_INTERACTIONS.map((i) => i.key))).toBe(true);
    expect(unique(STARTER_PRESETS.map((p) => p.key))).toBe(true);
    expect(unique(STARTER_DIAGNOSES.map((d) => d.code))).toBe(true);
    expect(unique(STARTER_VITAL_RANGES.map(vitalRangeKey))).toBe(true);
    expect(unique(STARTER_LAB_TESTS.map((t) => t.key))).toBe(true);
  });

  it("only reference allergy classes that exist", () => {
    const classes = new Set(STARTER_ALLERGY_CLASSES.map((c) => c.key));
    for (const d of STARTER_DRUGS) for (const c of d.classes ?? []) expect(classes, `${d.key} -> ${c}`).toContain(c);
  });

  it("have well-formed vital ranges", () => {
    for (const r of ranges) expect(validateVitalRange(r), JSON.stringify(r)).toBeNull();
  });

  it("use numeric day counts for duration presets", () => {
    for (const p of STARTER_PRESETS.filter((p) => p.kind === "duration")) expect(p.value).toMatch(/^\d+$/);
  });
});
