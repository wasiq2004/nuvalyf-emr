// Supplier bills, item types with other names, and the items & stock import:
// the client's in-house pharmacy flow (paper bill in -> stock up -> sales
// take it down), with suppliers spelling the same item differently.
import { randomUUID } from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { ownerSql } from "./test-db";
import { createTestClinic } from "./fixtures";
import { withClinic } from "@/lib/db";
import { createStaff } from "@/features/staff/staff.service";
import { createDrug } from "@/features/catalog/catalog.service";
import { addAlias, removeAlias, searchItems } from "@/features/catalog/items.service";
import { searchDrugs, warningsFor } from "@/features/clinical/prescriptions.service";
import { saveSupplier } from "@/features/pharmacy/purchasing.service";
import { enterBill, getBill, listBills, type BillInput, type BillLine } from "@/features/pharmacy/bills.service";
import { sell, sellableStock } from "@/features/pharmacy/sales.service";
import { checkStockImport, runStockImport } from "@/features/pharmacy/stock-import.service";
import { listImportJobs } from "@/features/import/import.service";
import { registerPatient } from "@/features/patients/patients.service";
import { addWalkIn } from "@/features/scheduling/booking.service";
import { callPatient, finalizeEncounter } from "@/features/clinical/encounters.service";
import { addPrescriptionItem } from "@/features/clinical/prescriptions.service";
import { addDaysToDateString, todayInTimeZone } from "@/lib/time";

const TZ = "Asia/Kolkata";
const owner = ownerSql();
const today = todayInTimeZone(TZ);
const nextYear = addDaysToDateString(today, 365);

let clinic: Awaited<ReturnType<typeof createTestClinic>>;
let adminId: string;
let doctorId: string;
let pharmacistId: string;
let supplierA: string;
let supplierB: string;
let needleId: string;
let paracetamolId: string;

const as = (userId: string) => <T,>(fn: Parameters<typeof withClinic<T>>[1]) => withClinic({ clinicId: clinic.clinicId, userId }, fn);
const asPharmacist = () => as(pharmacistId);

async function onHand(drugId: string) {
  const [row] = await owner`select coalesce(sum(quantity), 0)::int as n from app.stock_batches where drug_id = ${drugId}`;
  return row.n as number;
}

async function count(table: string) {
  const [row] = await owner.unsafe(`select count(*)::int as n from app.${table} where clinic_id = $1`, [clinic.clinicId]);
  return row.n as number;
}

function line(drugId: string, overrides: Partial<BillLine> = {}): BillLine {
  return {
    drugId,
    description: "",
    batchNo: `B${randomUUID().slice(0, 6)}`,
    expiryDate: nextYear,
    quantity: 1,
    freeQuantity: 0,
    packSize: 1,
    rate: "10.00",
    gstRate: 0,
    rememberName: false,
    ...overrides,
  };
}

function bill(supplierId: string, lines: BillLine[], overrides: Partial<BillInput> = {}): BillInput {
  return { supplierId, billNo: `INV-${randomUUID().slice(0, 8)}`, billDate: today, updatePrices: true, lines, idempotencyKey: randomUUID(), ...overrides };
}

const enter = (input: BillInput) => asPharmacist()((tx) => enterBill(tx, clinic.clinicId, input, pharmacistId, today));

beforeAll(async () => {
  clinic = await createTestClinic("bills");
  const [admin] = await owner`select id from app.users where clinic_id = ${clinic.clinicId}`;
  adminId = admin.id;
  const mk = (firstName: string, roleKeys: string[], registrationNumber?: string) =>
    as(adminId)((tx) => createStaff(tx, clinic.clinicId, { firstName, lastName: "Staff", email: `${firstName.toLowerCase()}@bills.test`, roleKeys, registrationNumber }, adminId));
  doctorId = (await mk("Dhruv", ["doctor"], "REG-77")).id;
  pharmacistId = (await mk("Pallavi", ["pharmacist"])).id;

  supplierA = (await asPharmacist()((tx) => saveSupplier(tx, clinic.clinicId, null, { name: "Asha Distributors" }))).id;
  supplierB = (await asPharmacist()((tx) => saveSupplier(tx, clinic.clinicId, null, { name: "Bharat Surgicals" }))).id;
  needleId = (
    await asPharmacist()((tx) =>
      createDrug(tx, clinic.clinicId, { name: "Clinic needle 24G", itemType: "consumable", form: "other", manufacturer: "BD", packSize: 100, defaultDurationDays: null, allergyClassIds: [] }),
    )
  ).id;
  const [para] = await owner`select id from app.drugs where clinic_id = ${clinic.clinicId} and name = 'Paracetamol 650'`;
  paracetamolId = para.id;
});

