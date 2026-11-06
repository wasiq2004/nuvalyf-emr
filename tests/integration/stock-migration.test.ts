// Moving a pharmacy from old software: stock goes in once and matches, wrong
// loads come back out, batches keep their MRPs, shelves are counted blind,
// dues carry over, and bills from before the move can still be returned.
import { randomUUID } from "crypto";
import { PDFDocument } from "pdf-lib";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ownerSql } from "./test-db";
import { createTestClinic } from "./fixtures";
import { withClinic } from "@/lib/db";
import { createStaff } from "@/features/staff/staff.service";
import { saveSupplier } from "@/features/pharmacy/purchasing.service";
import { enterBill } from "@/features/pharmacy/bills.service";
import { sell, sellableStock } from "@/features/pharmacy/sales.service";
import { saveCustomer, customerBalance, customerLedger } from "@/features/pharmacy/customers.service";
import { createPurchaseReturn, recordSupplierPayment, returnableBatches, supplierBalance, supplierLedger } from "@/features/pharmacy/supplier-accounts.service";
import { checkStockImport, compareStock, reverseStockImport, runStockImport } from "@/features/pharmacy/stock-import.service";
import { adjustStock } from "@/features/pharmacy/stock.service";
import { addFoundBatch, blindLines, cancelCount, postCount, reviewLines, saveCounts, saveReview, startCount, submitCount } from "@/features/pharmacy/stock-count.service";
import { addOpening, checkBalanceImport, runBalanceImport } from "@/features/pharmacy/opening-balances.service";
import { createOldBillReturn, getSaleReturn } from "@/features/pharmacy/returns.service";
import { buildReport, parseReportParams } from "@/features/pharmacy/report-views";
import { getPharmacySettings } from "@/features/pharmacy/settings.service";
import { renderCountSheetPdf } from "@/lib/pdf/stock-count-pdf";
import { addDaysToDateString, todayInTimeZone } from "@/lib/time";

const TZ = "Asia/Kolkata";
const owner = ownerSql();
const today = todayInTimeZone(TZ);

let clinic: Awaited<ReturnType<typeof createTestClinic>>;
let adminId: string;
let pharmacistId: string;

const as = <T,>(fn: Parameters<typeof withClinic<T>>[1]) => withClinic({ clinicId: clinic.clinicId, userId: pharmacistId }, fn);
const unique = (name: string) => `${name} ${randomUUID().slice(0, 8)}`;
const HEADER = "name,generic_name,form,units_per_pack,mrp,batch_no,expiry_date,quantity,unit_cost";
const csv = (rows: string[]) => [HEADER, ...rows].join("\n");
const load = (text: string, basis: "units" | "packs" = "units", key = randomUUID()) => as((tx) => runStockImport(tx, clinic.clinicId, { fileName: "closing.csv", csv: text, basis, idempotencyKey: key }, pharmacistId, today));
const check = (text: string, basis: "units" | "packs" = "units") => as((tx) => checkStockImport(tx, text, today, basis));

async function batch(name: string, batchNo: string) {
  const [row] = await owner`select b.* from app.stock_batches b join app.drugs d on d.id = b.drug_id where d.clinic_id = ${clinic.clinicId} and d.name = ${name} and b.batch_no = ${batchNo}`;
  return row;
}

const clearOpenCounts = () => owner`update app.stock_counts set status = 'cancelled' where clinic_id = ${clinic.clinicId} and status in ('counting', 'review')`;

beforeAll(async () => {
  clinic = await createTestClinic();
  const [admin] = await owner`select id from app.users where clinic_id = ${clinic.clinicId}`;
  adminId = admin.id;
  const staff = await withClinic({ clinicId: clinic.clinicId, userId: adminId }, (tx) => createStaff(tx, clinic.clinicId, { firstName: "Pia", lastName: "Pharma", email: `pia-${randomUUID().slice(0, 8)}@migration.test`, roleKeys: ["pharmacist"] }, adminId));
  pharmacistId = staff.id;
});

afterAll(async () => {
  await owner.end();
});

