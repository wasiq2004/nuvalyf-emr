import { describe, expect, it } from "vitest";
import { bedAmount, billSegments, billTotals, billedHours, hoursText } from "@/features/inpatient/bed-billing-rules";

const h = (hours: number) => hours * 60;

describe("hours charged", () => {
  it("hourly: a 30-hour stay is charged 30 hours", () => {
    expect(billedHours(h(30), "hourly", 24)).toBe(30);
    expect(billedHours(h(24), "hourly", 24)).toBe(24);
  });

  it("block: 26 hours is charged as 48", () => {
    expect(billedHours(h(26), "block", 24)).toBe(48);
    expect(billedHours(h(24), "block", 24)).toBe(24);
    expect(billedHours(h(24) + 1, "block", 24)).toBe(48);
    expect(billedHours(h(48), "block", 24)).toBe(48);
    expect(billedHours(h(49), "block", 24)).toBe(72);
  });

  it("charges at least the minimum", () => {
    expect(billedHours(h(5), "hourly", 24)).toBe(24);
    expect(billedHours(h(5), "block", 24)).toBe(24);
    expect(billedHours(h(5), "hourly", 12)).toBe(12);
    expect(billedHours(h(5), "hourly", 0)).toBe(5);
    expect(billedHours(h(5), "block", 0)).toBe(24);
    expect(billedHours(0, "hourly", 0)).toBe(0);
  });

  it("a part hour counts as a full hour", () => {
    expect(billedHours(h(30) + 1, "hourly", 24)).toBe(31);
    expect(billedHours(h(30) - 1, "hourly", 24)).toBe(30);
  });
});

describe("amounts", () => {
  it("is the daily rate divided by 24, to the paisa", () => {
    expect(bedAmount(240000, 30)).toBe(300000); // ₹2,400 a day for 30 h = ₹3,000
    expect(bedAmount(100000, 1)).toBe(4167); // ₹1,000 / 24 rounded
    expect(bedAmount(240000, 48)).toBe(480000);
  });
});

describe("changing beds", () => {
  const general = 120000;
  const icu = 480000;

  it("charges each bed for its own hours", () => {
    const lines = billSegments([{ minutes: h(20), dailyRate: general }, { minutes: h(10), dailyRate: icu }], "hourly", 24);
    expect(lines.map((l) => l.hours)).toEqual([20, 10]);
    expect(lines.map((l) => l.amount)).toEqual([100000, 200000]);
  });

  it("does not add a second minimum or block for the move", () => {
    const hourly = billSegments([{ minutes: h(1), dailyRate: general }, { minutes: h(1), dailyRate: icu }], "hourly", 24);
    expect(hourly.reduce((s, l) => s + l.hours, 0)).toBe(24);
    const block = billSegments([{ minutes: h(20), dailyRate: general }, { minutes: h(6), dailyRate: icu }], "block", 24);
    expect(block.map((l) => l.hours)).toEqual([20, 28]);
    expect(block.reduce((s, l) => s + l.hours, 0)).toBe(48);
  });

  it("does not round the same part hour twice", () => {
    const lines = billSegments([{ minutes: h(20) + 30, dailyRate: general }, { minutes: h(5) + 30, dailyRate: icu }], "hourly", 24);
    expect(lines.reduce((s, l) => s + l.hours, 0)).toBe(26);
  });

  it("puts rounding on the latest bed", () => {
    const lines = billSegments([{ minutes: h(2), dailyRate: general }, { minutes: h(2), dailyRate: icu }], "hourly", 24);
    expect(lines.map((l) => l.hours)).toEqual([2, 22]);
  });

  it("honours an authorised change to hours or rate", () => {
    const [line] = billSegments([{ minutes: h(30), dailyRate: general, overrideHours: 24, overrideRate: 100000 }], "hourly", 24);
    expect(line).toEqual({ hours: 24, rate: 100000, amount: 100000, overridden: true });
  });
});

describe("the bill", () => {
  it("takes part payments and shows what is left", () => {
    expect(billTotals(300000, 50000, 10000, 200000)).toEqual({ bed: 300000, charges: 50000, gross: 350000, discount: 10000, net: 340000, paid: 200000, balance: 140000 });
  });

  it("shows an overpaid advance as money to give back", () => {
    expect(billTotals(100000, 0, 0, 150000).balance).toBe(-50000);
  });

  it("describes hours for people", () => {
    expect(hoursText(30)).toBe("30 h (1 day 6 h)");
    expect(hoursText(48)).toBe("48 h (2 days)");
    expect(hoursText(5)).toBe("5 h");
  });
});