afterAll(async () => {
  await owner.end();
});

describe("item types", () => {
  it("defaults a consumable's generic name to its name and keeps prescribing fields empty", async () => {
    const [row] = await owner`select generic_name, item_type, pack_size, default_dose from app.drugs where id = ${needleId}`;
    expect(row).toEqual({ generic_name: "Clinic needle 24G", item_type: "consumable", pack_size: 100, default_dose: null });
  });

  it("keeps consumables and instruments out of prescribing", async () => {
    expect(await as(doctorId)((tx) => searchDrugs(tx, "needle"))).toEqual([]);
    const p = await as(adminId)((tx) =>
      registerPatient(tx, clinic.clinicId, { firstName: "Ira", sex: "female", statedAgeYears: 40 }, { likelyIds: [], actorId: adminId, today }),
    );
    const visit = await as(adminId)((tx) => addWalkIn(tx, clinic.clinicId, { patientId: p.id, doctorId }, adminId, today));
    const { encounterId } = await as(doctorId)((tx) => callPatient(tx, clinic.clinicId, visit.id, doctorId, today));
    await expect(as(doctorId)((tx) => warningsFor(tx, encounterId, needleId))).rejects.toThrow(/not a medicine/);
  });

  it("refuses a medicine without a generic name", async () => {
    await expect(
      asPharmacist()((tx) => createDrug(tx, clinic.clinicId, { name: "Mystery syrup", itemType: "medicine", form: "syrup", defaultDurationDays: null, allergyClassIds: [] })),
    ).rejects.toThrow(/generic name/);
  });

  it("finds an item by its words in any order", async () => {
    const found = await asPharmacist()((tx) => searchItems(tx, "needle clinic"));
    expect(found.map((f) => f.name)).toEqual(["Clinic needle 24G"]);
  });
});

describe("supplier bills", () => {
  it("books packs, free packs and units into stock, prices from the MRP, and records the bill", async () => {
    const [paraBefore, needleBefore] = [await onHand(paracetamolId), await onHand(needleId)];
    const { result, replayed } = await enter(
      bill(supplierA, [
        line(paracetamolId, { description: "PARACETAMOL 650MG TAB", quantity: 10, freeQuantity: 2, packSize: 15, rate: "30.00", mrp: "45.00", gstRate: 12, batchNo: "pc1" }),
        line(needleId, { quantity: 2, packSize: 100, rate: "120.00", gstRate: 18 }),
      ]),
    );
    expect(replayed).toBe(false);
    expect(result.number).toMatch(/^PB-\d{6}$/);
    expect(result.units).toBe(380);
    expect(result.total).toBe("619.20"); // 300 + 36 GST, 240 + 43.20 GST
    expect(await onHand(paracetamolId)).toBe(paraBefore + 180);
    expect(await onHand(needleId)).toBe(needleBefore + 200);

    const [batch] = await owner`select batch_no, unit_cost from app.stock_batches where drug_id = ${paracetamolId} and batch_no = 'PC1'`;
    expect(batch).toEqual({ batch_no: "PC1", unit_cost: "1.67" });
    const [para] = await owner`select price, pack_price, pack_size from app.drugs where id = ${paracetamolId}`;
    expect(para).toEqual({ price: "3.00", pack_price: "45.00", pack_size: 15 });
    const moves = await owner`select reason, source_type from app.stock_movements where source_id = ${result.billId}`;
    expect(moves).toHaveLength(2);
    expect(moves.every((m) => m.reason === "receipt" && m.source_type === "purchase_bill")).toBe(true);

    const saved = await asPharmacist()((tx) => getBill(tx, result.billId));
    expect(saved?.items.map((i) => [i.description, i.units])).toEqual([
      ["Clinic needle 24G", 200],
      ["PARACETAMOL 650MG TAB", 180],
    ]);
    expect((await asPharmacist()((tx) => listBills(tx)))[0].lineCount).toBe(2);
  });

  it("does the work once per form, however often it is sent", async () => {
    const input = bill(supplierA, [line(needleId, { quantity: 1, packSize: 100 })]);
    const before = await onHand(needleId);
    const first = await enter(input);
    const again = await enter(input);
    expect(again.replayed).toBe(true);
    expect(again.result.billId).toBe(first.result.billId);
    expect(await onHand(needleId)).toBe(before + 100);
  });

  it("refuses the same bill number from the same supplier, in any case", async () => {
    await enter(bill(supplierA, [line(needleId)], { billNo: "gst/77" }));
    await expect(enter(bill(supplierA, [line(needleId)], { billNo: "GST/77" }))).rejects.toThrow(/already entered/);
    // Another supplier may use the same number.
    await expect(enter(bill(supplierB, [line(needleId)], { billNo: "GST/77" }))).resolves.toBeTruthy();
  });

  it("saves nothing when any line is wrong", async () => {
    const [bills, stock] = [await count("purchase_bills"), await onHand(needleId)];
    const expired = line(needleId, { expiryDate: addDaysToDateString(today, -1) });
    await expect(enter(bill(supplierA, [line(needleId, { quantity: 5 }), expired]))).rejects.toThrow(/expired/);
    const repeated = line(needleId, { batchNo: "R1" });
    await expect(enter(bill(supplierA, [repeated, { ...repeated, batchNo: "r1" }]))).rejects.toThrow(/repeats an earlier line/);
    await expect(enter(bill(supplierA, [line(needleId)], { billDate: addDaysToDateString(today, 1) }))).rejects.toThrow(/future/);
    expect(await count("purchase_bills")).toBe(bills);
    expect(await onHand(needleId)).toBe(stock);
  });

  it("keeps saved bills and their lines unchangeable", async () => {
    await expect(asPharmacist()((tx) => tx.execute(sql`update app.purchase_bills set notes = 'edited'`))).rejects.toThrow();
    await expect(asPharmacist()((tx) => tx.execute(sql`delete from app.purchase_bill_items`))).rejects.toThrow();
  });
});

