// Beds, admissions, the running bill with part payments, and the discharge
// summary (docs/INPATIENT_DESIGN.md).
import { randomUUID } from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ownerSql } from "./test-db";
import { createTestClinic } from "./fixtures";
import { withClinic } from "@/lib/db";
import { createStaff } from "@/features/staff/staff.service";
import { registerPatient } from "@/features/patients/patients.service";
import { listQueue } from "@/features/queue/queue.service";
import { visitsToBill } from "@/features/billing/billing.service";
import { recordVitals } from "@/features/clinical/vitals.service";
import { addDiagnosis } from "@/features/clinical/diagnoses.service";
import { addPrescriptionItem } from "@/features/clinical/prescriptions.service";
import { cancelLabOrder, listLabTestOptions, orderLab } from "@/features/clinical/lab.service";
import { receiveStock } from "@/features/pharmacy/stock.service";
import { sell } from "@/features/pharmacy/sales.service";
import { createSaleReturn } from "@/features/pharmacy/returns.service";
import { collectedByMethod, pharmacyRange } from "@/features/pharmacy/pharmacy-reports.service";
import { collectionsByMethod } from "@/features/reports/reports.service";
import {
  addCharge,
  adjustBedStay,
  admissionBill,
  admitPatient,
  bedBoard,
  dischargePatient,
  openAdmissionFor,
  recordAdmissionPayment,
  saveBed,
  saveBedCategory,
  saveInpatientSettings,
  setAdmissionDiscount,
  transferBed,
  voidCharge,
} from "@/features/inpatient/inpatient.service";
import { draftSummary, getSummary, saveSummary, signSummary } from "@/features/inpatient/summary.service";
import { STANDARD_SECTIONS } from "@/features/inpatient/summary-rules";
import { renderDischargeSummaryPdf, renderInpatientBillPdf } from "@/lib/pdf/inpatient-pdf";
import { addDaysToDateString, todayInTimeZone, zonedTimeToUtc } from "@/lib/time";

const TZ = "Asia/Kolkata";
const owner = ownerSql();
const today = todayInTimeZone(TZ);
const HOUR = 3_600_000;
const hoursAgo = (h: number) => new Date(Date.now() - h * HOUR);

let clinic: Awaited<ReturnType<typeof createTestClinic>>;
let adminId: string;
let doctorId: string;
let pharmacistId: string;
let general: string;
let icu: string;
const bedIds: string[] = [];

const as = (userId: string) => <T,>(fn: Parameters<typeof withClinic<T>>[1]) => withClinic({ clinicId: clinic.clinicId, userId }, fn);
const asAdmin = () => as(adminId);

async function newPatient(firstName: string) {
  return asAdmin()((tx) => registerPatient(tx, clinic.clinicId, { firstName, sex: "male", statedAgeYears: 55 }, { likelyIds: [], actorId: adminId, today }));
}
const admit = (patientId: string, bedId: string, admittedAt: Date) =>
  asAdmin()(async (tx) => (await admitPatient(tx, clinic.clinicId, { patientId, doctorId, bedId, reason: "Fever with dehydration", admittedAt }, adminId, today))!);
const billOf = (id: string, at = new Date()) => asAdmin()(async (tx) => (await admissionBill(tx, id, at))!);
const pay = (id: string, kind: "advance" | "payment" | "refund", amount: string, key = randomUUID()) =>
  asAdmin()((tx) => recordAdmissionPayment(tx, clinic.clinicId, id, { kind, amount, method: "cash", idempotencyKey: key }, adminId, today));
const freeBed = async () => {
  const board = await asAdmin()((tx) => bedBoard(tx, today));
  return board.find((b) => !b.admissionId && b.categoryName === "General")!.id;
};

