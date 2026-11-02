// GST invoices, discounts, Schedule H1, credit customers, returns,
// cancellations, purchase returns, supplier accounts, reorder, labels and the
// reports that sum them (docs/PHARMACY_DESIGN.md).
import { randomUUID } from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { ownerSql } from "./test-db";
import { createTestClinic } from "./fixtures";
import { withClinic } from "@/lib/db";
import { createStaff } from "@/features/staff/staff.service";
import { createDrug } from "@/features/catalog/catalog.service";
import { savePharmacySettings, getPharmacySettings, DEFAULT_PHARMACY_SETTINGS } from "@/features/pharmacy/settings.service";
import { receiveStock } from "@/features/pharmacy/stock.service";
import { getSale, salesTotal, sell, sellableStock, type SaleLine } from "@/features/pharmacy/sales.service";
import { createSaleReturn, getSaleReturn, returnStateOf, returnableLines } from "@/features/pharmacy/returns.service";
import { customerBalance, customerLedger, recordReceipt, saveCustomer } from "@/features/pharmacy/customers.service";
import { saveSupplier } from "@/features/pharmacy/purchasing.service";
import { enterBill } from "@/features/pharmacy/bills.service";
import { createPurchaseReturn, getPurchaseReturn, recordSupplierPayment, supplierBalance } from "@/features/pharmacy/supplier-accounts.service";
import { createReorderDrafts, reorderSuggestions } from "@/features/pharmacy/reorder.service";
import { assignBarcodes, labelItems } from "@/features/pharmacy/labels.service";
import { REPORT_VIEWS, buildReport, parseReportParams } from "@/features/pharmacy/report-views";
import { renderCreditNotePdf, renderDebitNotePdf, renderSalePdf } from "@/lib/pdf/sale-pdf";
import { renderLabelsPdf } from "@/lib/pdf/labels-pdf";
import { collectedByMethod, gstOutput, gstr1, gstr3b, itemSales, pharmacyRange, scheduleRegister } from "@/features/pharmacy/pharmacy-reports.service";
import { registerPatient } from "@/features/patients/patients.service";
import { addWalkIn } from "@/features/scheduling/booking.service";
import { callPatient, finalizeEncounter } from "@/features/clinical/encounters.service";
import { addPrescriptionItem } from "@/features/clinical/prescriptions.service";
import { fiscalYear } from "@/features/pharmacy/numbering";
import { toMinor } from "@/lib/money";
import { addDaysToDateString, todayInTimeZone } from "@/lib/time";

const TZ = "Asia/Kolkata";
const owner = ownerSql();
const today = todayInTimeZone(TZ);
const fy = fiscalYear(today);
const fyShort = `${fy.slice(2, 4)}${fy.slice(5, 7)}`;
const month = today.slice(0, 7);
const nextYear = addDaysToDateString(today, 365);

let clinic: Awaited<ReturnType<typeof createTestClinic>>;
let adminId: string;
let doctorId: string;
let pharmacistId: string;
const item: Record<string, string> = {};

const as = (userId: string) => <T,>(fn: Parameters<typeof withClinic<T>>[1]) => withClinic({ clinicId: clinic.clinicId, userId }, fn);
const asP = () => as(pharmacistId);

async function onHand(drugId: string) {
  const [row] = await owner`select coalesce(sum(quantity), 0)::int as n from app.stock_batches where drug_id = ${drugId}`;
  return row.n as number;
}
async function batchOf(drugId: string) {
  const [row] = await owner`select id from app.stock_batches where drug_id = ${drugId} and quantity > 0 and expiry_date >= ${today}::date order by expiry_date limit 1`;
  return row.id as string;
}
async function line(name: string, quantity: number, soldAs: "unit" | "pack" = "unit"): Promise<SaleLine> {
  return { drugId: item[name], batchId: await batchOf(item[name]), quantity, soldAs, prescriptionItemId: null };
}
const counterSale = (input: Partial<Parameters<typeof sell>[2]> & { lines: SaleLine[] }, override = false) =>
  asP()((tx) => sell(tx, clinic.clinicId, { method: "cash", idempotencyKey: randomUUID(), ...input }, pharmacistId, today, { overrideDiscountLimit: override }));