describe("other names", () => {
  it("remembers how a supplier spells an item, and finds it by that name everywhere", async () => {
    const { result } = await enter(bill(supplierB, [line(needleId, { description: "Needle clinic", quantity: 1, packSize: 100, rememberName: true })]));
    expect(result.learned).toEqual(["Needle clinic → Clinic needle 24G"]);

    const [match] = await asPharmacist()((tx) => searchItems(tx, "Needle clinic"));
    expect(match).toMatchObject({ id: needleId, matchedAlias: "Needle clinic", aliases: ["Needle clinic"] });
    const forSale = await asPharmacist()((tx) => sellableStock(tx, "needle clinic", today));
    expect(forSale.map((s) => s.drugId)).toEqual([needleId]);
  });

  it("never lets one name point at two items", async () => {
    await expect(
      enter(bill(supplierB, [line(needleId, { description: "Paracetamol 650", rememberName: true })])),
    ).rejects.toThrow(/Line 1: "Paracetamol 650" is already the name of Paracetamol 650/);
    await expect(asPharmacist()((tx) => addAlias(tx, clinic.clinicId, { drugId: paracetamolId, alias: "NEEDLE  clinic" }, pharmacistId))).rejects.toThrow(
      /already another name of Clinic needle 24G/,
    );
    // The item's own spelling is not stored twice.
    expect(await asPharmacist()((tx) => addAlias(tx, clinic.clinicId, { drugId: needleId, alias: "clinic needle 24g" }, pharmacistId))).toBeNull();
  });

  it("can be removed again", async () => {
    const added = await asPharmacist()((tx) => addAlias(tx, clinic.clinicId, { drugId: paracetamolId, alias: "Dolo 650" }, pharmacistId));
    expect((await asPharmacist()((tx) => searchItems(tx, "dolo")))[0].id).toBe(paracetamolId);
    await asPharmacist()((tx) => removeAlias(tx, added!.id));
    expect(await asPharmacist()((tx) => searchItems(tx, "dolo"))).toEqual([]);
  });
});

