// Supplier bills, item names and the items & stock import: pure rules.
import { describe, expect, it } from "vitest";
import { isNewAlias, normalizeItemName, searchTokens } from "@/features/catalog/item-rules";
import { billTotals, duplicateLines, lineTotals, normalizeExpiry } from "@/features/pharmacy/purchase-rules";
import { parseCsv, validateStockRows, STOCK_TEMPLATE_CSV } from "@/features/pharmacy/stock-import-rules";
import { describeQuantity, packWord, sellingPrice, unitWord, unitsFor } from "@/features/pharmacy/selling-rules";

describe("item names", () => {
  it("normalises case, punctuation and spacing but keeps word order", () => {
    expect(normalizeItemName("  CLINIC   Needle, 24G ")).toBe("clinic needle 24g");
    expect(normalizeItemName("Amoxicillin+Clav 625")).toBe("amoxicillin+clav 625");
    expect(normalizeItemName("Needle clinic")).not.toBe(normalizeItemName("Clinic needle"));
    // Re-ordered numbers are different products, never the same name.
    expect(normalizeItemName("Amoxicillin 250 Clav 125")).not.toBe(normalizeItemName("Amoxicillin 125 Clav 250"));
  });

  it("searches by words in any order", () => {
    expect(searchTokens("Needle clinic")).toEqual(["needle", "clinic"]);
    expect(searchTokens("a b cd")).toEqual(["cd"]);
    expect(searchTokens("one two three four five six")).toHaveLength(5);
  });

  it("offers to remember only a genuinely new spelling", () => {
    expect(isNewAlias("Needle clinic", "Clinic needle", [])).toBe(true);
    expect(isNewAlias("clinic  NEEDLE", "Clinic needle", [])).toBe(false);
    expect(isNewAlias("Needle clinic", "Clinic needle", ["NEEDLE CLINIC"])).toBe(false);
    expect(isNewAlias("  ", "Clinic needle", [])).toBe(false);
  });
});

describe("bill lines", () => {
  it("turns packs into units, spreading the cost over free packs", () => {
    // 10 strips of 15 + 2 free strips, ₹30 a strip, MRP ₹45 a strip, 12% GST.
    const t = lineTotals({ quantity: 10, freeQuantity: 2, packSize: 15, rate: "30.00", mrp: "45.00", gstRate: 12 });
    expect(t.units).toBe(180);
    expect(t.amount).toBe("300.00");
    expect(t.taxAmount).toBe("36.00");
    expect(t.unitCost).toBe("1.67"); // 300 / 180, rounded to the paisa
    expect(t.unitMrp).toBe("3.00");
  });

  it("works per unit when a pack is one unit, without an MRP", () => {
    const t = lineTotals({ quantity: 100, freeQuantity: 0, packSize: 1, rate: "1.20", gstRate: 0 });
    expect(t).toEqual({ units: 100, amount: "120.00", taxAmount: "0.00", unitCost: "1.20", unitMrp: null });
  });

  it("adds up a bill exactly in paise", () => {
    const totals = billTotals([
      { quantity: 3, freeQuantity: 0, packSize: 10, rate: "33.33", gstRate: 5 },
      { quantity: 1, freeQuantity: 1, packSize: 1, rate: "0.10", gstRate: 18 },
    ]);
    expect(totals).toEqual({ subtotal: "100.09", tax: "5.02", total: "105.11", units: 32 });
  });

  it("flags the same item, batch and expiry twice", () => {
    const line = { drugId: "a", batchNo: "b1", expiryDate: "2027-12-31" };
    expect(duplicateLines([line, { ...line, batchNo: " B1 " }, { ...line, batchNo: "B2" }])).toEqual([1]);
  });

  it("reads expiries as printed on packs", () => {
    expect(normalizeExpiry("12/27")).toBe("2027-12-31");
    expect(normalizeExpiry("02/2028")).toBe("2028-02-29");
    expect(normalizeExpiry("6-29")).toBe("2029-06-30");
    expect(normalizeExpiry("15/08/2027")).toBe("2027-08-15");
    expect(normalizeExpiry("2027-08-15")).toBe("2027-08-15");
    expect(normalizeExpiry("13/27")).toBe("13/27");
  });
});