const saleRow = async (id: string) => (await owner`select * from app.pharmacy_sales where id = ${id}`)[0];
const saleItems = async (id: string) => owner`select * from app.pharmacy_sale_items where sale_id = ${id} order by id`;

beforeAll(async () => {
  clinic = await createTestClinic("gst");
  adminId = (await owner`select id from app.users where clinic_id = ${clinic.clinicId}`)[0].id;
  const mk = (firstName: string, roleKeys: string[], registrationNumber?: string) =>
    as(adminId)((tx) => createStaff(tx, clinic.clinicId, { firstName, lastName: "Staff", email: `${firstName.toLowerCase()}@gst.test`, roleKeys, registrationNumber }, adminId));
  doctorId = (await mk("Divya", ["doctor"], "TNMC-4411")).id;
  pharmacistId = (await mk("Prakash", ["pharmacist"])).id;

  // Tamil Nadu pharmacy, regular GST, round-off on, 10 % discount limit.
  await as(adminId)((tx) =>
    savePharmacySettings(
      tx,
      clinic.clinicId,
      { ...DEFAULT_PHARMACY_SETTINGS, gstin: "33AABCU9603R1ZM", stateCode: "33", gstScheme: "regular", drugLicence20b: "TN-20B-1", drugLicence21b: "TN-21B-1", applyDefaultsToMedicines: true },
      adminId,
    ),
  );
  const add = async (name: string, values: Parameters<typeof createDrug>[2]) => {
    item[name] = (await asP()((tx) => createDrug(tx, clinic.clinicId, values))).id;
    await asP()((tx) => receiveStock(tx, clinic.clinicId, { drugId: item[name], batchNo: `${name.slice(0, 3).toUpperCase()}1`, expiryDate: nextYear, quantity: 300, unitCost: "1.00", reason: "opening" }, pharmacistId, today));
  };
  // VGM2: strip of 15 at MRP 210.76, 5 % GST (their real bill).
  await add("VGM2", { name: "VGM2 Tab", genericName: "Voglibose + Glimepiride + Metformin", form: "tablet", packSize: 15, price: "14.05", packPrice: "210.76", gstRate: 5, hsn: "30049099", defaultDurationDays: null, allergyClassIds: [] });
  await add("Needle", { name: "Needle 24G", itemType: "consumable", form: "other", packSize: 1, price: "4.50", gstRate: 12, hsn: "90183100", defaultDurationDays: null, allergyClassIds: [] });
  await add("Tramadol", { name: "Tramadol 50", genericName: "Tramadol", form: "capsule", packSize: 10, price: "5.00", schedule: "H1", defaultDurationDays: null, allergyClassIds: [] });
  await add("Cough", { name: "Cough Syrup", genericName: "Dextromethorphan", form: "syrup", packSize: 1, price: "99.00", schedule: "H", defaultDurationDays: null, allergyClassIds: [] });
});

afterAll(async () => {
  await owner.end();
});

describe("pharmacy settings", () => {
  it("are saved, and fill in medicines without HSN", async () => {
    const s = await asP()((tx) => getPharmacySettings(tx, clinic.clinicId));
    expect(s).toMatchObject({ configured: true, gstin: "33AABCU9603R1ZM", defaultGstRate: 5, roundOff: true });
    const [para] = await owner`select hsn, gst_rate from app.drugs where clinic_id = ${clinic.clinicId} and name = 'Paracetamol 650'`;
    expect(para).toEqual({ hsn: "3004", gst_rate: "5.00" });
  });
});

