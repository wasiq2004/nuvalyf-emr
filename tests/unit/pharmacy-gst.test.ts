// GST, numbering, returns, schedules and reordering: the pure rules behind
// docs/PHARMACY_DESIGN.md.
import { describe, expect, it } from "vitest";
import { GSTIN_PATTERN, allocate, backOutTax, priceSale, roundToRupee, stateOfGstin, taxModeFor } from "@/features/pharmacy/gst-rules";
import { counterKey, documentNumber, fiscalYear } from "@/features/pharmacy/numbering";
import { addValues, emptyValue, purchaseReturnValue, returnValue, returnable } from "@/features/pharmacy/return-rules";
import { inRegister, missingDetails, requiredDetails } from "@/features/pharmacy/schedule-rules";
import { suggestOrder } from "@/features/pharmacy/reorder-rules";

describe("sharing a discount", () => {
  it("splits in proportion and always adds up exactly", () => {
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocate(1000, [3000, 1000])).toEqual([750, 250]);
    expect(allocate(0, [5, 5])).toEqual([0, 0]);
    expect(allocate(7, [0, 0])).toEqual([0, 0]);
    for (const [total, weights] of [
      [997, [1234, 5678, 91011]],
      [1, [3, 3, 3]],
      [12345, [1, 2, 3, 4, 5, 6, 7]],
    ] as const) {
      expect(allocate(total, [...weights]).reduce((a, b) => a + b, 0)).toBe(total);
    }
  });
});

describe("tax inside an MRP", () => {
  it("backs out 5 % GST and splits it between CGST and SGST", () => {
    // VGM2: ₹210.76 at 5 %.
    expect(backOutTax(21076, 5, "intra")).toEqual({ taxable: 20072, cgst: 502, sgst: 502, igst: 0 });
    // An odd paisa of tax goes to SGST.
    expect(backOutTax(10000, 12, "intra")).toEqual({ taxable: 8929, cgst: 535, sgst: 536, igst: 0 });
  });

  it("charges IGST to a buyer in another state, nothing on a bill of supply", () => {
    expect(backOutTax(10000, 12, "inter")).toEqual({ taxable: 8929, cgst: 0, sgst: 0, igst: 1071 });
    expect(backOutTax(10000, 12, "none")).toEqual({ taxable: 10000, cgst: 0, sgst: 0, igst: 0 });
    expect(backOutTax(10000, 0, "intra")).toEqual({ taxable: 10000, cgst: 0, sgst: 0, igst: 0 });
  });

  it("rounds to the rupee like the counter", () => {
    expect(roundToRupee(21076)).toEqual({ roundOff: 24, total: 21100 }); // their Rs 210.76 -> Rs 211.00
    expect(roundToRupee(21049)).toEqual({ roundOff: -49, total: 21000 });
    expect(roundToRupee(21050)).toEqual({ roundOff: 50, total: 21100 });
    expect(roundToRupee(21000)).toEqual({ roundOff: 0, total: 21000 });
  });
});

describe("pricing a sale", () => {
  it("reconciles to the paisa: lines, discount, tax and round-off", () => {
    const sale = priceSale(
      [
        { gross: 21076, gstRate: 5 },
        { gross: 4500, gstRate: 12 },
        { gross: 999, gstRate: 0 },
      ],
      { discount: 1000, roundOff: true, mode: "intra" },
    );
    expect(sale.gross).toBe(26575);
    expect(sale.lines.map((l) => l.discount).reduce((a, b) => a + b, 0)).toBe(1000);
    for (const l of sale.lines) expect(l.taxable + l.cgst + l.sgst + l.igst).toBe(l.net);
    expect(sale.net).toBe(25575);
    expect(sale.taxable + sale.tax).toBe(sale.net);
    expect(sale.total).toBe(25600);
    expect(sale.roundOff).toBe(25);
  });

  it("never discounts more than the bill, and can switch round-off off", () => {
    const sale = priceSale([{ gross: 500, gstRate: 5 }], { discount: 9999, roundOff: false, mode: "intra" });
    expect(sale).toMatchObject({ discount: 500, net: 0, total: 0, roundOff: 0 });
  });

  it("charges no GST on a bill of supply", () => {
    const sale = priceSale([{ gross: 10000, gstRate: 12 }], { discount: 0, roundOff: false, mode: "none" });
    expect(sale).toMatchObject({ tax: 0, taxable: 10000 });
    expect(sale.lines[0].gstRate).toBe(0);
  });
});

describe("GSTIN and place of supply", () => {
  it("recognises a GSTIN and its state", () => {
    expect(GSTIN_PATTERN.test("33AABCU9603R1ZM")).toBe(true);
    expect(stateOfGstin("33AABCU9603R1ZM")).toBe("33");
    expect(stateOfGstin("33AABCU9603R1Z")).toBeNull();
  });
  it("uses IGST only for a buyer in another state", () => {
    expect(taxModeFor("regular", "33", null)).toBe("intra");
    expect(taxModeFor("regular", "33", "33")).toBe("intra");
    expect(taxModeFor("regular", "33", "29")).toBe("inter");
    expect(taxModeFor("composition", "33", "29")).toBe("none");
  });
});