beforeAll(async () => {
  clinic = await createTestClinic("inpatient");
  adminId = (await owner`select id from app.users where clinic_id = ${clinic.clinicId}`)[0].id;
  const mk = (firstName: string, roleKeys: string[], registrationNumber?: string) =>
    asAdmin()((tx) => createStaff(tx, clinic.clinicId, { firstName, lastName: "Staff", email: `${firstName.toLowerCase()}@ip.test`, roleKeys, registrationNumber }, adminId));
  doctorId = (await mk("Dilip", ["doctor"], "TNMC-1")).id;
  pharmacistId = (await mk("Pooja", ["pharmacist"])).id;
  general = (await asAdmin()((tx) => saveBedCategory(tx, clinic.clinicId, null, { name: "General", dailyRate: "2400.00" })))!.id;
  icu = (await asAdmin()((tx) => saveBedCategory(tx, clinic.clinicId, null, { name: "ICU", dailyRate: "9600.00" })))!.id;
  for (let i = 1; i <= 22; i++) bedIds.push((await asAdmin()((tx) => saveBed(tx, clinic.clinicId, null, { categoryId: i <= 20 ? general : icu, ward: i <= 20 ? "Ward A" : "ICU", code: `B-${i}` })))!.id);
});

afterAll(async () => {
  await owner.end();
});

describe("beds and admission", () => {
  it("refuses duplicates, an occupied bed and a second admission", async () => {
    await expect(asAdmin()((tx) => saveBed(tx, clinic.clinicId, null, { categoryId: general, code: "B-1" }))).rejects.toThrow(/already a bed/);
    const p = await newPatient("Arun");
    const q = await newPatient("Bala");
    const row = await admit(p.id, bedIds[0], hoursAgo(1));
    expect(row.number).toMatch(/^IP\/\d{4}\/\d{6}$/);
    await expect(admit(q.id, bedIds[0], hoursAgo(1))).rejects.toThrow(/occupied/);
    await expect(admit(p.id, bedIds[1], hoursAgo(1))).rejects.toThrow(/already admitted/);
    await expect(admit(q.id, bedIds[1], new Date(Date.now() + 2 * HOUR))).rejects.toThrow(/future/);
    expect((await asAdmin()((tx) => bedBoard(tx, today))).find((b) => b.id === bedIds[0])?.patientName).toContain("Arun");
    expect(await asAdmin()((tx) => openAdmissionFor(tx, p.id))).toMatchObject({ number: row.number });
  });

  it("stays out of the outpatient queue and the to-bill list", async () => {
    const p = await newPatient("Chitra");
    await admit(p.id, await freeBed(), hoursAgo(1));
    expect((await asAdmin()((tx) => listQueue(tx, today))).some((q) => q.patientId === p.id)).toBe(false);
    expect((await asAdmin()((tx) => visitsToBill(tx, today))).some((v) => v.patientId === p.id)).toBe(false);
  });
});

describe("bed charges", () => {
  it("by the hour: 30 hours at ₹2,400 a day is ₹3,000", async () => {
    const p = await newPatient("Dinesh");
    const row = await admit(p.id, await freeBed(), hoursAgo(30));
    const bill = await billOf(row.id);
    expect(bill.beds[0]).toMatchObject({ hours: 30, amount: "3000.00" });
    expect(bill.totals.bed).toBe("3000.00");
  });

  it("with the toggle off: 26 hours is charged as 48, and a stay already running keeps its rule", async () => {
    const running = await newPatient("Elango");
    const before = await admit(running.id, await freeBed(), hoursAgo(26));
    await asAdmin()((tx) => saveInpatientSettings(tx, clinic.clinicId, { billingMode: "block", minimumHours: 24, sections: STANDARD_SECTIONS }, adminId));
    const p = await newPatient("Farid");
    const row = await admit(p.id, await freeBed(), hoursAgo(26));
    expect((await billOf(row.id)).beds[0]).toMatchObject({ hours: 48, amount: "4800.00" });
    expect((await billOf(before.id)).beds[0]).toMatchObject({ hours: 26 });
    await asAdmin()((tx) => saveInpatientSettings(tx, clinic.clinicId, { billingMode: "hourly", minimumHours: 24, sections: STANDARD_SECTIONS }, adminId));
  });

  it("a short stay is charged the minimum", async () => {
    const p = await newPatient("Ganesh");
    const row = await admit(p.id, await freeBed(), hoursAgo(3));
    expect((await billOf(row.id)).beds[0]).toMatchObject({ hours: 24, amount: "2400.00" });
  });

  it("a move to the ICU charges each bed at its own rate, on one clock", async () => {
    const p = await newPatient("Hari");
    const row = await admit(p.id, await freeBed(), hoursAgo(30));
    await asAdmin()((tx) => transferBed(tx, clinic.clinicId, row.id, bedIds[20], hoursAgo(6)));
    const bill = await billOf(row.id);
    expect(bill.beds.map((b) => [b.categoryName, b.hours, b.amount])).toEqual([
      ["General", 24, "2400.00"],
      ["ICU", 6, "2400.00"],
    ]);
    await expect(asAdmin()((tx) => transferBed(tx, clinic.clinicId, row.id, bedIds[20], new Date()))).rejects.toThrow(/already in this bed/);
  });
});