describe("loading opening stock", () => {
  it("cannot be done twice: the same file, or a corrected copy, is refused", async () => {
    const name = unique("Dolo");
    const file = csv([`${name},Paracetamol,tablet,15,30.00,D1,12/2030,300,1.40`]);
    await load(file);
    expect((await batch(name, "D1")).quantity).toBe(300);

    const again = await check(file);
    expect(again.problems[0].message).toMatch(/already in stock/);
    await expect(load(file)).rejects.toThrow(/Nothing was imported/);

    const corrected = csv([`${name},Paracetamol,tablet,15,30.00,D1,12/2030,310,1.40`]);
    await expect(load(corrected)).rejects.toThrow(/Nothing was imported/);
    expect((await batch(name, "D1")).quantity).toBe(300);
  });

  it("still returns the first result for a double-click on one form", async () => {
    const name = unique("Crocin");
    const key = randomUUID();
    const file = csv([`${name},Paracetamol,tablet,10,20.00,C1,12/2030,50,1.00`]);
    const first = await load(file, "units", key);
    const second = await load(file, "units", key);
    expect(second.replayed).toBe(true);
    expect(second.result.jobId).toBe(first.result.jobId);
    expect((await batch(name, "C1")).quantity).toBe(50);
  });

  it("refuses a batch sold out since it was imported: it would come back from the dead", async () => {
    const name = unique("Azee");
    const file = csv([`${name},Azithromycin,tablet,5,100.00,A1,12/2030,10,1.00`]);
    await load(file);
    const row = await batch(name, "A1");
    await as((tx) => adjustStock(tx, clinic.clinicId, { batchId: row.id, change: -10, reason: "damaged", note: "Flood" }, pharmacistId));
    expect((await check(file)).problems[0].message).toMatch(/already in stock/);
  });

  it("adds a genuinely new batch to an item already in the list", async () => {
    const name = unique("Pan");
    await load(csv([`${name},Pantoprazole,tablet,10,120.00,P1,12/2030,100,5.00`]));
    await load(csv([`${name},,,,120.00,P2,12/2031,40,5.00`]));
    expect((await batch(name, "P2")).quantity).toBe(40);
  });

  it("turns packs and loose units into single units, cost and all", async () => {
    const name = unique("Strip");
    const file = ["name,generic_name,form,units_per_pack,mrp,batch_no,expiry_date,quantity,unit_cost", `${name},Paracetamol,tablet,15,30.00,S1,12/2030,20:5,12.35`].join("\n");
    const report = await check(file, "packs");
    expect(report).toMatchObject({ units: 305, costValue: "251.12", mrpValue: "610.00", problems: [] });
    expect(report.examples[0]).toContain("20 strips and 5 loose of 15 = 305 tablets");
    await load(file, "packs");
    expect(await batch(name, "S1")).toMatchObject({ quantity: 305, pack_cost: "12.35", pack_size: 15, mrp: "30.00" });
  });

  it("will not convert packs without knowing the pack", async () => {
    const file = ["name,generic_name,batch_no,expiry_date,quantity", `${unique("Noform")},Paracetamol,S2,12/2030,20`].join("\n");
    expect((await check(file, "packs")).problems[0].message).toMatch(/units per pack is needed/);
  });

  it("refuses a pack size that disagrees with the item", async () => {
    const name = unique("Pack");
    await load(csv([`${name},Paracetamol,tablet,10,20.00,K1,12/2030,10,1.00`]));
    expect((await check(csv([`${name},,,15,20.00,K2,12/2030,10,1.00`]))).problems[0].message).toMatch(/10 units per pack in your list/);
  });

  it("records expired stock, keeps it off the shelf, and counts it apart", async () => {
    const name = unique("Old");
    const expired = addDaysToDateString(today, -40);
    const report = await check(csv([`${name},Paracetamol,tablet,10,20.00,E1,${expired},30,1.00`]));
    expect(report).toMatchObject({ expiredBatches: 1, expiredUnits: 30, problems: [] });
    await load(csv([`${name},Paracetamol,tablet,10,20.00,E1,${expired},30,1.00`]));
    expect((await batch(name, "E1")).quantity).toBe(30);
    expect(await as((tx) => sellableStock(tx, name, today))).toEqual([]);
  });

  it("sends expired opening stock back to the supplier on a debit note", async () => {
    const name = unique("Back");
    await load(csv([`${name},Paracetamol,tablet,1,20.00,EB1,${addDaysToDateString(today, -40)},12,3.00`]));
    const row = await batch(name, "EB1");
    const listed = (await as((tx) => returnableBatches(tx, today))).find((b) => b.batchId === row.id);
    expect(listed?.expired).toBe(true);
    const supplier = await as((tx) => saveSupplier(tx, clinic.clinicId, null, { name: unique("Supplier") }));
    const { result } = await as((tx) => createPurchaseReturn(tx, clinic.clinicId, { supplierId: supplier.id, reason: "Expired at the move", lines: [{ batchId: row.id, quantity: 12 }], idempotencyKey: randomUUID() }, pharmacistId, today));
    expect(result.total).toBe("36.00");
    expect((await batch(name, "EB1")).quantity).toBe(0);
  });

  it("gives two batches of one item their own MRP, and the item the higher", async () => {
    const name = unique("Twin");
    await load(csv([`${name},Paracetamol,tablet,10,25.00,T1,12/2030,50,1.00`, `${name},Paracetamol,tablet,10,30.00,T2,12/2031,50,1.00`]));
    const [found] = await as((tx) => sellableStock(tx, name, today));
    expect(found.packPrice).toBe("30.00");
    expect(found.batches.map((b) => b.mrp)).toEqual(["25.00", "30.00"]);
  });
});