describe("a GST sale", () => {
  it("is a numbered tax invoice whose lines, discount, tax and round-off reconcile to the paisa", async () => {
    const vgmBefore = await onHand(item.VGM2);
    const { result } = await counterSale({ lines: [await line("VGM2", 1, "pack"), await line("Needle", 3)], discount: "10.00" });
    expect(result.number).toMatch(new RegExp(`^S/${fyShort}/\\d{6}$`));
    const sale = await saleRow(result.saleId);
    expect(sale).toMatchObject({ document_type: "tax_invoice", fiscal_year: fy, inter_state: false, discount: "10.00" });
    const items = await saleItems(result.saleId);
    const net = items.reduce((s, i) => s + toMinor(i.net), 0);
    expect(items.reduce((s, i) => s + toMinor(i.discount), 0)).toBe(1000);
    for (const i of items) expect(toMinor(i.taxable) + toMinor(i.cgst) + toMinor(i.sgst) + toMinor(i.igst)).toBe(toMinor(i.net));
    expect(toMinor(sale.total)).toBe(net + toMinor(sale.round_off));
    expect(toMinor(sale.total) % 100).toBe(0);
    expect(toMinor(sale.tax_total)).toBe(items.reduce((s, i) => s + toMinor(i.cgst) + toMinor(i.sgst), 0));
    const vgm = items.find((i) => i.drug_id === item.VGM2);
    expect(vgm).toMatchObject({ hsn: "30049099", gst_rate: "5.00", quantity: 15, packs: 1, unit_cost: "1.00" });
    expect(await onHand(item.VGM2)).toBe(vgmBefore - 15);
  });

  it("keeps discounts within the limit unless a manager allows more", async () => {
    await expect(counterSale({ lines: [await line("Needle", 10)], discount: "5.00" })).rejects.toThrow(/above 10 % need a manager/);
    await expect(counterSale({ lines: [await line("Needle", 10)], discount: "5.00" }, true)).resolves.toBeTruthy();
    await expect(counterSale({ lines: [await line("Needle", 1)], discount: "99.00" }, true)).rejects.toThrow(/more than the bill/);
  });
});

describe("Schedule H and H1", () => {
  it("refuses a scheduled medicine without the details the register needs", async () => {
    await expect(counterSale({ lines: [await line("Cough", 1)] })).rejects.toThrow(/enter the prescribing doctor/);
    await expect(counterSale({ lines: [await line("Tramadol", 10)], prescriberName: "Dr Mani" })).rejects.toThrow(/registration number, patient's name, patient's address/);
    const { result } = await counterSale({
      lines: [await line("Tramadol", 10)],
      prescriberName: "Dr Mani",
      prescriberRegNo: "TNMC-77",
      customerName: "Ravi Kumar",
      patientAddress: "12 Gandhi Road, Vaniyambadi",
    });
    const rows = await asP()((tx) => scheduleRegister(tx, pharmacyRange(today, today, TZ)));
    expect(rows.find((r) => r.number === result.number)).toMatchObject({ patient: "Ravi Kumar", reg_no: "TNMC-77", schedule: "H1", quantity: 10 });
  });

  it("fills the details from the signed prescription when dispensing", async () => {
    const p = await as(adminId)((tx) =>
      registerPatient(tx, clinic.clinicId, { firstName: "Meena", lastName: "S", sex: "female", statedAgeYears: 60, addressLine: "4 Bazaar St", city: "Ambur" }, { likelyIds: [], actorId: adminId, today }),
    );
    const visit = await as(adminId)((tx) => addWalkIn(tx, clinic.clinicId, { patientId: p.id, doctorId }, adminId, today));
    const { encounterId } = await as(doctorId)((tx) => callPatient(tx, clinic.clinicId, visit.id, doctorId, today));
    await as(doctorId)((tx) => addPrescriptionItem(tx, clinic.clinicId, encounterId, { drugId: item.Tramadol, dose: "1 capsule", frequency: "BD", durationDays: 3, quantity: null }, doctorId));
    const { prescriptionId } = await as(doctorId)((tx) => finalizeEncounter(tx, encounterId, doctorId, today));
    const [rxItem] = await owner`select id from app.prescription_items where prescription_id = ${prescriptionId}`;
    const dispense = async (quantity: number) => {
      const base = { drugId: item.Tramadol, batchId: await batchOf(item.Tramadol), soldAs: "unit" as const };
      return asP()((tx) =>
        sell(tx, clinic.clinicId, { prescriptionId: prescriptionId!, lines: [{ ...base, quantity, prescriptionItemId: rxItem.id }], method: "cash", idempotencyKey: randomUUID() }, pharmacistId, today),
      );
    };
    const { result } = await dispense(6);
    expect(result.dispenseStatus).toBe("dispensed");
    expect(await saleRow(result.saleId)).toMatchObject({ prescriber_reg_no: "TNMC-4411", customer_name: "Meena S", patient_address: "4 Bazaar St, Ambur" });

    // A return reopens the course; it can be filled again.
    const [saleItem] = await saleItems(result.saleId);
    await asP()((tx) => createSaleReturn(tx, clinic.clinicId, { saleId: result.saleId, kind: "return", reason: "Wrong strength", lines: [{ saleItemId: saleItem.id, quantity: 6 }], idempotencyKey: randomUUID() }, pharmacistId, today, TZ));
    const [rx] = await owner`select dispense_status from app.prescriptions where id = ${prescriptionId}`;
    expect(rx.dispense_status).toBe("pending");
    expect((await dispense(6)).result.dispenseStatus).toBe("dispensed");
  });
});

