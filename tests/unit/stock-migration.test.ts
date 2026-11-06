// The rules that keep a move from old software honest: dates, strips against
// tablets, batch MRPs, stock value, and counting.
import { describe, expect, it } from "vitest";
import { dateOrderOf, parseCsv, parseExpiry, parsePackQuantity, validateStockRows } from "@/features/pharmacy/stock-import-rules";
import { batchCeiling, batchPrice } from "@/features/pharmacy/selling-rules";
import { costValue, mrpValue } from "@/features/pharmacy/stock-rules";
import { difference, lineProblem, movementReason, pickCycleItems, settled } from "@/features/pharmacy/stock-count-rules";
import { validateBalanceRows } from "@/features/pharmacy/opening-balances-rules";

const TODAY = "2026-11-06";
const file = (rows: string[]) => parseCsv(["name,generic_name,units_per_pack,batch_no,expiry_date,quantity,unit_cost", ...rows].join("\n"));

describe("dates in an old export", () => {
  it("reads who wrote the file from any date that settles it", () => {
    expect(dateOrderOf(["31/12/2027", "12/1/2027"])).toBe("dmy");
    expect(dateOrderOf(["12/31/2027", "12/1/2027"])).toBe("mdy");
    expect(dateOrderOf(["12/1/2027"])).toBe("ambiguous");
    expect(dateOrderOf(["1/1/2027", "12/2027", "2027-01-31"])).toBe("dmy");
    expect(dateOrderOf(["31/12/2027", "12/31/2027"])).toBe("mixed");
  });

  it("reads 12/1/2027 as 1 December when the file is month-first, and 12 January when day-first", () => {
    expect(parseExpiry("12/1/2027", "mdy")).toBe("2027-12-01");
    expect(parseExpiry("12/1/2027", "dmy")).toBe("2027-01-12");
  });

  it("refuses a date that could go either way rather than guess", () => {
    const { problems } = validateStockRows(file(["Dolo 650,Paracetamol,15,B1,12/1/2027,30,"]), TODAY);
    expect(problems[0].message).toMatch(/could be read two ways/);
  });

  it("accepts the same date once another line settles the order", () => {
    const { valid, problems } = validateStockRows(file(["Dolo 650,Paracetamol,15,B1,12/1/2027,30,", "Dolo 650,Paracetamol,15,B2,12/31/2027,30,"]), TODAY);
    expect(problems).toEqual([]);
    expect(valid.map((v) => v.batch?.expiryDate)).toEqual(["2027-12-01", "2027-12-31"]);
  });

  it("refuses a file mixing the two orders outright", () => {
    const { valid, problems } = validateStockRows(file(["A,x,1,B1,31/12/2027,1,", "B,x,1,B2,12/31/2027,1,"]), TODAY);
    expect(valid).toEqual([]);
    expect(problems[0].message).toMatch(/day-first and others month-first/);
  });

  it("names the Excel date number instead of calling it a bad date", () => {
    expect(validateStockRows(file(["A,x,1,B1,46752,1,"]), TODAY).problems[0].message).toMatch(/how Excel stores a date/);
  });
});

describe("batch numbers Excel has damaged", () => {
  it("refuses 1.2E+05, where the real batch is already gone", () => {
    expect(validateStockRows(file(["A,x,1,1.2E+05,12/2027,1,"]), TODAY).problems[0].message).toMatch(/shortens a long number/);
  });

  it("leaves a real batch that merely looks odd", () => {
    expect(validateStockRows(file(["A,x,1,12E4X,12/2027,1,"]), TODAY).problems).toEqual([]);
  });
});

describe("quantities", () => {
  it("reads packs, and packs with loose units", () => {
    expect(parsePackQuantity("4")).toEqual({ packs: 4, loose: 0 });
    expect(parsePackQuantity("4:5")).toEqual({ packs: 4, loose: 5 });
    expect(parsePackQuantity("4 + 5")).toEqual({ packs: 4, loose: 5 });
    expect(parsePackQuantity("four")).toBeNull();
  });

  it("treats a zero as an item with no stock, since old software lists sold-out batches", () => {
    const { valid, problems } = validateStockRows(file(["A,x,1,B1,12/2027,0,"]), TODAY);
    expect(problems).toEqual([]);
    expect(valid[0].batch).toBeNull();
  });

  it("refuses negative stock and says what to do about it", () => {
    expect(validateStockRows(file(["A,x,1,B1,12/2027,-4,"]), TODAY).problems[0].message).toMatch(/count what is really on the shelf/);
  });

  it("marks expired stock instead of refusing it", () => {
    const { valid, problems } = validateStockRows(file(["A,x,1,B1,01/2025,10,"]), TODAY);
    expect(problems).toEqual([]);
    expect(valid[0].batch?.expired).toBe(true);
  });

  it("takes a cost as per pack when the file counts packs", () => {
    const { valid } = validateStockRows(file(["A,x,15,B1,12/2027,4:5,12.35"]), TODAY, "packs");
    expect(valid[0].batch).toMatchObject({ packs: 4, loose: 5, unitCost: null, packCost: "12.35" });
  });
});