describe("reversing a wrong load", () => {
  it("takes every unit back out, and the corrected file then goes in", async () => {
    const name = unique("Wrong");
    const wrong = csv([`${name},Paracetamol,tablet,15,30.00,W1,12/2030,40,1.00`]);
    const { result } = await load(wrong);
    await as((tx) => reverseStockImport(tx, clinic.clinicId, result.jobId, "Those were strips", pharmacistId));
    expect((await batch(name, "W1")).quantity).toBe(0);
    const [job] = await owner`select status, reversed_note from app.import_jobs where id = ${result.jobId}`;
    expect(job).toMatchObject({ status: "reversed", reversed_note: "Those were strips" });

    await load(csv([`${name},,,15,30.00,W1,12/2030,40:0,1.00`]), "packs");
    expect((await batch(name, "W1")).quantity).toBe(600);
  });

  it("cannot run twice", async () => {
    const { result } = await load(csv([`${unique("Twice")},Paracetamol,tablet,1,,R1,12/2030,5,1.00`]));
    await as((tx) => reverseStockImport(tx, clinic.clinicId, result.jobId, "Wrong branch", pharmacistId));
    await expect(as((tx) => reverseStockImport(tx, clinic.clinicId, result.jobId, "Again", pharmacistId))).rejects.toThrow(/Only a completed import/);
  });

  it("stops once anything has been sold from it", async () => {
    const name = unique("Sold");
    const { result } = await load(csv([`${name},Paracetamol,tablet,1,2.00,R2,12/2030,5,1.00`]));
    const row = await batch(name, "R2");
    await as((tx) => sell(tx, clinic.clinicId, { lines: [{ drugId: row.drug_id, batchId: row.id, quantity: 1 }], method: "cash", idempotencyKey: randomUUID() }, pharmacistId, today));
    await expect(as((tx) => reverseStockImport(tx, clinic.clinicId, result.jobId, "Too late", pharmacistId))).rejects.toThrow(/moved since this import/);
    expect((await batch(name, "R2")).quantity).toBe(4);
  });
});

describe("comparing with the old software", () => {
  it("finds what grand totals hide: two batches wrong in opposite directions", async () => {
    await owner`select 1`;
    const a = unique("CmpA");
    const b = unique("CmpB");
    await load(csv([`${a},Paracetamol,tablet,1,,M1,12/2030,10,1.00`, `${b},Paracetamol,tablet,1,,M2,12/2030,10,1.00`]));
    const old = csv([`${a},Paracetamol,tablet,1,,M1,12/2030,12,1.00`, `${b},Paracetamol,tablet,1,,M2,12/2030,8,1.00`]);
    const result = await as((tx) => compareStock(tx, old, today, "units"));
    const mine = result.different.filter((d) => d.name === a || d.name === b);
    expect(mine.map((d) => [d.file, d.system])).toEqual([
      [12, 10],
      [8, 10],
    ]);
  });

  it("names batches on only one side", async () => {
    const name = unique("Only");
    await load(csv([`${name},Paracetamol,tablet,1,,O1,12/2030,10,1.00`]));
    const result = await as((tx) => compareStock(tx, csv([`${name},Paracetamol,tablet,1,,O2,12/2030,10,1.00`]), today, "units"));
    expect(result.missing.find((m) => m.name === name)?.batchNo).toBe("O2");
    expect(result.extra.find((e) => e.name === name)?.batchNo).toBe("O1");
  });
});