describe("sales take stock down, loose or by the strip", () => {
  async function paracetamolBatch() {
    const [batch] = await owner`select id from app.stock_batches where drug_id = ${paracetamolId} and quantity >= 30 order by expiry_date limit 1`;
    return batch.id as string;
  }
  const counter = (lines: Parameters<typeof sell>[2]["lines"]) =>
    asPharmacist()((tx) => sell(tx, clinic.clinicId, { lines, method: "cash", idempotencyKey: randomUUID() }, pharmacistId, today));

  it("sells strips at the strip price and loose tablets at the tablet price", async () => {
    const batchId = await paracetamolBatch();
    const before = await onHand(paracetamolId);
    const { result } = await counter([
      { drugId: paracetamolId, batchId, quantity: 2, soldAs: "pack", prescriptionItemId: null },
      { drugId: paracetamolId, batchId, quantity: 4, soldAs: "unit", prescriptionItemId: null },
    ]);
    expect(result.total).toBe("102.00"); // 2 x 45.00 + 4 x 3.00
    expect(await onHand(paracetamolId)).toBe(before - 34);
    const items = await owner`select sold_as, packs, pack_size, quantity, unit_price, amount from app.pharmacy_sale_items where sale_id = ${result.saleId} order by sold_as`;
    expect(items).toEqual([
      { sold_as: "pack", packs: 2, pack_size: 15, quantity: 30, unit_price: "45.00", amount: "90.00" },
      { sold_as: "unit", packs: null, pack_size: 1, quantity: 4, unit_price: "3.00", amount: "12.00" },
    ]);
  });

  it("refuses packs for an item sold one by one, and strips beyond the batch", async () => {
    await owner`update app.drugs set price = '3.00' where id = ${needleId}`;
    const [needleBatch] = await owner`select id from app.stock_batches where drug_id = ${needleId} and quantity > 0 limit 1`;
    await owner`update app.drugs set pack_size = 1 where id = ${needleId}`;
    await expect(counter([{ drugId: needleId, batchId: needleBatch.id, quantity: 1, soldAs: "pack", prescriptionItemId: null }])).rejects.toThrow(/not sold in packs/);
    await owner`update app.drugs set pack_size = 100 where id = ${needleId}`;
    const [para] = await owner`select id, quantity from app.stock_batches where drug_id = ${paracetamolId} order by quantity limit 1`;
    const strips = Math.floor(para.quantity / 15) + 1;
    await expect(counter([{ drugId: paracetamolId, batchId: para.id, quantity: strips, soldAs: "pack", prescriptionItemId: null }])).rejects.toThrow(/left in batch/);
  });

  it("never dispenses more than the course, counted in tablets", async () => {
    const p = await as(adminId)((tx) =>
      registerPatient(tx, clinic.clinicId, { firstName: "Strip", sex: "male", statedAgeYears: 33 }, { likelyIds: [], actorId: adminId, today }),
    );
    const visit = await as(adminId)((tx) => addWalkIn(tx, clinic.clinicId, { patientId: p.id, doctorId }, adminId, today));
    const { encounterId } = await as(doctorId)((tx) => callPatient(tx, clinic.clinicId, visit.id, doctorId, today));
    await as(doctorId)((tx) =>
      addPrescriptionItem(tx, clinic.clinicId, encounterId, { drugId: paracetamolId, dose: "1 tablet", frequency: "TDS", durationDays: 3, quantity: null }, doctorId),
    );
    const { prescriptionId } = await as(doctorId)((tx) => finalizeEncounter(tx, encounterId, doctorId, today));
    const [item] = await owner`select id from app.prescription_items where prescription_id = ${prescriptionId}`;
    const batchId = await paracetamolBatch();
    const dispense = (quantity: number, soldAs: "unit" | "pack") =>
      asPharmacist()((tx) =>
        sell(
          tx,
          clinic.clinicId,
          { prescriptionId: prescriptionId!, lines: [{ drugId: paracetamolId, batchId, quantity, soldAs, prescriptionItemId: item.id }], method: "cash", idempotencyKey: randomUUID() },
          pharmacistId,
          today,
        ),
      );
    // A strip of 15 is more than the 9-tablet course.
    await expect(dispense(1, "pack")).rejects.toThrow(/only 9 left to dispense/);
    const { result } = await dispense(9, "unit");
    expect(result.dispenseStatus).toBe("dispensed");
  });
});

