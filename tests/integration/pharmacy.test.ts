// Phase 6: stock ledger, sales and dispensing (idempotent), clarifications,
// purchase orders and alerts.
import { randomUUID } from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { ownerSql } from "./test-db";
import { createTestClinic } from "./fixtures";
import { withClinic } from "@/lib/db";
import { AppError, isLockedRecord } from "@/lib/errors";
import { drugs, stockBatches } from "@/lib/db/schema";
import { createStaff } from "@/features/staff/staff.service";
import { registerPatient } from "@/features/patients/patients.service";
import { addWalkIn } from "@/features/scheduling/booking.service";
import { callPatient, finalizeEncounter } from "@/features/clinical/encounters.service";
import { addPrescriptionItem } from "@/features/clinical/prescriptions.service";
import { adjustStock, listStock, receiveStock } from "@/features/pharmacy/stock.service";
import { closePrescription, getPrescriptionForDispensing, listPrescriptionQueue, sell } from "@/features/pharmacy/sales.service";
import { answerQuery, listOpenQueriesFor, raiseQuery } from "@/features/pharmacy/queries.service";
import { createOrder, decideOrder, receiveOrder, saveSupplier, setOrderItem, submitOrder } from "@/features/pharmacy/purchasing.service";
import { addDaysToDateString, todayInTimeZone } from "@/lib/time";

const TZ = "Asia/Kolkata";
const owner = ownerSql();
const today = todayInTimeZone(TZ);
const nextYear = addDaysToDateString(today, 365);
const soon = addDaysToDateString(today, 30);

let clinic: Awaited<ReturnType<typeof createTestClinic>>;
let adminId: string;
let doctorId: string;
let pharmacistId: string;
const drugIdByName = new Map<string, string>();

const as = (userId: string) => <T,>(fn: Parameters<typeof withClinic<T>>[1]) => withClinic({ clinicId: clinic.clinicId, userId }, fn);
const asPharmacist = () => as(pharmacistId);

const drug = (name: string) => drugIdByName.get(name)!;

async function onHand(drugId: string) {
  const [row] = await owner`select coalesce(sum(quantity), 0)::int as n from app.stock_batches where drug_id = ${drugId}`;
  return row.n as number;
}

async function batchOf(drugId: string, batchNo: string) {
  const [row] = await owner`select id from app.stock_batches where drug_id = ${drugId} and batch_no = ${batchNo}`;
  return row.id as string;
}

async function receive(name: string, batchNo: string, quantity: number, expiryDate = nextYear) {
  return asPharmacist()((tx) => receiveStock(tx, clinic.clinicId, { drugId: drug(name), batchNo, expiryDate, quantity, reason: "opening" }, pharmacistId, today));
}

/** A finalised consultation with these items; returns the prescription id. */
async function signedPrescription(items: { name: string; quantity?: number; dose?: string; frequency?: string; days?: number }[]) {
  const asDoctor = as(doctorId);
  const p = await as(adminId)((tx) =>
    registerPatient(tx, clinic.clinicId, { firstName: `Rx${randomUUID().slice(0, 6)}`, sex: "female", statedAgeYears: 50 }, { likelyIds: [], actorId: adminId, today }),
  );
  const visit = await as(adminId)((tx) => addWalkIn(tx, clinic.clinicId, { patientId: p.id, doctorId }, adminId, today));
  const { encounterId } = await asDoctor((tx) => callPatient(tx, clinic.clinicId, visit.id, doctorId, today));
  for (const item of items) {
    await asDoctor((tx) =>
      addPrescriptionItem(
        tx,
        clinic.clinicId,
        encounterId,
        { drugId: drug(item.name), dose: item.dose ?? "1 tablet", frequency: item.frequency ?? "TDS", durationDays: item.days ?? 3, quantity: item.quantity ?? null },
        doctorId,
      ),
    );
  }
  const result = await asDoctor((tx) => finalizeEncounter(tx, encounterId, doctorId, today));
  return result.prescriptionId!;
}