describe("a batch keeps its printed MRP", () => {
  it("sells an old batch at its MRP after the item's price has gone up", async () => {
    const name = unique("Price");
    await load(csv([`${name},Paracetamol,tablet,10,25.00,X1,12/2030,50,1.00`, `${name},Paracetamol,tablet,10,30.00,X2,12/2031,50,1.00`]));
    const row = await batch(name, "X1");
    const { result } = await as((tx) => sell(tx, clinic.clinicId, { lines: [{ drugId: row.drug_id, batchId: row.id, quantity: 2, soldAs: "pack" }], method: "cash", idempotencyKey: randomUUID() }, pharmacistId, today));
    expect(result.total).toBe("50.00");
  });

  it("takes the MRP from a supplier bill", async () => {
    const name = unique("Billed");
    await load(csv([`${name},Paracetamol,tablet,10,,Y0,12/2030,1,1.00`]));
    const [drug] = await owner`select id from app.drugs where clinic_id = ${clinic.clinicId} and name = ${name}`;
    const supplier = await as((tx) => saveSupplier(tx, clinic.clinicId, null, { name: unique("Supplier") }));
    await as((tx) =>
      enterBill(
        tx,
        clinic.clinicId,
        { supplierId: supplier.id, billNo: unique("B"), billDate: today, updatePrices: false, idempotencyKey: randomUUID(), lines: [{ drugId: drug.id, description: "", batchNo: "Y1", expiryDate: "2031-01-31", quantity: 2, freeQuantity: 0, packSize: 10, rate: "18.00", mrp: "27.50", gstRate: 0, rememberName: false }] },
        pharmacistId,
        today,
      ),
    );
    expect(await batch(name, "Y1")).toMatchObject({ mrp: "27.50", pack_size: 10 });
  });
});