describe("credit customers", () => {
  let customerId: string;
  beforeAll(async () => {
    customerId = (await asP()((tx) => saveCustomer(tx, clinic.clinicId, null, { name: "Sri Sai Nursing Home", phone: "9840012345", creditLimit: "500.00" }))).id;
  });

  it("needs a named customer and stays within the credit limit", async () => {
    await expect(counterSale({ lines: [await line("Needle", 2)], method: "credit" })).rejects.toThrow(/named customer/);
    const { result } = await counterSale({ lines: [await line("Needle", 20)], method: "credit", customerId });
    expect(await asP()((tx) => customerBalance(tx, customerId))).toBe(toMinor((await saleRow(result.saleId)).total));
    await expect(counterSale({ lines: [await line("Needle", 100)], method: "credit", customerId })).rejects.toThrow(/above their credit limit/);
  });

  it("takes receipts, never more than is owed, with a running ledger", async () => {
    const owed = await asP()((tx) => customerBalance(tx, customerId));
    await expect(asP()((tx) => recordReceipt(tx, clinic.clinicId, { customerId, amount: "9999.00", method: "cash" }, pharmacistId, today))).rejects.toThrow(/cannot be more/);
    const r = await asP()((tx) => recordReceipt(tx, clinic.clinicId, { customerId, amount: "50.00", method: "upi", reference: "UPI1" }, pharmacistId, today));
    expect(r.number).toMatch(new RegExp(`^RC/${fyShort}/`));
    expect(await asP()((tx) => customerBalance(tx, customerId))).toBe(owed - 5000);
    const ledger = await asP()((tx) => customerLedger(tx, customerId));
    expect(ledger.at(-1)?.balance).toBe(((owed - 5000) / 100).toFixed(2));
  });

  it("charges IGST to a registered buyer in another state", async () => {
    const b2b = (await asP()((tx) => saveCustomer(tx, clinic.clinicId, null, { name: "Bengaluru Clinic", gstin: "29AABCU9603R1ZJ" }))).id;
    const { result } = await counterSale({ lines: [await line("Needle", 10)], customerId: b2b });
    const [i] = await saleItems(result.saleId);
    expect(Number(i.igst)).toBeGreaterThan(0);
    expect([i.cgst, i.sgst]).toEqual(["0.00", "0.00"]);
    expect(await saleRow(result.saleId)).toMatchObject({ inter_state: true, customer_gstin: "29AABCU9603R1ZJ" });
  });
});