describe("items & stock import", () => {
  const TODAY = "2026-10-27";

  it("accepts the template as it is", () => {
    const { valid, problems } = validateStockRows(parseCsv(STOCK_TEMPLATE_CSV), TODAY);
    expect(problems).toEqual([]);
    expect(valid).toHaveLength(4);
    const [first, second, needle, bp] = valid;
    expect(first).toMatchObject({ name: "Paracetamol 650", itemType: "medicine", packSize: 15, price: "2.10", packPrice: "31.50", otherNames: ["Dolo 650", "Calpol 650"] });
    expect(first.batch).toEqual({ batchNo: "DL2401", expiryDate: "2027-12-31", quantity: 300, unitCost: "1.40" });
    expect(second.normalized).toBe(first.normalized);
    expect(needle).toMatchObject({ itemType: "consumable", form: "other", otherNames: ["Needle clinic", "Hypodermic needle 24G"] });
    expect(bp).toMatchObject({ itemType: "instrument", batch: null });
  });

  it("reports every problem with its line, and refuses the file", () => {
    const csv = [
      "item,type,batch,expiry,qty,price",
      ",medicine,,,,", // 2: no name
      "Gauze,bandage,,,,", // 3: unknown type
      "Syringe 5ml,consumable,S1,,10,", // 4: batch without expiry
      "Syringe 5ml,consumable,S2,01/2020,10,", // 5: expired
      "Syringe 5ml,consumable,S3,12/2030,ten,", // 6: quantity not a number
      "Cotton roll,consumable,,,,12.345", // 7: price
      "Syringe 5ml,consumable,S4,12/2030,5,", // 8: fine
      "syringe  5ML,consumable,S4,12/2030,5,", // 9: same batch as line 8
    ].join("\n");
    const { valid, problems } = validateStockRows(parseCsv(csv), TODAY);
    expect(problems.map((p) => [p.line, p.field])).toEqual([
      [2, "name"],
      [3, "itemType"],
      [4, "expiryDate"],
      [5, "expiryDate"],
      [6, "quantity"],
      [7, "price"],
      [9, "batchNo"],
    ]);
    expect(valid.map((v) => v.line)).toEqual([8]);
  });

  it("needs a name column and caps the size", () => {
    expect(validateStockRows(parseCsv("sku,qty\n1,2"), TODAY).problems[0].message).toMatch(/name/);
    const big = ["name", ...Array.from({ length: 3001 }, (_, i) => `Item ${i}`)].join("\n");
    expect(validateStockRows(parseCsv(big), TODAY).problems[0].message).toMatch(/At most 3000/);
  });
});

describe("selling loose or by the strip", () => {
  const paracetamol = { price: "2.10", packPrice: "31.50", packSize: 15 };

  it("charges a strip its own price, not units x a rounded unit price", () => {
    expect(sellingPrice(paracetamol, "unit")).toBe("2.10");
    expect(sellingPrice(paracetamol, "pack")).toBe("31.50");
    // Without a pack price, a strip is its units at the unit price.
    expect(sellingPrice({ ...paracetamol, packPrice: null }, "pack")).toBe("31.50");
    expect(sellingPrice({ price: null, packPrice: null, packSize: 10 }, "pack")).toBeNull();
  });

  it("takes stock out in single units", () => {
    expect(unitsFor(2, "pack", 15)).toBe(30);
    expect(unitsFor(9, "unit", 15)).toBe(9);
  });

  it("speaks the pharmacy's language", () => {
    expect([packWord("tablet"), packWord("capsule", 2), packWord("syrup", 2)]).toEqual(["strip", "strips", "packs"]);
    expect([unitWord("tablet", 2), unitWord("capsule"), unitWord("other", 3)]).toEqual(["tablets", "capsule", "units"]);
    expect(describeQuantity({ soldAs: "pack", quantity: 30, packs: 2, packSize: 15 }, "tablet")).toBe("2 strips (30 tablets)");
    expect(describeQuantity({ soldAs: "unit", quantity: 1, packs: null, packSize: 1 }, "tablet")).toBe("1 tablet");
  });
});