describe("counting the shelves", () => {
  beforeEach(clearOpenCounts);

  async function counted(name: string, batchNo: string, quantity = 100) {
    await load(csv([`${name},Paracetamol,tablet,1,,${batchNo},12/2030,${quantity},2.00`]));
    const row = await batch(name, batchNo);
    await owner`update app.drugs set rack = ${name} where id = ${row.drug_id}`;
    const count = await as((tx) => startCount(tx, clinic.clinicId, { scope: "rack", rack: name }, pharmacistId, today));
    const [line] = await as((tx) => blindLines(tx, count.id));
    return { row, count, line };
  }

  it("never hands the system's figure to the counting screen", async () => {
    const { count, line } = await counted(unique("Blind"), "B1");
    const text = JSON.stringify(await as((tx) => blindLines(tx, count.id)));
    expect(line.firstCount).toBeNull();
    expect(text).not.toContain("firstSystem");
    expect(text).not.toContain("quantity");
  });

  it("posts a shortage through the ledger, with its reason", async () => {
    const name = unique("Short");
    const { row, count, line } = await counted(name, "B1");
    await as((tx) => saveCounts(tx, count.id, [{ lineId: line.id, counted: 95 }], pharmacistId));
    await as((tx) => submitCount(tx, count.id, pharmacistId));
    await expect(as((tx) => postCount(tx, clinic.clinicId, count.id, pharmacistId))).rejects.toThrow(/choose why/);
    await as((tx) => saveReview(tx, count.id, [{ lineId: line.id, recount: null, reason: "unexplained", note: null }], pharmacistId));
    const posted = await as((tx) => postCount(tx, clinic.clinicId, count.id, pharmacistId));
    expect(posted).toMatchObject({ adjusted: 1, shortage: 5, excess: 0 });
    expect((await batch(name, "B1")).quantity).toBe(95);
    const [movement] = await owner`select change, reason, source_type, note from app.stock_movements where batch_id = ${row.id} and source_type = 'stock_count'`;
    expect(movement).toMatchObject({ change: -5, reason: "adjustment", source_type: "stock_count" });
    expect(movement.note).toContain("Missing, cause unknown");
  });

  it("does not read a sale made after the count as a shortage", async () => {
    const name = unique("Busy");
    const { row, count, line } = await counted(name, "B1");
    await as((tx) => saveCounts(tx, count.id, [{ lineId: line.id, counted: 100 }], pharmacistId));
    await owner`update app.drugs set price = '5.00' where id = ${row.drug_id}`;
    await as((tx) => sell(tx, clinic.clinicId, { lines: [{ drugId: row.drug_id, batchId: row.id, quantity: 10 }], method: "cash", idempotencyKey: randomUUID() }, pharmacistId, today));
    await as((tx) => submitCount(tx, count.id, pharmacistId));
    const [reviewed] = await as((tx) => reviewLines(tx, count.id));
    expect(reviewed.change).toBe(0);
    await as((tx) => postCount(tx, clinic.clinicId, count.id, pharmacistId));
    expect((await batch(name, "B1")).quantity).toBe(90);
  });

  it("lets a recount settle a difference, and keeps the first count", async () => {
    const name = unique("Again");
    const { count, line } = await counted(name, "B1");
    await as((tx) => saveCounts(tx, count.id, [{ lineId: line.id, counted: 90 }], pharmacistId));
    await as((tx) => submitCount(tx, count.id, pharmacistId));
    await as((tx) => saveReview(tx, count.id, [{ lineId: line.id, recount: 100, reason: null, note: null }], pharmacistId));
    const [reviewed] = await as((tx) => reviewLines(tx, count.id));
    expect(reviewed).toMatchObject({ firstCount: 90, recount: 100, change: 0 });
    await as((tx) => postCount(tx, clinic.clinicId, count.id, pharmacistId));
    expect((await batch(name, "B1")).quantity).toBe(100);
  });

  it("leaves a line nobody counted exactly as it was", async () => {
    const name = unique("Skip");
    const { count, line } = await counted(name, "B1");
    await as((tx) => saveCounts(tx, count.id, [{ lineId: line.id, counted: null }], pharmacistId));
    await expect(as((tx) => submitCount(tx, count.id, pharmacistId))).rejects.toThrow(/Nothing has been counted/);
  });

  it("adds a batch found on the shelf, expired or not", async () => {
    const name = unique("Found");
    const { row, count, line } = await counted(name, "B1");
    await as((tx) => saveCounts(tx, count.id, [{ lineId: line.id, counted: 100 }], pharmacistId));
    await as((tx) => addFoundBatch(tx, clinic.clinicId, { countId: count.id, drugId: row.drug_id, batchNo: "new1", expiryDate: addDaysToDateString(today, -5), counted: 7 }, pharmacistId));
    await as((tx) => submitCount(tx, count.id, pharmacistId));
    const lines = await as((tx) => reviewLines(tx, count.id));
    const found = lines.find((l) => l.found)!;
    expect(found.change).toBe(7);
    await as((tx) => saveReview(tx, count.id, [{ lineId: found.id, recount: null, reason: "found", note: null }], pharmacistId));
    await as((tx) => postCount(tx, clinic.clinicId, count.id, pharmacistId));
    expect((await batch(name, "NEW1")).quantity).toBe(7);
  });

  it("prints a sheet of any length, and never prints the system figure", async () => {
    const lines = Array.from({ length: 120 }, (_, i) => ({ name: `Item ${i} with rather a long name that has to be cut short somewhere`, rack: "A1", schedule: "H1", packSize: 15, batchNo: `B${i}`, expiryDate: "2030-12-31" }));
    const bytes = await renderCountSheetPdf({ number: "SC-000009", scopeLabel: "Whole pharmacy", createdAt: new Date(), lines }, { name: "Test clinic", addressLine: null, city: null, phone: null, email: null, letterheadText: null, footerText: null }, TZ);
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(2);
  });

  it("refuses a second open count: both would correct the same stock", async () => {
    const { count } = await counted(unique("Open"), "B1");
    await expect(as((tx) => startCount(tx, clinic.clinicId, { scope: "all" }, pharmacistId, today))).rejects.toThrow(new RegExp(`${count.number} is still open`));
  });

  it("closes for good once posted or cancelled, even for the database owner", async () => {
    const { count, line } = await counted(unique("Closed"), "B1");
    await as((tx) => cancelCount(tx, count.id));
    await expect(as((tx) => saveCounts(tx, count.id, [{ lineId: line.id, counted: 1 }], pharmacistId))).rejects.toThrow();
    await expect(owner`update app.stock_counts set status = 'review' where id = ${count.id}`).rejects.toThrow(/closed stock count/);
    await expect(owner`update app.stock_count_lines set first_count = 1, first_system = 1 where id = ${line.id}`).rejects.toThrow(/closed stock count/);
    await expect(owner`delete from app.stock_count_lines where id = ${line.id}`).rejects.toThrow();
  });
});