describe("returns and cancellations", () => {
  it("refund each part exactly; the parts add up to the line", async () => {
    const before = await onHand(item.Needle);
    const { result } = await counterSale({ lines: [await line("Needle", 3)] });
    const [i] = await saleItems(result.saleId);
    const ret = (q: number) =>
      asP()((tx) => createSaleReturn(tx, clinic.clinicId, { saleId: result.saleId, kind: "return", reason: "Not needed", lines: [{ saleItemId: i.id, quantity: q }], idempotencyKey: randomUUID() }, pharmacistId, today, TZ));
    const a = await ret(1);
    expect(a.result.number).toMatch(new RegExp(`^CN/${fyShort}/`));
    expect(await asP()((tx) => returnStateOf(tx, result.saleId))).toBe("partial");
    await expect(ret(3)).rejects.toThrow(/only 2 can still be returned/);
    const b = await ret(2);
    expect(toMinor(a.result.refund) + toMinor(b.result.refund)).toBe(toMinor(i.net));
    const back = await owner`select sum(taxable)::text as taxable, sum(cgst + sgst)::text as tax from app.sale_return_items where sale_item_id = ${i.id}`;
    expect(back[0]).toEqual({ taxable: i.taxable, tax: (Number(i.cgst) + Number(i.sgst)).toFixed(2) });
    expect(await asP()((tx) => returnStateOf(tx, result.saleId))).toBe("returned");
    expect(await onHand(item.Needle)).toBe(before);
    expect((await asP()((tx) => returnableLines(tx, result.saleId)))[0].returnable).toBe(0);
  });

  it("cancel today's untouched sale in full, round-off included", async () => {
    const before = await onHand(item.VGM2);
    const { result } = await counterSale({ lines: [await line("VGM2", 2, "pack")] });
    const sale = await saleRow(result.saleId);
    const cancel = () => asP()((tx) => createSaleReturn(tx, clinic.clinicId, { saleId: result.saleId, kind: "cancellation", reason: "Billed twice", lines: [], idempotencyKey: randomUUID() }, pharmacistId, today, TZ));
    const { result: note } = await cancel();
    expect(note.refund).toBe(sale.total);
    expect(await onHand(item.VGM2)).toBe(before);
    expect(await asP()((tx) => returnStateOf(tx, result.saleId))).toBe("cancelled");
    await expect(cancel()).rejects.toThrow(/already cancelled/);
  });

  it("will not cancel a sale that already has returns", async () => {
    const { result } = await counterSale({ lines: [await line("Needle", 2)] });
    const [i] = await saleItems(result.saleId);
    await asP()((tx) => createSaleReturn(tx, clinic.clinicId, { saleId: result.saleId, kind: "return", reason: "x", lines: [{ saleItemId: i.id, quantity: 1 }], idempotencyKey: randomUUID() }, pharmacistId, today, TZ));
    await expect(
      asP()((tx) => createSaleReturn(tx, clinic.clinicId, { saleId: result.saleId, kind: "cancellation", reason: "x", lines: [], idempotencyKey: randomUUID() }, pharmacistId, today, TZ)),
    ).rejects.toThrow(/already returned/);
  });

  it("are permanent records", async () => {
    await expect(asP()((tx) => tx.execute(sql`update app.sale_returns set reason = 'edited'`))).rejects.toThrow();
    await expect(asP()((tx) => tx.execute(sql`delete from app.sale_return_items`))).rejects.toThrow();
  });
});