describe("the bill", () => {
  it("takes an advance and part payments, once each, and shows what is left", async () => {
    const p = await newPatient("Indira");
    const row = await admit(p.id, await freeBed(), hoursAgo(24));
    await pay(row.id, "advance", "1000.00");
    const key = randomUUID();
    const first = await pay(row.id, "payment", "500.00", key);
    const again = await pay(row.id, "payment", "500.00", key);
    expect(again).toMatchObject({ number: first.number, replayed: true });
    const bill = await billOf(row.id);
    expect(bill.totals).toMatchObject({ net: "2400.00", paid: "1500.00", balance: "900.00" });
    await expect(pay(row.id, "refund", "9999.00")).rejects.toThrow(/cannot be more/);
    await expect(owner`update app.admission_payments set amount = 1 where admission_id = ${row.id}`).rejects.toThrow(/append-only/);
  });

  it("adds charges, strikes one out with a reason, and applies an authorised discount and bed change", async () => {
    const p = await newPatient("Jaya");
    const row = await admit(p.id, await freeBed(), hoursAgo(30));
    await asAdmin()((tx) => addCharge(tx, clinic.clinicId, row.id, { kind: "doctor", description: "Consultant visit", quantity: 2, unitAmount: "500.00" }, adminId));
    const mistake = await asAdmin()((tx) => addCharge(tx, clinic.clinicId, row.id, { kind: "other", description: "Entered twice", quantity: 1, unitAmount: "700.00" }, adminId));
    expect((await billOf(row.id)).totals.charges).toBe("1700.00");
    await asAdmin()((tx) => voidCharge(tx, mistake.id, "Entered twice", adminId));
    await expect(asAdmin()((tx) => voidCharge(tx, mistake.id, "Again", adminId))).rejects.toThrow(/already struck out/);
    expect((await billOf(row.id)).totals.charges).toBe("1000.00");

    const stay = (await billOf(row.id)).beds[0];
    await asAdmin()((tx) => adjustBedStay(tx, stay.id, { hours: 24, rate: "2000.00", reason: "Hospital concession" }, adminId));
    const adjusted = await billOf(row.id);
    expect(adjusted.beds[0]).toMatchObject({ hours: 24, amount: "2000.00", overridden: true });

    await expect(asAdmin()((tx) => setAdmissionDiscount(tx, row.id, "99999.00", "Too much", adminId))).rejects.toThrow(/more than the bill/);
    await asAdmin()((tx) => setAdmissionDiscount(tx, row.id, "100.00", "Staff family", adminId));
    expect((await billOf(row.id)).totals).toMatchObject({ gross: "3000.00", discount: "100.00", net: "2900.00" });
  });

  it("lab tests and pharmacy charged to the stay join the bill, and are not counted as cash", async () => {
    const p = await newPatient("Kavin");
    const row = await admit(p.id, await freeBed(), hoursAgo(24));

    const [test] = await asAdmin()((tx) => listLabTestOptions(tx));
    await owner`update app.lab_tests set price = 300 where id = ${test.id}`;
    const order = await as(doctorId)((tx) => orderLab(tx, clinic.clinicId, row.encounterId, test.id, undefined, doctorId));
    expect((await billOf(row.id)).totals.charges).toBe("300.00");
    await as(doctorId)((tx) => cancelLabOrder(tx, order.id, doctorId));
    expect((await billOf(row.id)).totals.charges).toBe("0.00");

    const [drug] = await owner`select id from app.drugs where clinic_id = ${clinic.clinicId} and name = 'Paracetamol 650'`;
    await owner`update app.drugs set price = 10 where id = ${drug.id}`;
    const received = await as(pharmacistId)((tx) =>
      receiveStock(tx, clinic.clinicId, { drugId: drug.id, batchNo: "IP1", expiryDate: addDaysToDateString(today, 300), quantity: 100, reason: "opening" }, pharmacistId, today),
    );
    const { result: sale } = await as(pharmacistId)((tx) =>
      sell(tx, clinic.clinicId, { lines: [{ drugId: drug.id, batchId: received.batchId, quantity: 10 }], method: "inpatient", admissionId: row.id, idempotencyKey: randomUUID() }, pharmacistId, today),
    );
    expect(sale.patientId).toBe(p.id);
    expect((await billOf(row.id)).totals.charges).toBe(sale.total);

    const [line] = await owner`select id from app.pharmacy_sale_items where sale_id = ${sale.saleId}`;
    await as(pharmacistId)((tx) => createSaleReturn(tx, clinic.clinicId, { saleId: sale.saleId, kind: "return", reason: "Not needed", lines: [{ saleItemId: line.id, quantity: 5 }], idempotencyKey: randomUUID() }, pharmacistId, today, TZ));
    expect(Number((await billOf(row.id)).totals.charges)).toBeLessThan(Number(sale.total));

    const collected = await as(pharmacistId)((tx) => collectedByMethod(tx, pharmacyRange(today, today, TZ)));
    expect(collected.methods.some((m) => m.method === "inpatient")).toBe(false);
  });

  it("refuses a stay charge for someone not admitted", async () => {
    await expect(
      as(pharmacistId)((tx) => sell(tx, clinic.clinicId, { lines: [{ drugId: randomUUID(), batchId: randomUUID(), quantity: 1 }], method: "inpatient", idempotencyKey: randomUUID() }, pharmacistId, today)),
    ).rejects.toThrow();
  });

  it("payments on a stay appear in clinic collections", async () => {
    const start = zonedTimeToUtc(today, "00:00", TZ);
    const range = { from: start, to: zonedTimeToUtc(addDaysToDateString(today, 1), "00:00", TZ), fromDate: today, toDate: today, timeZone: TZ };
    const cash = async () => Number((await asAdmin()((tx) => collectionsByMethod(tx, range))).find((m) => m.method === "cash")?.billing ?? 0);
    const before = await cash();
    const p = await newPatient("Latha");
    const row = await admit(p.id, await freeBed(), hoursAgo(2));
    await pay(row.id, "advance", "750.00");
    expect(await cash()).toBe(before + 750);
  });
});