describe("the closing stock report", () => {
  const report = (view: string, extra: Record<string, string> = {}) =>
    as(async (tx) => buildReport(tx, parseReportParams({ view, to: today, ...extra }, today), TZ, await getPharmacySettings(tx, clinic.clinicId)));

  it("adds up to the same units and value the import reported", async () => {
    const name = unique("Report");
    const file = ["name,generic_name,form,units_per_pack,mrp,batch_no,expiry_date,quantity,unit_cost", `${name},Paracetamol,tablet,15,30.00,Z1,12/2030,10:0,12.35`].join("\n");
    await load(file, "packs");
    const sections = await report("stock");
    const line = sections[1].rows.find((r) => r.name === name)!;
    expect(line).toMatchObject({ batch: "Z1", units: 150, packs: "10 + 0", costValue: "123.50", mrpValue: "300.00", state: "Sellable" });
  });

  it("shows what was on hand on a past date, from the ledger", async () => {
    const yesterday = addDaysToDateString(today, -1);
    const sections = await report("stock", { to: yesterday });
    expect(sections[1].rows).toEqual([]);
  });

  it("shows opening + in - out = closing, and that every batch agrees with its ledger", async () => {
    const [section] = await report("movement", { from: today });
    const opening = section.rows[0].units_in as number;
    const closing = section.rows[section.rows.length - 1].units_in as number;
    const moved = section.rows.slice(1, -1).reduce((n, r) => n + Number(r.units_in) - Number(r.units_out), 0);
    expect(opening + moved).toBe(closing);
    expect(section.description).toContain("Every batch agrees");
  });
});

describe("dues from the old software", () => {
  it("adds a customer's opening balance to what they owe, and to their ledger", async () => {
    const customer = await as((tx) => saveCustomer(tx, clinic.clinicId, null, { name: unique("Customer") }));
    await as((tx) => addOpening(tx, clinic.clinicId, { side: "customer", partyId: customer.id, amount: "1500.50", asOf: today, reference: "OB-1" }, pharmacistId, today));
    expect(await as((tx) => customerBalance(tx, customer.id))).toBe(150050);
    const ledger = await as((tx) => customerLedger(tx, customer.id));
    expect(ledger[0]).toMatchObject({ kind: "opening", number: "OB-1", debit: "1500.50", balance: "1500.50" });
  });

  it("lets a supplier be paid against an opening balance, and no more", async () => {
    const supplier = await as((tx) => saveSupplier(tx, clinic.clinicId, null, { name: unique("Supplier") }));
    await as((tx) => addOpening(tx, clinic.clinicId, { side: "supplier", partyId: supplier.id, amount: "1000", asOf: today }, pharmacistId, today));
    await expect(as((tx) => recordSupplierPayment(tx, clinic.clinicId, { supplierId: supplier.id, amount: "1000.01", method: "cash" }, pharmacistId, today))).rejects.toThrow(/cannot be more/);
    await as((tx) => recordSupplierPayment(tx, clinic.clinicId, { supplierId: supplier.id, amount: "400", method: "cash" }, pharmacistId, today));
    expect(await as((tx) => supplierBalance(tx, supplier.id))).toBe(60000);
    expect((await as((tx) => supplierLedger(tx, supplier.id)))[0]).toMatchObject({ kind: "opening", credit: "1000.00" });
  });

  it("corrects with a second entry, and keeps both", async () => {
    const customer = await as((tx) => saveCustomer(tx, clinic.clinicId, null, { name: unique("Customer") }));
    await as((tx) => addOpening(tx, clinic.clinicId, { side: "customer", partyId: customer.id, amount: "500", asOf: today }, pharmacistId, today));
    await as((tx) => addOpening(tx, clinic.clinicId, { side: "customer", partyId: customer.id, amount: "-100", asOf: today, note: "Typed wrongly" }, pharmacistId, today));
    expect(await as((tx) => customerBalance(tx, customer.id))).toBe(40000);
    await expect(owner`update app.account_openings set amount = 1 where customer_id = ${customer.id}`).rejects.toThrow();
  });

  it("imports a file once, adding parties it does not know", async () => {
    const buyer = unique("Sunrise");
    const seller = unique("Apollo");
    const file = ["type,name,amount,reference", `customer,${buyer},12500.00,`, `supplier,${seller},1000.00,INV1`, `supplier,${seller},2000.00,INV2`].join("\n");
    const report = await as((tx) => checkBalanceImport(tx, file, today));
    expect(report).toMatchObject({ customers: 1, customerTotal: "12500.00", suppliers: 1, supplierTotal: "3000.00", newParties: 2, problems: [] });
    await as((tx) => runBalanceImport(tx, clinic.clinicId, { fileName: "dues.csv", csv: file, idempotencyKey: randomUUID() }, pharmacistId, today));
    const [row] = await owner`select id from app.suppliers where clinic_id = ${clinic.clinicId} and name = ${seller}`;
    expect(await as((tx) => supplierBalance(tx, row.id))).toBe(300000);

    const again = await as((tx) => checkBalanceImport(tx, file, today));
    expect(again.problems[0].message).toMatch(/already has an opening balance/);
    await expect(as((tx) => runBalanceImport(tx, clinic.clinicId, { fileName: "dues.csv", csv: file, idempotencyKey: randomUUID() }, pharmacistId, today))).rejects.toThrow(/Nothing was imported/);
  });
});

