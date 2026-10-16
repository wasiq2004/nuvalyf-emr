// Phase 5: invoices, recorded payments, idempotency and the money guards.
import { randomUUID } from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { ownerSql } from "./test-db";
import { createTestClinic } from "./fixtures";
import { withClinic } from "@/lib/db";
import { AppError, isLockedRecord } from "@/lib/errors";
import { invoiceItems, invoices } from "@/lib/db/schema";
import { createStaff } from "@/features/staff/staff.service";
import { createService } from "@/features/scheduling/services.service";
import { registerPatient } from "@/features/patients/patients.service";
import { addWalkIn } from "@/features/scheduling/booking.service";
import { callPatient } from "@/features/clinical/encounters.service";
import { listLabTestOptions, orderLab } from "@/features/clinical/lab.service";
import {
  addInvoiceItem,
  collections,
  createInvoice,
  createInvoiceForVisit,
  discardDraft,
  getInvoice,
  issueInvoice,
  outstandingSummary,
  recordPayment,
  recordRefund,
  removeInvoiceItem,
  setDiscount,
  visitsToBill,
  voidInvoice,
} from "@/features/billing/billing.service";
import { addDaysToDateString, todayInTimeZone, zonedTimeToUtc } from "@/lib/time";

const TZ = "Asia/Kolkata";
const owner = ownerSql();
const today = todayInTimeZone(TZ);

let clinic: Awaited<ReturnType<typeof createTestClinic>>;
let adminId: string;
let doctorId: string;
let consultId: string;

const run = <T,>(fn: Parameters<typeof withClinic<T>>[1]) => withClinic({ clinicId: clinic.clinicId, userId: adminId }, fn);

async function patient(name: string) {
  return run((tx) => registerPatient(tx, clinic.clinicId, { firstName: name, lastName: "Bill", sex: "male", statedAgeYears: 35 }, { likelyIds: [], actorId: adminId, today }));
}

/** An issued invoice with one line of `amount`. */
async function issuedInvoice(name: string, amount = "500.00") {
  const p = await patient(name);
  const inv = await run((tx) => createInvoice(tx, clinic.clinicId, p.id, adminId));
  await run((tx) => addInvoiceItem(tx, clinic.clinicId, inv.id, { kind: "other", description: "Consultation", quantity: 1, unitPrice: amount }));
  await run((tx) => issueInvoice(tx, inv.id, adminId));
  return inv.id;
}

const pay = (invoiceId: string, amount: string, key = randomUUID()) =>
  run((tx) => recordPayment(tx, clinic.clinicId, { invoiceId, amount, method: "cash", idempotencyKey: key }, adminId));

async function expectLocked(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(isLockedRecord(error)).toBe(true);
}

beforeAll(async () => {
  clinic = await createTestClinic("billing");
  const [admin] = await owner`select id from app.users where clinic_id = ${clinic.clinicId}`;
  adminId = admin.id;
  doctorId = (
    await run((tx) =>
      createStaff(tx, clinic.clinicId, { firstName: "Dee", lastName: "Doc", email: "dee@billing.test", roleKeys: ["doctor"], registrationNumber: "R-1" }, adminId),
    )
  ).id;
  consultId = (await run((tx) => createService(tx, clinic.clinicId, { name: "Consult", durationMinutes: 15, price: 400, isActive: true }))).id;
  await owner`update app.lab_tests set price = 150 where clinic_id = ${clinic.clinicId} and name = 'Haemoglobin'`;
});

afterAll(async () => {
  await owner.end();
});