describe("suppliers: returns, payments and balance", () => {
  it("sends expired stock back on a debit note and keeps the balance from documents", async () => {
    const supplierId = (await asP()((tx) => saveSupplier(tx, clinic.clinicId, null, { name: "KSK Distributors" }))).id;
    const { result: bill } = await asP()((tx) =>
      enterBill(
        tx,
        clinic.clinicId,
        {
          supplierId,
          billNo: `B-${randomUUID().slice(0, 6)}`,
          billDate: today,
          updatePrices: false,
          lines: [{ drugId: item.Needle, description: "Needle", batchNo: "EXP1", expiryDate: addDaysToDateString(today, 3), quantity: 100, freeQuantity: 0, packSize: 1, rate: "2.00", gstRate: 12, rememberName: false }],
          idempotencyKey: randomUUID(),
        },
        pharmacistId,
        today,
      ),
    );
    expect(await asP()((tx) => supplierBalance(tx, supplierId))).toBe(toMinor(bill.total));
    // The batch expires; it goes back.
    await owner`alter table app.stock_batches disable trigger stock_batches_guard`;
    await owner`update app.stock_batches set expiry_date = ${addDaysToDateString(today, -1)}::date where batch_no = 'EXP1'`;
    await owner`alter table app.stock_batches enable trigger stock_batches_guard`;
    const [batch] = await owner`select id from app.stock_batches where batch_no = 'EXP1'`;
    const before = await onHand(item.Needle);
    const { result: dn } = await asP()((tx) => createPurchaseReturn(tx, clinic.clinicId, { supplierId, reason: "Expired", lines: [{ batchId: batch.id, quantity: 40 }], idempotencyKey: randomUUID() }, pharmacistId, today));
    expect(dn.number).toMatch(new RegExp(`^DN/${fyShort}/`));
    expect(dn.total).toBe("89.60"); // 40 x 2.00 + 12 %
    expect(await onHand(item.Needle)).toBe(before - 40);
    await expect(asP()((tx) => createPurchaseReturn(tx, clinic.clinicId, { supplierId, reason: "x", lines: [{ batchId: batch.id, quantity: 61 }], idempotencyKey: randomUUID() }, pharmacistId, today))).rejects.toThrow(/only 60 on hand/);

    const owed = toMinor(bill.total) - 8960;
    expect(await asP()((tx) => supplierBalance(tx, supplierId))).toBe(owed);
    await expect(asP()((tx) => recordSupplierPayment(tx, clinic.clinicId, { supplierId, amount: "99999.00", method: "bank" }, pharmacistId, today))).rejects.toThrow(/cannot be more/);
    await asP()((tx) => recordSupplierPayment(tx, clinic.clinicId, { supplierId, amount: "100.00", method: "bank", reference: "NEFT1" }, pharmacistId, today));
    expect(await asP()((tx) => supplierBalance(tx, supplierId))).toBe(owed - 10000);
  });
});

describe("reordering", () => {
  it("suggests what is running low and drafts orders per supplier", async () => {
    await owner`update app.drugs set reorder_level = 1000 where id = ${item.Cough}`;
    const settings = await asP()((tx) => getPharmacySettings(tx, clinic.clinicId));
    const lines = await asP()((tx) => reorderSuggestions(tx, today, TZ, settings));
    const cough = lines.find((l) => l.drugId === item.Cough);
    expect(cough).toMatchObject({ reason: "reorder_level", supplierId: null });
    const supplierId = (await asP()((tx) => saveSupplier(tx, clinic.clinicId, null, { name: "Reorder Pharma" }))).id;
    const orders = await asP()((tx) => createReorderDrafts(tx, clinic.clinicId, [{ drugId: item.Cough, supplierId, units: cough!.units }], pharmacistId));
    expect(orders).toHaveLength(1);
    const [po] = await owner`select status from app.purchase_orders where id = ${orders[0].id}`;
    expect(po.status).toBe("draft");
  });
});

describe("barcodes", () => {
  it("are assigned to items without one and found by an exact scan", async () => {
    expect(await asP()((tx) => assignBarcodes(tx, clinic.clinicId, [item.VGM2, item.Needle]))).toBe(2);
    const [vgm] = await owner`select barcode from app.drugs where id = ${item.VGM2}`;
    expect(vgm.barcode).toMatch(/^NL\d{6}$/);
    const hits = await asP()((tx) => sellableStock(tx, vgm.barcode, today));
    expect(hits.map((h) => [h.drugId, h.barcodeMatch])).toEqual([[item.VGM2, true]]);
    expect(await asP()((tx) => assignBarcodes(tx, clinic.clinicId, [item.VGM2]))).toBe(0);
  });
});