describe("items & stock import", () => {
  const csv = (rows: string[]) => ["name,type,generic_name,units_per_pack,selling_price,other_names,batch_no,expiry_date,quantity,unit_cost", ...rows].join("\n");
  const csvWithPackPrice = (rows: string[]) => ["name,type,generic_name,form,units_per_pack,selling_price,pack_price", ...rows].join("\n");
  const run = (text: string, key = randomUUID()) =>
    asPharmacist()((tx) => runStockImport(tx, clinic.clinicId, { fileName: "items.csv", csv: text, idempotencyKey: key }, pharmacistId, today));

  it("creates new items, matches existing ones by any name, and adds opening stock", async () => {
    const file = csv([
      "Gauze roll 10cm,consumable,,12,4.50,Gauze bandage; Roller gauze,G1,12/2030,120,3.10",
      "Esomeprazole 40,medicine,Esomeprazole,10,3.00,Nexpro 40,OM1,06/2029,200,",
      "Needle clinic,consumable,,,,,NC9,12/2031,50,",
      "Paracetamol 650,,,,,,PX1,12/2030,30,",
      "Thermometer,instrument,,,,,,,,",
    ]);
    const report = await asPharmacist()((tx) => checkStockImport(tx, file, today));
    expect(report).toMatchObject({ rows: 5, newItems: 3, existingItems: 2, batches: 4, units: 400, problems: [] });

    const [needleBefore, paraBefore] = [await onHand(needleId), await onHand(paracetamolId)];
    const { result } = await run(file);
    expect(result).toMatchObject({ newItems: 3, batches: 4, units: 400 });
    expect(await onHand(needleId)).toBe(needleBefore + 50);
    expect(await onHand(paracetamolId)).toBe(paraBefore + 30);

    const [gauze] = await owner`select id, item_type, pack_size, price, generic_name from app.drugs where clinic_id = ${clinic.clinicId} and name = 'Gauze roll 10cm'`;
    expect(gauze).toMatchObject({ item_type: "consumable", pack_size: 12, price: "4.50", generic_name: "Gauze roll 10cm" });
    expect(await onHand(gauze.id)).toBe(120);
    expect((await asPharmacist()((tx) => searchItems(tx, "roller gauze")))[0].id).toBe(gauze.id);
    const [thermo] = await owner`select item_type from app.drugs where clinic_id = ${clinic.clinicId} and name = 'Thermometer'`;
    expect(thermo.item_type).toBe("instrument");
    const reasons = await owner`select distinct reason from app.stock_movements where clinic_id = ${clinic.clinicId} and source_type = 'import'`;
    expect(reasons.map((r) => r.reason)).toEqual(["opening"]);

    // Stock imports stay out of the patient import history.
    const [job] = await owner`select kind, status from app.import_jobs where id = ${result.jobId}`;
    expect(job).toEqual({ kind: "stock", status: "imported" });
    expect((await as(adminId)((tx) => listImportJobs(tx))).some((j) => j.id === result.jobId)).toBe(false);
  });

  it("imports nothing when any row has a problem", async () => {
    const before = await count("drugs");
    const file = csv([
      "Crepe bandage,consumable,,,,,CB1,12/2030,10,",
      "Ivermectin 12,medicine,,,,,,,,", // a new medicine needs its generic name
      "Cotton wool,consumable,,,,Needle clinic,,,,", // that name belongs to the needle
    ]);
    const report = await asPharmacist()((tx) => checkStockImport(tx, file, today));
    expect(report.problems.map((p) => [p.line, p.field])).toEqual([
      [3, "genericName"],
      [4, "otherNames"],
    ]);
    await expect(run(file)).rejects.toThrow(/Nothing was imported: 2 problem/);
    expect(await count("drugs")).toBe(before);
  });

  it("imports strip prices", async () => {
    await run(csvWithPackPrice(["Cetirizine 5 kids,medicine,Cetirizine,tablet,10,1.25,12.00"]));
    const [row] = await owner`select price, pack_price, pack_size from app.drugs where clinic_id = ${clinic.clinicId} and name = 'Cetirizine 5 kids'`;
    expect(row).toEqual({ price: "1.25", pack_price: "12.00", pack_size: 10 });
  });

  it("imports a file once, however often it is sent", async () => {
    const file = csv(["Spirit swab,consumable,,,,,SW1,12/2030,40,"]);
    const key = randomUUID();
    await run(file, key);
    const again = await run(file, key);
    expect(again.replayed).toBe(true);
    const [swab] = await owner`select id from app.drugs where clinic_id = ${clinic.clinicId} and name = 'Spirit swab'`;
    expect(await onHand(swab.id)).toBe(40);
  });
});