describe("discharge", () => {
  it("frees the bed, fixes the bill, and still takes the remaining payment afterwards", async () => {
    const p = await newPatient("Mohan");
    const bed = await freeBed();
    const row = await admit(p.id, bed, hoursAgo(30));
    await pay(row.id, "advance", "1000.00");
    await expect(asAdmin()((tx) => dischargePatient(tx, row.id, hoursAgo(40), adminId))).rejects.toThrow(/before/);
    await asAdmin()((tx) => dischargePatient(tx, row.id, new Date(), adminId));
    expect((await asAdmin()((tx) => bedBoard(tx, today))).find((b) => b.id === bed)?.admissionId).toBeNull();
    expect(await asAdmin()((tx) => openAdmissionFor(tx, p.id))).toBeNull();
    await expect(asAdmin()((tx) => dischargePatient(tx, row.id, new Date(), adminId))).rejects.toThrow(/has been discharged/);

    const later = await billOf(row.id, new Date(Date.now() + 100 * HOUR));
    expect(later.beds[0].hours).toBe(30);
    expect(later.totals).toMatchObject({ net: "3000.00", paid: "1000.00", balance: "2000.00" });
    await pay(row.id, "payment", "2000.00");
    expect((await billOf(row.id)).totals.balance).toBe("0.00");
  });
});