describe("reports", () => {
  it("GST output equals sales less credit notes, and GSTR-3B and GSTR-1 agree with it", async () => {
    const range = pharmacyRange(today, today, TZ);
    const byRate = await asP()((tx) => gstOutput(tx, range, "rate"));
    const [docs] = await owner`
      select
        (select coalesce(sum(coalesce(i.taxable, i.net)), 0) from app.pharmacy_sale_items i join app.pharmacy_sales s on s.id = i.sale_id where s.clinic_id = ${clinic.clinicId})
        - (select coalesce(sum(r.taxable), 0) from app.sale_return_items r where r.clinic_id = ${clinic.clinicId}) as taxable`;
    expect(byRate.reduce((s, r) => s + toMinor(r.taxable), 0)).toBe(toMinor(String(Number(docs.taxable).toFixed(2))));

    const r3b = await asP()((tx) => gstr3b(tx, month, TZ));
    const taxedOut = byRate.filter((r) => Number(r.rate) > 0);
    expect(toMinor(r3b.outward.cgst)).toBe(taxedOut.reduce((s, r) => s + toMinor(r.cgst), 0));
    expect(toMinor(r3b.itc.cgst) + toMinor(r3b.itc.sgst)).toBeGreaterThan(0);

    const r1 = await asP()((tx) => gstr1(tx, month, TZ, "33"));
    expect(r1.b2b.some((b) => b.gstin === "29AABCU9603R1ZJ" && b.place === "29")).toBe(true);
    const b2cTax = r1.b2cs.reduce((s, b) => s + toMinor(b.cgst) + toMinor(b.sgst), 0);
    const b2bTax = r1.b2b.reduce((s, b) => s + toMinor(b.cgst) + toMinor(b.sgst) + toMinor(b.igst), 0);
    expect(b2cTax + b2bTax).toBe(byRate.reduce((s, r) => s + toMinor(r.cgst) + toMinor(r.sgst) + toMinor(r.igst), 0));
    expect(r1.docs.find((d) => d.kind === "Invoices for outward supply")?.cancelled).toBe(1);
  });

  it("counts money collected, not credit, and margin over cost", async () => {
    const range = pharmacyRange(today, today, TZ);
    const collected = await asP()((tx) => collectedByMethod(tx, range));
    expect(toMinor(collected.onCredit)).toBeGreaterThan(0);
    expect(collected.methods.some((m) => m.method === "credit")).toBe(false);
    const items = await asP()((tx) => itemSales(tx, range));
    const vgm = items.find((i) => i.drugId === item.VGM2)!;
    expect(toMinor(vgm.margin)).toBe(toMinor(vgm.taxable) - toMinor(vgm.cost));
  });
});