describe("invoices", () => {
  it("bills a visit with its service and lab tests, once", async () => {
    const p = await patient("Visit");
    const visit = await run((tx) => addWalkIn(tx, clinic.clinicId, { patientId: p.id, doctorId, serviceId: consultId }, adminId, today));
    const called = await withClinic({ clinicId: clinic.clinicId, userId: doctorId }, (tx) => callPatient(tx, clinic.clinicId, visit.id, doctorId, today));
    const hb = (await run((tx) => listLabTestOptions(tx))).find((t) => t.name === "Haemoglobin")!;
    await withClinic({ clinicId: clinic.clinicId, userId: doctorId }, (tx) => orderLab(tx, clinic.clinicId, called.encounterId, hb.id, undefined, doctorId));
    await owner`update app.visits set status = 'completed', completed_at = now() where id = ${visit.id}`;

    expect((await run((tx) => visitsToBill(tx, today))).map((v) => v.visitId)).toContain(visit.id);
    const first = await run((tx) => createInvoiceForVisit(tx, clinic.clinicId, visit.id, adminId));
    const again = await run((tx) => createInvoiceForVisit(tx, clinic.clinicId, visit.id, adminId));
    expect(again.id).toBe(first.id);
    expect(again.created).toBe(false);
    expect((await run((tx) => visitsToBill(tx, today))).map((v) => v.visitId)).not.toContain(visit.id);

    const invoice = await run((tx) => getInvoice(tx, first.id));
    expect(invoice!.number).toMatch(/^INV-\d{6}$/);
    expect(invoice!.items.map((i) => [i.description, i.amount])).toEqual([
      ["Consult", "400.00"],
      ["Haemoglobin", "150.00"],
    ]);
    expect(invoice!.total).toBe("550.00");
  });

  it("edits drafts with exact totals, and discounts need a reason and cannot exceed the bill", async () => {
    const p = await patient("Draft");
    const inv = await run((tx) => createInvoice(tx, clinic.clinicId, p.id, adminId));
    await run((tx) => addInvoiceItem(tx, clinic.clinicId, inv.id, { kind: "other", description: "Dressing", quantity: 3, unitPrice: "33.33" }));
    await run((tx) => addInvoiceItem(tx, clinic.clinicId, inv.id, { kind: "other", description: "Certificate", quantity: 1, unitPrice: "0.01" }));
    let invoice = await run((tx) => getInvoice(tx, inv.id));
    expect(invoice!.subtotal).toBe("100.00");

    await expect(run((tx) => setDiscount(tx, inv.id, "10.00", undefined))).rejects.toThrow(/reason/);
    await expect(run((tx) => setDiscount(tx, inv.id, "100.01", "Too much"))).rejects.toThrow(/larger/);
    await run((tx) => setDiscount(tx, inv.id, "10.00", "Senior citizen"));
    invoice = await run((tx) => getInvoice(tx, inv.id));
    expect(invoice!.total).toBe("90.00");

    // Removing a line that would leave the discount bigger than the bill is refused.
    await run((tx) => setDiscount(tx, inv.id, "99.00", "Staff family"));
    const dressing = invoice!.items.find((i) => i.description === "Dressing")!;
    await expect(run((tx) => removeInvoiceItem(tx, dressing.id))).rejects.toThrow(/larger/);
  });

  it("discards drafts but never deletes issued invoices", async () => {
    const p = await patient("Discard");
    const draft = await run((tx) => createInvoice(tx, clinic.clinicId, p.id, adminId));
    await run((tx) => addInvoiceItem(tx, clinic.clinicId, draft.id, { kind: "other", description: "X", quantity: 1, unitPrice: "10" }));
    await run((tx) => discardDraft(tx, draft.id));
    expect(await run((tx) => getInvoice(tx, draft.id))).toBeNull();

    const issued = await issuedInvoice("Kept");
    await expect(run((tx) => discardDraft(tx, issued))).rejects.toThrow(AppError);
    await expect(owner`delete from app.invoices where id = ${issued}`).rejects.toThrow(/cannot be deleted/);
  });
});

