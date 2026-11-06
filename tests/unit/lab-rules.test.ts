import { describe, expect, it } from "vitest";
import { cumulativeRows, numericFlag, overallFlag, parseLabNumber, pickRange, rangeText, resultSummary, textFlag, type LabRange } from "@/features/clinical/lab-rules";
import { STARTER_LAB_PARAMETERS } from "@/lib/catalog/starter-lab";
import { STARTER_LAB_TESTS } from "@/lib/catalog/starter";

const range = (r: Partial<LabRange>): LabRange => ({ sex: "any", ageMinYears: 0, ageMaxYears: null, low: null, high: null, criticalLow: null, criticalHigh: null, ...r });

describe("choosing the reference range", () => {
  const male = range({ sex: "male", low: 13, high: 17 });
  const female = range({ sex: "female", low: 12, high: 15 });
  const child = range({ ageMaxYears: 12, low: 11, high: 14 });
  const everyone = range({ low: 10, high: 18 });

  it("prefers the patient's sex", () => {
    expect(pickRange([everyone, male, female], "male", 40)).toBe(male);
    expect(pickRange([everyone, male, female], "female", 40)).toBe(female);
    expect(pickRange([everyone, male, female], "unknown", 40)).toBe(everyone);
  });

  it("prefers the narrowest age band that fits", () => {
    expect(pickRange([everyone, child], "male", 8)).toBe(child);
    expect(pickRange([everyone, child], "male", 40)).toBe(everyone);
  });

  it("uses only an all-ages range when the age is unknown", () => {
    expect(pickRange([child, everyone], "male", null)).toBe(everyone);
    expect(pickRange([child], "male", null)).toBeNull();
  });

  it("returns nothing when none applies", () => {
    expect(pickRange([male], "female", 30)).toBeNull();
    expect(pickRange([], "female", 30)).toBeNull();
  });
});

describe("flags", () => {
  const r = range({ low: 13, high: 17, criticalLow: 7, criticalHigh: 20 });

  it("grades numbers, with boundaries inside the range", () => {
    expect(numericFlag(13, r)).toBe("normal");
    expect(numericFlag(17, r)).toBe("normal");
    expect(numericFlag(12.9, r)).toBe("low");
    expect(numericFlag(17.1, r)).toBe("high");
    expect(numericFlag(7, r)).toBe("low");
    expect(numericFlag(6.9, r)).toBe("critical_low");
    expect(numericFlag(20.1, r)).toBe("critical_high");
  });

  it("does not flag what has no range", () => {
    expect(numericFlag(999, null)).toBe("normal");
    expect(textFlag("Positive", null)).toBe("normal");
  });

  it("compares words loosely", () => {
    expect(textFlag(" negative ", "Negative")).toBe("normal");
    expect(textFlag("Positive", "Negative")).toBe("abnormal");
  });

  it("rolls up to one flag for the doctor", () => {
    expect(overallFlag(["normal", "normal"])).toBe("normal");
    expect(overallFlag(["normal", "low"])).toBe("abnormal");
    expect(overallFlag(["high", "critical_low"])).toBe("critical");
  });

  it("takes plain numbers only", () => {
    expect(parseLabNumber(" 10.2 ")).toBe(10.2);
    expect(parseLabNumber("10.2 g/dL")).toBeNull();
    expect(parseLabNumber("<0.5")).toBeNull();
    expect(parseLabNumber("")).toBeNull();
  });
});

describe("what is printed", () => {
  it("shows the range the way a report does", () => {
    expect(rangeText(range({ low: 13, high: 17 }))).toBe("13 - 17");
    expect(rangeText(range({ high: 200 }))).toBe("< 200");
    expect(rangeText(range({ low: 40 }))).toBe("> 40");
    expect(rangeText(null, "Negative")).toBe("Negative");
    expect(rangeText(null)).toBe("");
  });

  it("summarises what is off, or everything when it is short", () => {
    const hb = { name: "Hb", value: "10.2", unit: "g/dL", flag: "low" as const };
    const plt = { name: "Platelets", value: "250000", unit: null, flag: "normal" as const };
    expect(resultSummary([hb, plt])).toBe("Hb 10.2 g/dL (L)");
    expect(resultSummary([plt])).toBe("Platelets 250000");
    expect(resultSummary([plt, plt, plt, plt])).toBe("All 4 parameters within range");
  });
});

describe("results over time", () => {
  const cell = (date: string, orderId: string, unit: string, value: string) => ({ key: "hb", name: "Haemoglobin", unit, date, orderId, value, number: Number(value), flag: "normal" as const, ref: "" });

  it("orders dates and keeps two reports on one day apart", () => {
    const { dates, rows } = cumulativeRows([cell("2026-11-02", "b", "g/dL", "12"), cell("2026-10-01", "a", "g/dL", "11"), cell("2026-11-02", "c", "g/dL", "13")]);
    expect(dates.map((d) => d.orderId)).toEqual(["a", "b", "c"]);
    expect(rows).toHaveLength(1);
    expect(rows[0].cells).toHaveLength(3);
  });

  it("never puts two units on one row", () => {
    const { rows } = cumulativeRows([cell("2026-10-01", "a", "g/dL", "11"), cell("2026-11-01", "b", "g/L", "110")]);
    expect(rows.map((r) => r.unit)).toEqual(["g/dL", "g/L"]);
  });
});

describe("the starter parameters", () => {
  const params = Object.entries(STARTER_LAB_PARAMETERS);

  it("belong to tests that exist, and every test has some", () => {
    const keys = STARTER_LAB_TESTS.map((t) => t.key);
    for (const [test] of params) expect(keys).toContain(test);
    for (const key of keys) expect(STARTER_LAB_PARAMETERS[key]?.length, key).toBeGreaterThan(0);
  });

  it("have unique keys within a test and sensible ranges", () => {
    for (const [test, list] of params) {
      expect(new Set(list.map((p) => p.key)).size, test).toBe(list.length);
      for (const p of list) {
        expect(Boolean(p.text) || (p.ranges?.length ?? 0) > 0, `${test}:${p.key}`).toBe(true);
        for (const r of p.ranges ?? []) {
          if (r.low !== undefined && r.high !== undefined) expect(r.low, `${test}:${p.key}`).toBeLessThan(r.high);
          if (r.criticalLow !== undefined && r.low !== undefined) expect(r.criticalLow, `${test}:${p.key}`).toBeLessThan(r.low);
          if (r.criticalHigh !== undefined && r.high !== undefined) expect(r.criticalHigh, `${test}:${p.key}`).toBeGreaterThan(r.high);
        }
      }
    }
  });
});