describe("a return on the old software's bill", () => {
  async function item() {
    const name = unique("Return");
    await load(csv([`${name},Paracetamol,tablet,10,20.00,OB1,12/2030,10,1.00`]));
    return { name, row: await batch(name, "OB1") };
  }
  const input = (drugId: string, overrides: Record<string, unknown> = {}) => ({
    oldBillNo: unique("M"),
    oldBillDate: addDaysToDateString(today, -20),
    refundMethod: "cash" as const,
    reason: "Doctor changed it",
    lines: [{ drugId, batchNo: "OB1", expiryDate: "2030-12-31", quantity: 5, amount: "10.00", resaleable: true }],
    idempotencyKey: randomUUID(),
    ...overrides,
  });

  it("issues a credit note, puts the units back, and reads like any other", async () => {
    const { name, row } = await item();
    const { result } = await as((tx) => createOldBillReturn(tx, clinic.clinicId, input(row.drug_id), pharmacistId, today));
    expect((await batch(name, "OB1")).quantity).toBe(15);
    const note = await as((tx) => getSaleReturn(tx, result.returnId));
    expect(note?.saleId).toBeNull();
    expect(note?.sale.number).toContain("old bill");
    expect(note?.items[0]).toMatchObject({ batchNo: "OB1", quantity: 5, net: "10.00" });
  });

  it("makes a batch that was never loaded, and writes off what cannot be resold", async () => {
    const { name, row } = await item();
    const line = { drugId: row.drug_id, batchNo: "NEVER1", expiryDate: "2029-06-30", quantity: 3, amount: "6.00", resaleable: false };
    await as((tx) => createOldBillReturn(tx, clinic.clinicId, input(row.drug_id, { lines: [line] }), pharmacistId, today));
    expect((await batch(name, "NEVER1")).quantity).toBe(0);
    const moved = await owner`select reason, change from app.stock_movements m join app.stock_batches b on b.id = m.batch_id where b.batch_no = 'NEVER1' and b.drug_id = ${row.drug_id} order by change desc`;
    expect(moved.map((m) => [m.reason, m.change])).toEqual([
      ["return", 3],
      ["damaged", -3],
    ]);
  });

  it("stops a second note on one bill until the person says it is a further return", async () => {
    const { row } = await item();
    const bill = unique("M");
    await as((tx) => createOldBillReturn(tx, clinic.clinicId, input(row.drug_id, { oldBillNo: bill }), pharmacistId, today));
    await expect(as((tx) => createOldBillReturn(tx, clinic.clinicId, input(row.drug_id, { oldBillNo: bill }), pharmacistId, today))).rejects.toThrow(/further return/);
    await as((tx) => createOldBillReturn(tx, clinic.clinicId, input(row.drug_id, { oldBillNo: bill, confirmRepeat: true }), pharmacistId, today));
  });

  it("credits a named customer's account, against their opening balance", async () => {
    const { row } = await item();
    const customer = await as((tx) => saveCustomer(tx, clinic.clinicId, null, { name: unique("Customer") }));
    await as((tx) => addOpening(tx, clinic.clinicId, { side: "customer", partyId: customer.id, amount: "100", asOf: today }, pharmacistId, today));
    await as((tx) => createOldBillReturn(tx, clinic.clinicId, input(row.drug_id, { customerId: customer.id, refundMethod: "account" }), pharmacistId, today));
    expect(await as((tx) => customerBalance(tx, customer.id))).toBe(9000);
    expect((await as((tx) => customerLedger(tx, customer.id))).map((e) => e.kind)).toEqual(["opening", "return"]);
    await expect(as((tx) => createOldBillReturn(tx, clinic.clinicId, input(row.drug_id, { refundMethod: "account" }), pharmacistId, today))).rejects.toThrow(/named customer/);
  });

  it("carries through to the GST reports as a credit note", async () => {
    const { row } = await item();
    await as((tx) => getPharmacySettings(tx, clinic.clinicId));
    await owner`update app.pharmacy_settings set gst_scheme = 'regular', state_code = '27' where clinic_id = ${clinic.clinicId}`;
    await owner`update app.drugs set gst_rate = 12, hsn = '3004' where id = ${row.drug_id}`;
    await as((tx) => createOldBillReturn(tx, clinic.clinicId, input(row.drug_id, { lines: [{ drugId: row.drug_id, batchNo: "OB1", expiryDate: "2030-12-31", quantity: 5, amount: "112.00", resaleable: true }] }), pharmacistId, today));
    const sections = await as(async (tx) => buildReport(tx, parseReportParams({ view: "gst", from: today, to: today }, today), TZ, await getPharmacySettings(tx, clinic.clinicId)));
    const twelve = sections[0].rows.find((r) => r.rate === "12");
    expect(twelve).toMatchObject({ value: "-112.00", taxable: "-100.00" });
  });

  it("lands in GSTR-1: a walk-in in the B2C summary, a registered buyer as a note against the old bill", async () => {
    const { row } = await item();
    await owner`update app.pharmacy_settings set gst_scheme = 'regular', state_code = '27' where clinic_id = ${clinic.clinicId}`;
    await owner`update app.drugs set gst_rate = 18, hsn = '3004' where id = ${row.drug_id}`;
    const buyer = await as((tx) => saveCustomer(tx, clinic.clinicId, null, { name: unique("Registered"), gstin: "27AAPFU0939F1ZV" }));
    const line = { drugId: row.drug_id, batchNo: "OB1", expiryDate: "2030-12-31", quantity: 1, amount: "118.00", resaleable: true };
    const bill = unique("GST").toUpperCase();
    await as((tx) => createOldBillReturn(tx, clinic.clinicId, input(row.drug_id, { lines: [line] }), pharmacistId, today));
    const { result } = await as((tx) => createOldBillReturn(tx, clinic.clinicId, input(row.drug_id, { oldBillNo: bill, customerId: buyer.id, lines: [line] }), pharmacistId, today));
    const sections = await as(async (tx) => buildReport(tx, parseReportParams({ view: "gstr1", month: today.slice(0, 7) }, today), TZ, await getPharmacySettings(tx, clinic.clinicId)));
    const b2cs = sections.find((s) => s.key === "b2cs")!.rows.find((r) => r.rate === "18");
    expect(b2cs).toMatchObject({ taxable: "-100.00" });
    const cdnr = sections.find((s) => s.key === "cdnr")!.rows.find((r) => r.note === result.number);
    expect(cdnr).toMatchObject({ gstin: "27AAPFU0939F1ZV", invoice: bill, taxable: "100.00", rate: "18" });
  });
});