describe("document numbers", () => {
  it("follows the April-March financial year", () => {
    expect(fiscalYear("2026-03-31")).toBe("2025-26");
    expect(fiscalYear("2026-04-01")).toBe("2026-27");
    expect(fiscalYear("2099-12-31")).toBe("2099-00");
    expect(counterKey("sale", "2026-27")).toBe("sale:2026-27");
  });
  it("fits GST's 16 characters", () => {
    const n = documentNumber("creditNote", "2026-27", 123);
    expect(n).toBe("CN/2627/000123");
    expect(documentNumber("sale", "2026-27", 999999).length).toBeLessThanOrEqual(16);
  });
});

describe("returns", () => {
  const line = { net: 10000, taxable: 8929, cgst: 535, sgst: 536, igst: 0 };

  it("refunds a share, and the last units take exactly what is left", () => {
    const first = returnValue(line, 3, 0, emptyValue(), 1);
    expect(first.net).toBe(first.taxable + first.cgst + first.sgst + first.igst);
    const second = returnValue(line, 3, 1, first, 1);
    const both = addValues(first, second);
    const last = returnValue(line, 3, 2, both, 1);
    expect(addValues(both, last)).toEqual(line);
  });

  it("refuses more than was sold", () => {
    expect(returnable(10, 4)).toBe(6);
    expect(() => returnValue(line, 3, 2, emptyValue(), 2)).toThrow();
  });

  it("values a debit note at batch cost plus GST", () => {
    expect(purchaseReturnValue(167, 30, 5)).toEqual({ taxable: 5010, tax: 251 });
  });
});

describe("scheduled drugs", () => {
  it("asks for what each schedule needs", () => {
    expect(requiredDetails(["none", "G"])).toEqual([]);
    expect(requiredDetails(["H"])).toEqual(["prescriberName"]);
    expect(requiredDetails(["H", "H1"])).toEqual(["prescriberName", "prescriberRegNo", "patientName", "patientAddress"]);
    expect(missingDetails(["H1"], { prescriberName: "Dr Rao", prescriberRegNo: " ", patientName: "Asha" })).toEqual([
      "doctor's registration number",
      "patient's address",
    ]);
    expect([inRegister("H1"), inRegister("X"), inRegister("H")]).toEqual([true, true, false]);
  });
});

describe("reordering", () => {
  const base = { reorderLevel: 0, days: 30, packSize: 10, leadDays: 7, coverDays: 15 };
  it("orders when stock will not last the lead time, in whole packs", () => {
    // 3 a day; 15 on hand lasts 5 days < 7 lead days. Target 3 x 22 = 66, need 51 -> 6 packs.
    expect(suggestOrder({ ...base, onHand: 15, unitsOut: 90 })).toEqual({ units: 60, packs: 6, daily: 3, reason: "running_out" });
  });
  it("orders at the reorder level even without sales history", () => {
    expect(suggestOrder({ ...base, reorderLevel: 20, onHand: 20, unitsOut: 0 })).toMatchObject({ units: 20, reason: "reorder_level" });
  });
  it("leaves well-stocked items alone", () => {
    expect(suggestOrder({ ...base, onHand: 500, unitsOut: 90 })).toBeNull();
    expect(suggestOrder({ ...base, onHand: 0, unitsOut: 0 })).toBeNull();
  });
});

describe("Code 128 labels", async () => {
  const { PATTERNS, bars, encodeValues, isEncodable } = await import("@/features/pharmacy/code128");
  it("has a well-formed pattern table", () => {
    expect(PATTERNS).toHaveLength(107);
    PATTERNS.forEach((p, i) => {
      const modules = [...p].reduce((s, c) => s + Number(c), 0);
      expect(modules, `symbol ${i}`).toBe(i === 106 ? 13 : 11);
    });
    expect(new Set(PATTERNS).size).toBe(107);
  });
  it("encodes with start B, checksum and stop", () => {
    // "PJJ123C": the worked example from the Code 128 specification literature.
    const v = encodeValues("PJJ123C");
    expect(v[0]).toBe(104);
    expect(v.at(-1)).toBe(106);
    const data = [..."PJJ123C"].map((c) => c.charCodeAt(0) - 32);
    expect(v.at(-2)).toBe((104 + data.reduce((s, d, i) => s + d * (i + 1), 0)) % 103);
    // Every symbol is 11 modules, the stop 13, plus two 10-module quiet zones.
    expect(bars("PJJ123C").width).toBe(20 + 11 * (v.length - 1) + 13);
  });
  it("refuses what set B cannot print", () => {
    expect(isEncodable("NL00012")).toBe(true);
    expect(isEncodable("")).toBe(false);
    expect(isEncodable("ä")).toBe(false);
    expect(() => encodeValues("tab\there")).toThrow();
  });
});