beforeAll(async () => {
  clinic = await createTestClinic("pharmacy");
  const [admin] = await owner`select id from app.users where clinic_id = ${clinic.clinicId}`;
  adminId = admin.id;
  const mk = (firstName: string, roleKeys: string[], registrationNumber?: string) =>
    as(adminId)((tx) => createStaff(tx, clinic.clinicId, { firstName, lastName: "Staff", email: `${firstName.toLowerCase()}@pharmacy.test`, roleKeys, registrationNumber }, adminId));
  doctorId = (await mk("Daksh", ["doctor"], "REG-9")).id;
  pharmacistId = (await mk("Parul", ["pharmacist"])).id;

  for (const [name, price] of [
    ["Paracetamol 650", "2.50"],
    ["Paracetamol 500", "2.00"],
    ["Amoxicillin 500", "6.00"],
    ["Cetirizine 10", "1.50"],
  ] as const) {
    const [row] = await as(adminId)((tx) => tx.update(drugs).set({ price }).where(eq(drugs.name, name)).returning({ id: drugs.id }));
    drugIdByName.set(name, row.id);
  }
});

afterAll(async () => {
  await owner.end();
});

describe("stock ledger", () => {
  it("only changes through movements, never below zero, never deleted", async () => {
    const received = await receive("Cetirizine 10", "cet-a", 20);
    expect(received.batchNo).toBe("CET-A");
    expect(await onHand(drug("Cetirizine 10"))).toBe(20);

    await expectLocked(asPharmacist()((tx) => tx.update(stockBatches).set({ quantity: 999 }).where(eq(stockBatches.id, received.batchId))));
    await expect(owner`update app.stock_batches set quantity = 999 where id = ${received.batchId}`).rejects.toThrow(/stock movements/);
    await expect(owner`delete from app.stock_batches where id = ${received.batchId}`).rejects.toThrow(/cannot be deleted/);
    await expect(owner`update app.stock_movements set change = 99 where batch_id = ${received.batchId}`).rejects.toThrow(/append-only/);

    await expect(asPharmacist()((tx) => adjustStock(tx, clinic.clinicId, { batchId: received.batchId, change: -25, reason: "damaged", note: "Dropped" }, pharmacistId))).rejects.toThrow(/only has 20/);
    await asPharmacist()((tx) => adjustStock(tx, clinic.clinicId, { batchId: received.batchId, change: -2, reason: "damaged", note: "Crushed strip" }, pharmacistId));
    expect(await onHand(drug("Cetirizine 10"))).toBe(18);

    // Even a raw insert cannot take a batch negative.
    await expect(
      asPharmacist()((tx) =>
        tx.execute(sql`insert into app.stock_movements (clinic_id, drug_id, batch_id, change, reason, actor_id) values (${clinic.clinicId}, ${drug("Cetirizine 10")}, ${received.batchId}, -100, 'adjustment', ${pharmacistId})`),
      ),
    ).rejects.toThrow();
    expect(await onHand(drug("Cetirizine 10"))).toBe(18);
  });

  it("flags low, expiring and out-of-stock medicines", async () => {
    await as(adminId)((tx) => tx.update(drugs).set({ reorderLevel: 25 }).where(eq(drugs.id, drug("Cetirizine 10"))));
    await receive("Paracetamol 500", "p500-soon", 5, soon);
    const stock = await asPharmacist()((tx) => listStock(tx, today));
    const flagsOf = (name: string) => stock.find((s) => s.name === name)?.flags ?? [];
    expect(flagsOf("Cetirizine 10")).toContain("low");
    expect(flagsOf("Paracetamol 500")).toContain("expiring");
    expect(flagsOf("Amoxicillin 500")).toEqual([]); // never stocked: no alert
    await as(adminId)((tx) => tx.update(drugs).set({ reorderLevel: 10 }).where(eq(drugs.id, drug("Amoxicillin 500"))));
    const after = await asPharmacist()((tx) => listStock(tx, today));
    expect(after.find((s) => s.name === "Amoxicillin 500")?.flags).toContain("out");
  });
});