describe("documents and report views", () => {
  const letterhead = { name: "GST Test Clinic", addressLine: "1 Main Road", city: "Chennai", phone: null, email: null, letterheadText: null, footerText: null };
  const identity = { gstin: "33AABCU9603R1ZM", gstScheme: "regular" as const, drugLicence20b: "TN-20B-1", drugLicence21b: "TN-21B-1" };
  const isPdf = (bytes: Uint8Array) => Buffer.from(bytes.slice(0, 5)).toString() === "%PDF-";

  it("render the tax invoice, credit note, debit note and shelf labels", async () => {
    const { result } = await counterSale({ lines: [await line("VGM2", 1, "pack"), await line("Needle", 2)], discount: "5.00" });
    const sale = (await asP()((tx) => getSale(tx, result.saleId)))!;
    expect(isPdf(await renderSalePdf(sale, letterhead, identity, "INR", TZ))).toBe(true);

    const { result: note } = await asP()((tx) =>
      createSaleReturn(tx, clinic.clinicId, { saleId: result.saleId, kind: "return", reason: "Wrong strength", lines: [{ saleItemId: sale.items[0].id, quantity: 5 }], idempotencyKey: randomUUID() }, pharmacistId, today, TZ),
    );
    const cn = (await asP()((tx) => getSaleReturn(tx, note.returnId)))!;
    expect(cn.sale.number).toBe(result.number);
    expect(cn.sale.customer).toBe("Walk-in customer");
    expect(cn.items[0]).toMatchObject({ quantity: 5, form: expect.any(String), expiryDate: expect.any(String) });
    expect(isPdf(await renderCreditNotePdf(cn, letterhead, identity, "INR", TZ))).toBe(true);

    const [dn] = await owner`select id from app.purchase_returns where clinic_id = ${clinic.clinicId} limit 1`;
    const debit = (await asP()((tx) => getPurchaseReturn(tx, dn.id)))!;
    expect(isPdf(await renderDebitNotePdf(debit, letterhead, identity, "INR", TZ))).toBe(true);

    const labels = await asP()((tx) => labelItems(tx, [item.VGM2, item.Needle, item.Cough], today));
    const sheet = labels.flatMap((l) => Array.from({ length: 10 }, () => ({ ...l, priceUnit: "tablet", packUnit: "strip" })));
    expect(isPdf(await renderLabelsPdf(sheet, { clinicName: "GST Test Clinic" }, (v) => `Rs.${v}`))).toBe(true);
  });

  it("every report view builds, and the GST summary matches the output-tax figures", async () => {
    const settings = await asP()((tx) => getPharmacySettings(tx, clinic.clinicId));
    for (const view of REPORT_VIEWS) {
      const p = parseReportParams({ view: view.key, from: today, to: today, month, h: "1" }, today);
      const sections = await asP()((tx) => buildReport(tx, p, TZ, settings));
      expect(sections.length).toBeGreaterThan(0);
      for (const s of sections) for (const row of s.rows) expect(Object.keys(row)).toEqual(expect.arrayContaining(s.columns.map((c) => c.key).filter((k) => k !== "marginPercent")));
    }
    const gst = await asP()((tx) => buildReport(tx, parseReportParams({ view: "gst", from: today, to: today }, today), TZ, settings));
    const byRate = await asP()((tx) => gstOutput(tx, pharmacyRange(today, today, TZ), "rate"));
    expect(toMinor(String(gst[0].totals?.taxable))).toBe(byRate.reduce((s, r) => s + toMinor(r.taxable), 0));
    const register = await asP()((tx) => buildReport(tx, parseReportParams({ view: "register", from: today, to: today, h: "1" }, today), TZ, settings));
    expect(register[0].rows.some((r) => r.schedule === "H1")).toBe(true);
  });

  it("report parameters are clamped to safe values", () => {
    expect(parseReportParams({}, "2026-11-03")).toMatchObject({ view: "sales", fromDate: "2026-11-01", toDate: "2026-11-03", month: "2026-11" });
    expect(parseReportParams({ view: "nope", from: "2026-12-01", to: "2027-01-01", month: "2027-01" }, "2026-11-03")).toMatchObject({ view: "sales", toDate: "2026-11-03", month: "2026-11" });
    expect(parseReportParams({ from: "2026-11-03", to: "2026-10-01" }, "2026-11-03")).toMatchObject({ fromDate: "2026-10-01", toDate: "2026-11-03" });
    expect(parseReportParams({ from: "2020-01-01", to: "2026-11-03" }, "2026-11-03").fromDate).toBe("2025-11-03");
    expect(parseReportParams({ month: "2026-13" }, "2026-11-03").month).toBe("2026-11");
  });

  it("today's total on the pharmacy home is net of credit notes", async () => {
    const r = pharmacyRange(today, today, TZ);
    const totals = await asP()((tx) => salesTotal(tx, new Date(r.from), new Date(r.to)));
    const [docs] = await owner`
      select (select coalesce(sum(total), 0) from app.pharmacy_sales where clinic_id = ${clinic.clinicId})::numeric(12,2)::text as billed,
             (select coalesce(sum(total), 0) from app.sale_returns where clinic_id = ${clinic.clinicId})::numeric(12,2)::text as returned`;
    expect(totals).toMatchObject({ billed: docs.billed, returned: docs.returned });
    expect(toMinor(totals.total)).toBe(toMinor(docs.billed) - toMinor(docs.returned));
  });
});