describe("payments", () => {
  it("records exactly one payment for a double-submit (same idempotency key, at the same time)", async () => {
    const invoiceId = await issuedInvoice("Double");
    const key = randomUUID();
    const [a, b] = await Promise.all([pay(invoiceId, "500.00", key), pay(invoiceId, "500.00", key)]);
    expect(a.paymentId).toBe(b.paymentId);
    expect([a.duplicate, b.duplicate].sort()).toEqual([false, true]);

    const rows = await owner`select id from app.payments where invoice_id = ${invoiceId}`;
    expect(rows).toHaveLength(1);
    const invoice = await run((tx) => getInvoice(tx, invoiceId));
    expect(invoice!.amountPaid).toBe("500.00");
    expect(invoice!.paymentState).toBe("paid");

    // A retry later returns the same payment too.
    const retry = await pay(invoiceId, "500.00", key);
    expect(retry).toMatchObject({ paymentId: a.paymentId, duplicate: true });
  });

  it("never takes more than the balance, even with two different payments at once", async () => {
    const invoiceId = await issuedInvoice("Race");
    const results = await Promise.allSettled([pay(invoiceId, "500.00"), pay(invoiceId, "500.00")]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(String(rejected.reason.message)).toMatch(/more than the balance/);
  });

  it("refuses a reused key for a different amount", async () => {
    const invoiceId = await issuedInvoice("Reuse");
    const key = randomUUID();
    await pay(invoiceId, "100.00", key);
    await expect(pay(invoiceId, "200.00", key)).rejects.toThrow(/already used/);
  });

  it("issues a draft when money is taken, freezing its lines", async () => {
    const p = await patient("Auto");
    const inv = await run((tx) => createInvoice(tx, clinic.clinicId, p.id, adminId));
    await run((tx) => addInvoiceItem(tx, clinic.clinicId, inv.id, { kind: "other", description: "Consult", quantity: 1, unitPrice: "300" }));
    await pay(inv.id, "100.00");
    const invoice = await run((tx) => getInvoice(tx, inv.id));
    expect(invoice!.status).toBe("issued");
    expect(invoice!.paymentState).toBe("partial");
    expect(invoice!.balance).toBe("200.00");

    await expect(run((tx) => addInvoiceItem(tx, clinic.clinicId, inv.id, { kind: "other", description: "Extra", quantity: 1, unitPrice: "1" }))).rejects.toThrow(AppError);
    await expectLocked(run((tx) => tx.update(invoiceItems).set({ unitPrice: "1.00", amount: "1.00" }).where(eq(invoiceItems.invoiceId, inv.id))));
    await expectLocked(run((tx) => tx.update(invoices).set({ total: "1.00" }).where(eq(invoices.id, inv.id))));
    await expectLocked(run((tx) => tx.execute(sql`insert into app.invoice_items (clinic_id, invoice_id, kind, description, quantity, unit_price, amount) values (${clinic.clinicId}, ${inv.id}, 'other', 'sneaky', 1, 1, 1)`)));
  });

  it("refunds with a reason, keeps payments append-only, and voids only after a full refund", async () => {
    const invoiceId = await issuedInvoice("Refund", "250.00");
    const paid = await pay(invoiceId, "250.00");
    await expect(run((tx) => voidInvoice(tx, invoiceId, "Wrong patient", adminId))).rejects.toThrow(/Refund/);
    await expect(run((tx) => recordRefund(tx, clinic.clinicId, { invoiceId, amount: "50", method: "cash", idempotencyKey: randomUUID() }, adminId))).rejects.toThrow(/reason/);
    await expect(
      run((tx) => recordRefund(tx, clinic.clinicId, { invoiceId, amount: "300", method: "cash", reason: "x", idempotencyKey: randomUUID() }, adminId)),
    ).rejects.toThrow(/At most/);

    await run((tx) => recordRefund(tx, clinic.clinicId, { invoiceId, amount: "250.00", method: "cash", reason: "Wrong patient", idempotencyKey: randomUUID() }, adminId));
    expect((await run((tx) => getInvoice(tx, invoiceId)))!.amountPaid).toBe("0.00");
    await expect(owner`update app.payments set amount = 1 where id = ${paid.paymentId}`).rejects.toThrow(/append-only/);
    await expect(owner`delete from app.payments where id = ${paid.paymentId}`).rejects.toThrow(/append-only/);

    await run((tx) => voidInvoice(tx, invoiceId, "Wrong patient", adminId));
    await expectLocked(run((tx) => tx.update(invoices).set({ status: "issued" }).where(eq(invoices.id, invoiceId))));
    await expect(pay(invoiceId, "10.00")).rejects.toThrow(/void/);
  });

  it("sums collections net of refunds, per method, and what is outstanding", async () => {
    const other = await createTestClinic("billsum");
    const [otherAdmin] = await owner`select id from app.users where clinic_id = ${other.clinicId}`;
    const inOther = <T,>(fn: Parameters<typeof withClinic<T>>[1]) => withClinic({ clinicId: other.clinicId, userId: otherAdmin.id }, fn);
    const p = await inOther((tx) => registerPatient(tx, other.clinicId, { firstName: "Sum", sex: "female", statedAgeYears: 40 }, { likelyIds: [], actorId: otherAdmin.id, today }));
    const make = async (amount: string) => {
      const inv = await inOther((tx) => createInvoice(tx, other.clinicId, p.id, otherAdmin.id));
      await inOther((tx) => addInvoiceItem(tx, other.clinicId, inv.id, { kind: "other", description: "Item", quantity: 1, unitPrice: amount }));
      await inOther((tx) => issueInvoice(tx, inv.id, otherAdmin.id));
      return inv.id;
    };
    const a = await make("1000");
    const b = await make("400");
    await inOther((tx) => recordPayment(tx, other.clinicId, { invoiceId: a, amount: "600", method: "upi", idempotencyKey: randomUUID() }, otherAdmin.id));
    await inOther((tx) => recordPayment(tx, other.clinicId, { invoiceId: b, amount: "400", method: "cash", idempotencyKey: randomUUID() }, otherAdmin.id));
    await inOther((tx) => recordRefund(tx, other.clinicId, { invoiceId: b, amount: "100", method: "cash", reason: "Partial", idempotencyKey: randomUUID() }, otherAdmin.id));

    const start = zonedTimeToUtc(today, "00:00", TZ);
    const end = zonedTimeToUtc(addDaysToDateString(today, 1), "00:00", TZ);
    const money = await inOther((tx) => collections(tx, start, end));
    expect(money).toEqual({ total: "900.00", byMethod: { upi: "600.00", cash: "300.00" } });
    expect(await inOther((tx) => outstandingSummary(tx))).toEqual({ amount: "500.00", count: 2 });
  });
});