describe("a batch never sells above its printed MRP", () => {
  const item = { price: "3.00", packPrice: "45.00", packSize: 15 };

  it("leaves the clinic's own price alone when it is lower", () => {
    expect(batchPrice(item, { mrp: "50.00", packSize: 15 }, "pack")).toBe("45.00");
  });

  it("brings an older batch down to what is printed on it", () => {
    expect(batchPrice(item, { mrp: "40.00", packSize: 15 }, "pack")).toBe("40.00");
    expect(batchPrice(item, { mrp: "40.00", packSize: 15 }, "unit")).toBe("2.66");
  });

  it("rounds a loose unit down, so loose can never beat the strip's MRP", () => {
    expect(Number(batchCeiling({ mrp: "34.00", packSize: 15 }, "unit", 15)) * 15).toBeLessThanOrEqual(34);
  });

  it("converts when the batch was packed differently from the item", () => {
    expect(batchCeiling({ mrp: "30.00", packSize: 10 }, "pack", 15)).toBe("45.00");
  });

  it("changes nothing for a batch with no MRP", () => {
    expect(batchPrice(item, { mrp: null, packSize: null }, "pack")).toBe("45.00");
    expect(batchPrice(item, null, "unit")).toBe("3.00");
  });

  it("sells at the MRP when the item has no price of its own", () => {
    expect(batchPrice({ price: null, packPrice: null, packSize: 10 }, { mrp: "24.70", packSize: 10 }, "pack")).toBe("24.70");
  });
});

describe("stock value", () => {
  it("is exact from a pack cost that cannot be held per tablet", () => {
    // Rs 12.35 for 15 tablets is 0.8233...: 150 tablets are 10 strips, Rs 123.50.
    expect(costValue({ quantity: 150, unitCost: "0.82", packCost: "12.35", packSize: 15, mrp: null })).toBe(12350);
  });

  it("falls back to the unit cost, and admits when there is none", () => {
    expect(costValue({ quantity: 10, unitCost: "1.40", packCost: null, packSize: null, mrp: null })).toBe(1400);
    expect(costValue({ quantity: 10, unitCost: null, packCost: null, packSize: null, mrp: null })).toBeNull();
  });

  it("values a part strip at MRP", () => {
    expect(mrpValue({ quantity: 20, unitCost: null, packCost: null, packSize: 15, mrp: "30.00" }, 15)).toBe(4000);
  });
});

describe("counting", () => {
  const line = (first: number | null, system: number | null, recount: number | null = null, recountSystem: number | null = null) => ({ firstCount: first, firstSystem: system, recount, recountSystem });

  it("judges a line by its latest count, against the ledger at that moment", () => {
    expect(difference(line(95, 100))).toBe(-5);
    expect(difference(line(95, 100, 90, 90))).toBe(0);
    expect(settled(line(null, null))).toBeNull();
    expect(difference(line(null, null))).toBeNull();
  });

  it("needs a reason for a difference, and a note for 'other'", () => {
    const base = { ...line(95, 100), name: "Dolo", batchNo: "B1", reason: null, note: null };
    expect(lineProblem(base)).toMatch(/choose why/);
    expect(lineProblem({ ...base, reason: "other" })).toMatch(/add a note/);
    expect(lineProblem({ ...base, reason: "other", note: "Spilt" })).toBeNull();
    expect(lineProblem({ ...base, firstCount: 100 })).toBeNull();
  });

  it("will not let a write-off add stock", () => {
    expect(lineProblem({ ...line(105, 100), name: "Dolo", batchNo: "B1", reason: "damaged", note: null })).toMatch(/cannot add stock/);
    expect(movementReason("damaged", -5)).toBe("damaged");
    expect(movementReason("damaged", 5)).toBe("adjustment");
    expect(movementReason("unexplained", -5)).toBe("adjustment");
  });

  it("puts overdue controlled stock first, then whatever has waited longest", () => {
    const picked = pickCycleItems(
      [
        { drugId: "recent", schedule: "none", lastCounted: "2026-11-01", unitsSold: 500 },
        { drugId: "never-slow", schedule: "none", lastCounted: null, unitsSold: 1 },
        { drugId: "never-fast", schedule: "none", lastCounted: null, unitsSold: 90 },
        { drugId: "h1-due", schedule: "H1", lastCounted: "2026-09-01", unitsSold: 0 },
        { drugId: "h1-fine", schedule: "H1", lastCounted: "2026-11-01", unitsSold: 0 },
      ],
      3,
      "2026-10-07",
    );
    expect(picked).toEqual(["h1-due", "never-fast", "never-slow"]);
  });
});

describe("opening balances file", () => {
  const rows = (lines: string[]) => parseCsv(["type,name,amount,as_of,reference", ...lines].join("\n"));

  it("takes customers, suppliers, advances and several bills for one party", () => {
    const { valid, problems } = validateBalanceRows(rows(["customer,Ramesh,480.00,31/03/2026,", "supplier,Apollo,1000,31/03/2026,INV1", "supplier,Apollo,2000,31/03/2026,INV2", "customer,Sunrise,-250.50,,"]), TODAY);
    expect(problems).toEqual([]);
    expect(valid).toHaveLength(4);
    expect(valid[3]).toMatchObject({ amount: "-250.50", asOf: TODAY });
  });

  it("refuses a wrong type, a zero, a future date and the same bill twice", () => {
    const { problems } = validateBalanceRows(rows(["vendor,A,10,,", "customer,B,0,,", "customer,C,10,31/12/2030,", "supplier,D,10,,X1", "supplier,d,20,,X1"]), TODAY);
    expect(problems.map((p) => p.field)).toEqual(["type", "amount", "asOf", "name"]);
  });
});