describe("counter sales", () => {
  it("a double-submit sells once and moves stock once", async () => {
    await receive("Paracetamol 650", "p650-a", 30);
    const batchId = await batchOf(drug("Paracetamol 650"), "P650-A");
    const key = randomUUID();
    const input = { lines: [{ drugId: drug("Paracetamol 650"), batchId, quantity: 10 }], method: "cash" as const, idempotencyKey: key };
    const [a, b] = await Promise.all([
      asPharmacist()((tx) => sell(tx, clinic.clinicId, input, pharmacistId, today)),
      asPharmacist()((tx) => sell(tx, clinic.clinicId, input, pharmacistId, today)),
    ]);
    expect(a.result.saleId).toBe(b.result.saleId);
    expect([a.replayed, b.replayed].sort()).toEqual([false, true]);
    expect(a.result.total).toBe("25.00");
    expect(await onHand(drug("Paracetamol 650"))).toBe(20);
    const sales = await owner`select id from app.pharmacy_sales where clinic_id = ${clinic.clinicId}`;
    expect(sales).toHaveLength(1);

    await expect(
      asPharmacist()((tx) => sell(tx, clinic.clinicId, { ...input, lines: [{ ...input.lines[0], quantity: 11 }] }, pharmacistId, today)),
    ).rejects.toThrow(/already used/);
  });

  it("never oversells the last units, even with two sales at once", async () => {
    await receive("Amoxicillin 500", "amx-last", 5);
    const batchId = await batchOf(drug("Amoxicillin 500"), "AMX-LAST");
    const line = { drugId: drug("Amoxicillin 500"), batchId, quantity: 4 };
    const results = await Promise.allSettled([
      asPharmacist()((tx) => sell(tx, clinic.clinicId, { lines: [line], method: "cash", idempotencyKey: randomUUID() }, pharmacistId, today)),
      asPharmacist()((tx) => sell(tx, clinic.clinicId, { lines: [line], method: "upi", idempotencyKey: randomUUID() }, pharmacistId, today)),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(String((results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason.message)).toMatch(/Only 1/);
    expect(await onHand(drug("Amoxicillin 500"))).toBe(1);
  });

  it("refuses expired batches", async () => {
    const [batch] = await owner`insert into app.stock_batches (clinic_id, drug_id, batch_no, expiry_date) values (${clinic.clinicId}, ${drug("Paracetamol 500")}, 'OLD-1', ${addDaysToDateString(today, -1)}) returning id`;
    await owner`insert into app.stock_movements (clinic_id, drug_id, batch_id, change, reason, actor_id) values (${clinic.clinicId}, ${drug("Paracetamol 500")}, ${batch.id}, 10, 'opening', ${pharmacistId})`;
    await expect(
      asPharmacist()((tx) => sell(tx, clinic.clinicId, { lines: [{ drugId: drug("Paracetamol 500"), batchId: batch.id, quantity: 1 }], method: "cash", idempotencyKey: randomUUID() }, pharmacistId, today)),
    ).rejects.toThrow(/expired/);
    expect(await asPharmacist()((tx) => listStock(tx, today)).then((s) => s.find((x) => x.name === "Paracetamol 500")?.flags)).toContain("expired");
  });
});

describe("dispensing", () => {
  it("fills a signed prescription in parts, allows same-generic substitution, and closes it", async () => {
    const rxId = await signedPrescription([{ name: "Paracetamol 650", dose: "1 tablet", frequency: "TDS", days: 2 }]);
    const view = await asPharmacist()((tx) => getPrescriptionForDispensing(tx, rxId, today));
    const item = view!.items[0];
    expect(item.needed).toBe(6);
    expect(view!.source.doctorName).toContain("Daksh");
    expect((await asPharmacist()((tx) => listPrescriptionQueue(tx, today, new Date(0)))).map((q) => q.prescriptionId)).toContain(rxId);

    const p650 = await batchOf(drug("Paracetamol 650"), "P650-A");
    const first = await asPharmacist()((tx) =>
      sell(tx, clinic.clinicId, { prescriptionId: rxId, lines: [{ drugId: drug("Paracetamol 650"), batchId: p650, quantity: 4, prescriptionItemId: item.id }], method: "cash", idempotencyKey: randomUUID() }, pharmacistId, today),
    );
    expect(first.result.dispenseStatus).toBe("partial");

    // Same generic, different strength-brand: allowed. A different medicine: refused.
    const p500 = await batchOf(drug("Paracetamol 500"), "P500-SOON");
    const second = await asPharmacist()((tx) =>
      sell(tx, clinic.clinicId, { prescriptionId: rxId, lines: [{ drugId: drug("Paracetamol 500"), batchId: p500, quantity: 2, prescriptionItemId: item.id }], method: "cash", idempotencyKey: randomUUID() }, pharmacistId, today),
    );
    expect(second.result.dispenseStatus).toBe("dispensed");
    expect((await asPharmacist()((tx) => listPrescriptionQueue(tx, today, new Date(0)))).map((q) => q.prescriptionId)).not.toContain(rxId);

    const other = await signedPrescription([{ name: "Paracetamol 650" }]);
    const otherItem = (await asPharmacist()((tx) => getPrescriptionForDispensing(tx, other, today)))!.items[0];
    const cet = await batchOf(drug("Cetirizine 10"), "CET-A");
    await expect(
      asPharmacist()((tx) =>
        sell(tx, clinic.clinicId, { prescriptionId: other, lines: [{ drugId: drug("Cetirizine 10"), batchId: cet, quantity: 1, prescriptionItemId: otherItem.id }], method: "cash", idempotencyKey: randomUUID() }, pharmacistId, today),
      ),
    ).rejects.toThrow(/same medicine or the same generic/);

    await asPharmacist()((tx) => closePrescription(tx, other));
    await expect(asPharmacist()((tx) => closePrescription(tx, other))).rejects.toThrow(AppError);
    // The prescription itself stayed untouched apart from its pharmacy status.
    const [rx] = await owner`select status, dispense_status from app.prescriptions where id = ${other}`;
    expect(rx).toEqual({ status: "signed", dispense_status: "not_required" });
  });

  it("routes questions to the prescriber and back", async () => {
    const rxId = await signedPrescription([{ name: "Amoxicillin 500", frequency: "TDS", days: 5 }]);
    const q = await asPharmacist()((tx) => raiseQuery(tx, clinic.clinicId, rxId, null, "Only 1 left in stock. OK to give 10 and the rest tomorrow?", pharmacistId));
    const open = await as(doctorId)((tx) => listOpenQueriesFor(tx, doctorId));
    expect(open.map((o) => o.id)).toContain(q.id);
    await as(doctorId)((tx) => answerQuery(tx, q.id, "Yes, fine.", doctorId));
    await expect(as(doctorId)((tx) => answerQuery(tx, q.id, "Again", doctorId))).rejects.toThrow(/already been answered/);
    expect((await as(doctorId)((tx) => listOpenQueriesFor(tx, doctorId))).map((o) => o.id)).not.toContain(q.id);
  });
});

describe("purchase orders", () => {
  it("needs approval by someone else, and a retried receipt adds stock once", async () => {
    const supplier = await asPharmacist()((tx) => saveSupplier(tx, clinic.clinicId, null, { name: "Sun Distributors" }));
    const order = await asPharmacist()((tx) => createOrder(tx, clinic.clinicId, supplier.id, pharmacistId));
    await expect(asPharmacist()((tx) => submitOrder(tx, order.id))).rejects.toThrow(/at least one/);
    await asPharmacist()((tx) => setOrderItem(tx, clinic.clinicId, order.id, { drugId: drug("Amoxicillin 500"), quantity: 100, unitCost: "3.10" }));
    await asPharmacist()((tx) => submitOrder(tx, order.id));

    await expect(asPharmacist()((tx) => decideOrder(tx, order.id, "approved", undefined, pharmacistId))).rejects.toThrow(/Someone other/);
    await as(adminId)((tx) => decideOrder(tx, order.id, "approved", undefined, adminId));

    const [item] = await owner`select id from app.purchase_order_items where purchase_order_id = ${order.id}`;
    const before = await onHand(drug("Amoxicillin 500"));
    const key = randomUUID();
    const lines = [{ itemId: item.id, batchNo: "AMX-PO1", expiryDate: nextYear, quantity: 100 }];
    const [a, b] = await Promise.all([
      asPharmacist()((tx) => receiveOrder(tx, clinic.clinicId, order.id, lines, key, pharmacistId, today)),
      asPharmacist()((tx) => receiveOrder(tx, clinic.clinicId, order.id, lines, key, pharmacistId, today)),
    ]);
    expect([a.replayed, b.replayed].sort()).toEqual([false, true]);
    expect(await onHand(drug("Amoxicillin 500"))).toBe(before + 100);
    await expect(asPharmacist()((tx) => receiveOrder(tx, clinic.clinicId, order.id, lines, randomUUID(), pharmacistId, today))).rejects.toThrow(/approved/);
  });
});

async function expectLocked(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(isLockedRecord(error)).toBe(true);
}