describe("discharge summary", () => {
  it("drafts itself from the record, keeps the doctor's words, signs, locks, and prints with the balance", async () => {
    const p = await newPatient("Nila");
    const row = await admit(p.id, await freeBed(), hoursAgo(30));
    await as(doctorId)((tx) => recordVitals(tx, clinic.clinicId, row.encounterId, { systolic: 130, diastolic: 80, pulse: 88 }, undefined, doctorId, today));
    await as(doctorId)((tx) => addDiagnosis(tx, clinic.clinicId, row.encounterId, { code: "A09", label: "Gastroenteritis", isPrimary: true }, doctorId));
    const [drug] = await owner`select id from app.drugs where clinic_id = ${clinic.clinicId} and name = 'Paracetamol 650'`;
    await as(doctorId)((tx) => addPrescriptionItem(tx, clinic.clinicId, row.encounterId, { drugId: drug.id, dose: "1 tablet", frequency: "TDS", durationDays: 5, quantity: null }, doctorId));

    await as(doctorId)((tx) => draftSummary(tx, clinic.clinicId, row.id, doctorId, today, TZ));
    let summary = (await as(doctorId)((tx) => getSummary(tx, row.id)))!;
    const body = (key: string) => summary.sections.find((s) => s.key === key)?.body ?? "";
    expect(body("reason")).toBe("Fever with dehydration");
    expect(body("diagnosis")).toContain("A09 Gastroenteritis (primary)");
    expect(body("course")).toContain("BP 130/80");
    expect(body("medicines")).toContain("Paracetamol 650");
    expect(body("condition")).toBe("");

    // Signing waits for what only the doctor can say.
    const signer = { id: doctorId, name: "Dr Dilip", registrationNumber: "TNMC-1" };
    await expect(as(doctorId)((tx) => signSummary(tx, row.id, signer))).rejects.toThrow(/Condition at discharge/);
    await as(doctorId)((tx) => saveSummary(tx, row.id, [{ key: "condition", body: "Stable, afebrile" }, { key: "reason", body: "Fever, edited by doctor" }]));
    await as(doctorId)((tx) => draftSummary(tx, clinic.clinicId, row.id, doctorId, today, TZ));
    summary = (await as(doctorId)((tx) => getSummary(tx, row.id)))!;
    expect(body("reason")).toBe("Fever, edited by doctor");

    await expect(as(doctorId)((tx) => signSummary(tx, row.id, { ...signer, registrationNumber: null }))).rejects.toThrow(/registration number/);
    await pay(row.id, "advance", "500.00");
    await as(doctorId)((tx) => signSummary(tx, row.id, signer));
    await expect(as(doctorId)((tx) => saveSummary(tx, row.id, [{ key: "condition", body: "Changed" }]))).rejects.toThrow(/locked/);
    await expect(owner`update app.discharge_summaries set sections = '[]' where admission_id = ${row.id}`).rejects.toThrow(/cannot be changed/);

    const context = { letterhead: { name: "Clinic", addressLine: null, city: null, phone: null, email: null, letterheadText: null, footerText: null }, currency: "INR", timezone: TZ };
    const data = await asAdmin()(async (tx) => ({ bill: await admissionBill(tx, row.id), summary: await getSummary(tx, row.id) }));
    const admission = { number: row.number, patient: { name: "Nila", mrn: "P-1", age: 55, sex: "male", addressLine: null, city: null }, doctorName: "Dr Dilip", admittedAt: hoursAgo(30), dischargedAt: null, attendantName: null, attendantPhone: null };
    const isPdf = (b: Uint8Array) => Buffer.from(b.slice(0, 5)).toString() === "%PDF-";
    expect(isPdf(await renderDischargeSummaryPdf(admission, data.summary!, data.bill!, context))).toBe(true);
    expect(isPdf(await renderInpatientBillPdf(admission, data.bill!, context))).toBe(true);
  });
});
