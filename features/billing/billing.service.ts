import "server-only";

// Invoices and recorded payments. Every money change happens with the
// invoice row locked, so totals and "amount paid" cannot drift, and a payment
// carries an idempotency key so a double-tap or a retry records it once.
import { randomUUID } from "crypto";
import { and, asc, desc, eq, gte, inArray, lt, ne, sql } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import { encounters, invoiceItems, invoices, labOrders, labTests, patients, payments, services, users, visits } from "@/lib/db/schema";
import { AppError, isUniqueViolation } from "@/lib/errors";
import { fromMinor, toMinor } from "@/lib/money";
import { displayPatientName } from "@/features/patients/patient-rules";
import { nextCounter } from "@/features/patients/patients.service";
import { staffName } from "@/features/clinical/encounters.service";
import { balanceOf, invoiceTotals, lineAmount, paymentState, type ItemKind, type PaymentMethod } from "./billing-rules";

async function newNumber(tx: Tx, clinicId: string) {
  return `INV-${String(await nextCounter(tx, clinicId, "invoice")).padStart(6, "0")}`;
}

/**
 * Invoices are created under a unique placeholder and numbered as the very
 * last step: the per-clinic counter row stays locked until commit, so taking
 * it last keeps concurrent billing from queueing behind each other (found by
 * the load test). Numbers stay unique; gaps already occur when drafts are
 * discarded.
 */
const placeholderNumber = () => `TMP-${randomUUID().slice(0, 20)}`;

async function assignNumber(tx: Tx, clinicId: string, invoiceId: string) {
  await tx.update(invoices).set({ number: await newNumber(tx, clinicId) }).where(eq(invoices.id, invoiceId));
}

async function lockInvoice(tx: Tx, id: string) {
  const [row] = await tx.select().from(invoices).where(eq(invoices.id, id)).for("update").limit(1);
  if (!row) throw new AppError("Invoice not found.");
  return row;
}

async function lockDraft(tx: Tx, id: string) {
  const row = await lockInvoice(tx, id);
  if (row.status !== "draft") throw new AppError("Only a draft invoice can be edited. Issued invoices are corrected with a refund or by voiding.");
  return row;
}

async function recomputeTotals(tx: Tx, invoiceId: string, discount: string) {
  const lines = await tx.select({ amount: invoiceItems.amount }).from(invoiceItems).where(eq(invoiceItems.invoiceId, invoiceId));
  let totals;
  try {
    totals = invoiceTotals(lines, discount);
  } catch (error) {
    if (error instanceof RangeError) throw new AppError(error.message);
    throw error;
  }
  await tx
    .update(invoices)
    .set({ subtotal: totals.subtotal, total: totals.total, discount, updatedAt: new Date() })
    .where(eq(invoices.id, invoiceId));
  return totals;
}

type NewLine = { kind: ItemKind; description: string; quantity: number; unitPrice: string; sourceType?: string; sourceId?: string };

async function insertLines(tx: Tx, clinicId: string, invoiceId: string, lines: NewLine[], startAt: number) {
  if (lines.length === 0) return;
  await tx.insert(invoiceItems).values(
    lines.map((l, i) => ({
      clinicId,
      invoiceId,
      kind: l.kind,
      description: l.description,
      quantity: l.quantity,
      unitPrice: fromMinor(toMinor(l.unitPrice)),
      amount: lineAmount(l.unitPrice, l.quantity),
      sourceType: l.sourceType ?? null,
      sourceId: l.sourceId ?? null,
      sortOrder: startAt + i,
    })),
  );
}

// ---------------------------------------------------------------------------
// Creating and editing drafts
// ---------------------------------------------------------------------------

/**
 * The visit's invoice: the existing live one, or a new draft pre-filled with
 * the visit's service and any lab tests ordered in its consultation.
 */
export async function createInvoiceForVisit(tx: Tx, clinicId: string, visitId: string, userId: string) {
  const [visit] = await tx.select().from(visits).where(eq(visits.id, visitId)).for("update").limit(1);
  if (!visit) throw new AppError("Visit not found.");
  const [existing] = await tx
    .select({ id: invoices.id })
    .from(invoices)
    .where(and(eq(invoices.visitId, visitId), ne(invoices.status, "void")))
    .limit(1);
  if (existing) return { id: existing.id, patientId: visit.patientId, created: false };

  const lines: NewLine[] = [];
  if (visit.serviceId) {
    const [service] = await tx.select().from(services).where(eq(services.id, visit.serviceId)).limit(1);
    if (service) lines.push({ kind: "service", description: service.name, quantity: 1, unitPrice: service.price, sourceType: "service", sourceId: service.id });
  }
  const labs = await tx
    .select({ id: labOrders.id, testName: labOrders.testName, price: labTests.price })
    .from(labOrders)
    .innerJoin(encounters, eq(encounters.id, labOrders.encounterId))
    .leftJoin(labTests, eq(labTests.id, labOrders.testId))
    .where(and(eq(encounters.visitId, visitId), ne(labOrders.status, "cancelled")))
    .orderBy(asc(labOrders.orderedAt));
  for (const lab of labs) {
    lines.push({ kind: "lab", description: lab.testName, quantity: 1, unitPrice: lab.price ?? "0", sourceType: "lab_order", sourceId: lab.id });
  }

  const [row] = await tx
    .insert(invoices)
    .values({ clinicId, number: placeholderNumber(), patientId: visit.patientId, visitId, createdBy: userId })
    .returning({ id: invoices.id });
  await insertLines(tx, clinicId, row.id, lines, 0);
  await recomputeTotals(tx, row.id, "0");
  await assignNumber(tx, clinicId, row.id);
  return { id: row.id, patientId: visit.patientId, created: true };
}

/** A blank draft for a patient (no visit), e.g. a certificate or a counter sale. */
export async function createInvoice(tx: Tx, clinicId: string, patientId: string, userId: string) {
  const [patient] = await tx.select({ id: patients.id }).from(patients).where(eq(patients.id, patientId)).limit(1);
  if (!patient) throw new AppError("Patient not found.");
  const [row] = await tx
    .insert(invoices)
    .values({ clinicId, number: placeholderNumber(), patientId, createdBy: userId })
    .returning({ id: invoices.id });
  await assignNumber(tx, clinicId, row.id);
  return { id: row.id, patientId };
}

export async function addInvoiceItem(
  tx: Tx,
  clinicId: string,
  invoiceId: string,
  input: { kind: ItemKind; description: string; quantity: number; unitPrice: string; serviceId?: string | null },
) {
  const invoice = await lockDraft(tx, invoiceId);
  const count = await tx.select({ id: invoiceItems.id }).from(invoiceItems).where(eq(invoiceItems.invoiceId, invoiceId));
  let line: NewLine = { kind: input.kind, description: input.description, quantity: input.quantity, unitPrice: input.unitPrice };
  if (input.serviceId) {
    const [service] = await tx.select().from(services).where(eq(services.id, input.serviceId)).limit(1);
    if (!service) throw new AppError("Service not found.");
    line = { kind: "service", description: service.name, quantity: input.quantity, unitPrice: service.price, sourceType: "service", sourceId: service.id };
  }
  await insertLines(tx, clinicId, invoiceId, [line], count.length);
  await recomputeTotals(tx, invoiceId, invoice.discount);
  return { patientId: invoice.patientId, description: line.description };
}

export async function removeInvoiceItem(tx: Tx, itemId: string) {
  const [item] = await tx.select().from(invoiceItems).where(eq(invoiceItems.id, itemId)).limit(1);
  if (!item) throw new AppError("Line not found.");
  const invoice = await lockDraft(tx, item.invoiceId);
  await tx.delete(invoiceItems).where(eq(invoiceItems.id, itemId));
  await recomputeTotals(tx, item.invoiceId, invoice.discount);
  return { invoiceId: item.invoiceId, patientId: invoice.patientId };
}

export async function setDiscount(tx: Tx, invoiceId: string, discount: string, reason: string | undefined) {
  const invoice = await lockDraft(tx, invoiceId);
  if (toMinor(discount) > 0 && !reason) throw new AppError("Give a reason for the discount.");
  await tx.update(invoices).set({ discountReason: toMinor(discount) > 0 ? reason : null }).where(eq(invoices.id, invoiceId));
  await recomputeTotals(tx, invoiceId, fromMinor(toMinor(discount)));
  return { patientId: invoice.patientId };
}

export async function issueInvoice(tx: Tx, invoiceId: string, userId: string) {
  const invoice = await lockDraft(tx, invoiceId);
  const lines = await tx.select({ id: invoiceItems.id }).from(invoiceItems).where(eq(invoiceItems.invoiceId, invoiceId));
  if (lines.length === 0) throw new AppError("Add at least one line before issuing.");
  await tx.update(invoices).set({ status: "issued", issuedAt: new Date(), issuedBy: userId, updatedAt: new Date() }).where(eq(invoices.id, invoiceId));
  return { patientId: invoice.patientId, number: invoice.number };
}

export async function discardDraft(tx: Tx, invoiceId: string) {
  const invoice = await lockDraft(tx, invoiceId);
  await tx.delete(invoices).where(eq(invoices.id, invoiceId));
  return { patientId: invoice.patientId, number: invoice.number };
}

export async function voidInvoice(tx: Tx, invoiceId: string, reason: string, userId: string) {
  const invoice = await lockInvoice(tx, invoiceId);
  if (invoice.status !== "issued") throw new AppError("Only an issued invoice can be voided. Discard a draft instead.");
  if (toMinor(invoice.amountPaid) > 0) throw new AppError("Refund what was paid before voiding this invoice.");
  await tx
    .update(invoices)
    .set({ status: "void", voidedAt: new Date(), voidedBy: userId, voidReason: reason, updatedAt: new Date() })
    .where(eq(invoices.id, invoiceId));
  return { patientId: invoice.patientId, number: invoice.number };
}

// ---------------------------------------------------------------------------
// Money in and out
// ---------------------------------------------------------------------------

export type MoneyInput = {
  invoiceId: string;
  amount: string;
  method: PaymentMethod;
  reference?: string;
  reason?: string;
  idempotencyKey: string;
};

type MoneyResult = { paymentId: string; patientId: string; duplicate: boolean; number: string };

async function existingByKey(tx: Tx, key: string) {
  const [row] = await tx.select().from(payments).where(eq(payments.idempotencyKey, key)).limit(1);
  return row ?? null;
}

function sameRequest(row: typeof payments.$inferSelect, kind: "payment" | "refund", input: MoneyInput) {
  return row.kind === kind && row.invoiceId === input.invoiceId && toMinor(row.amount) === toMinor(input.amount);
}

async function recordMoney(tx: Tx, clinicId: string, kind: "payment" | "refund", input: MoneyInput, userId: string): Promise<MoneyResult> {
  // Lock first, then look for the key: a concurrent double-submit waits here
  // and then finds the first request's payment.
  const invoice = await lockInvoice(tx, input.invoiceId);
  const previous = await existingByKey(tx, input.idempotencyKey);
  if (previous) {
    if (!sameRequest(previous, kind, input)) throw new AppError("This form was already used for a different entry. Reload the page and try again.");
    return { paymentId: previous.id, patientId: previous.patientId, duplicate: true, number: invoice.number };
  }

  const amount = toMinor(input.amount);
  if (amount <= 0) throw new AppError("Enter an amount above zero.");
  if (invoice.status === "void") throw new AppError("This invoice is void.");

  if (kind === "payment") {
    if (invoice.status === "draft") {
      // Taking money issues the invoice: its lines are final from now on.
      const lines = await tx.select({ id: invoiceItems.id }).from(invoiceItems).where(eq(invoiceItems.invoiceId, invoice.id));
      if (lines.length === 0) throw new AppError("Add at least one line before taking a payment.");
      await tx.update(invoices).set({ status: "issued", issuedAt: new Date(), issuedBy: userId }).where(eq(invoices.id, invoice.id));
    }
    const balance = toMinor(invoice.total) - toMinor(invoice.amountPaid);
    if (amount > balance) throw new AppError(`That is more than the balance of ${fromMinor(balance)}.`);
  } else {
    if (invoice.status !== "issued") throw new AppError("Nothing has been paid on this invoice.");
    if (amount > toMinor(invoice.amountPaid)) throw new AppError(`At most ${invoice.amountPaid} can be refunded.`);
  }

  let inserted;
  try {
    [inserted] = await tx
      .insert(payments)
      .values({
        clinicId,
        invoiceId: invoice.id,
        patientId: invoice.patientId,
        kind,
        amount: fromMinor(amount),
        method: input.method,
        reference: input.reference ?? null,
        reason: input.reason ?? null,
        idempotencyKey: input.idempotencyKey,
        receivedBy: userId,
      })
      .returning({ id: payments.id });
  } catch (error) {
    if (isUniqueViolation(error, "payments_idempotency_idx")) {
      throw new AppError("This form was already used for a different entry. Reload the page and try again.");
    }
    throw error;
  }

  const paid = toMinor(invoice.amountPaid) + (kind === "payment" ? amount : -amount);
  await tx.update(invoices).set({ amountPaid: fromMinor(paid), updatedAt: new Date() }).where(eq(invoices.id, invoice.id));
  return { paymentId: inserted.id, patientId: invoice.patientId, duplicate: false, number: invoice.number };
}

export function recordPayment(tx: Tx, clinicId: string, input: MoneyInput, userId: string) {
  return recordMoney(tx, clinicId, "payment", input, userId);
}

export function recordRefund(tx: Tx, clinicId: string, input: MoneyInput, userId: string) {
  if (!input.reason) throw new AppError("Give a reason for the refund.");
  return recordMoney(tx, clinicId, "refund", input, userId);
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export async function getInvoice(tx: Tx, id: string) {
  const [row] = await tx
    .select({ invoice: invoices, patient: patients })
    .from(invoices)
    .innerJoin(patients, eq(patients.id, invoices.patientId))
    .where(eq(invoices.id, id))
    .limit(1);
  if (!row) return null;
  const items = await tx.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, id)).orderBy(asc(invoiceItems.sortOrder), asc(invoiceItems.createdAt));
  const money = await tx
    .select({ payment: payments, title: users.title, firstName: users.firstName, lastName: users.lastName })
    .from(payments)
    .innerJoin(users, eq(users.id, payments.receivedBy))
    .where(eq(payments.invoiceId, id))
    .orderBy(asc(payments.receivedAt));
  return {
    ...row.invoice,
    patient: { id: row.patient.id, name: displayPatientName(row.patient), mrn: row.patient.mrn, mobile: row.patient.mobile },
    items,
    payments: money.map((m) => ({ ...m.payment, receivedByName: staffName(m) })),
    balance: balanceOf(row.invoice.total, row.invoice.amountPaid),
    paymentState: paymentState(row.invoice.total, row.invoice.amountPaid),
  };
}

export type InvoiceListItem = {
  id: string;
  number: string;
  status: string;
  patientId: string;
  patientName: string;
  patientMrn: string;
  total: string;
  amountPaid: string;
  balance: string;
  paymentState: ReturnType<typeof paymentState>;
  createdAt: Date;
};

export type InvoiceFilter = "outstanding" | "drafts" | "today" | "all";

export async function listInvoices(tx: Tx, filter: InvoiceFilter, dayStart: Date, dayEnd: Date, patientId?: string): Promise<InvoiceListItem[]> {
  const conditions = [patientId ? eq(invoices.patientId, patientId) : undefined];
  if (filter === "outstanding") conditions.push(eq(invoices.status, "issued"), sql`${invoices.amountPaid} < ${invoices.total}`);
  if (filter === "drafts") conditions.push(eq(invoices.status, "draft"));
  if (filter === "today") conditions.push(gte(invoices.createdAt, dayStart), lt(invoices.createdAt, dayEnd));
  const rows = await tx
    .select({ invoice: invoices, patient: patients })
    .from(invoices)
    .innerJoin(patients, eq(patients.id, invoices.patientId))
    .where(and(...conditions))
    .orderBy(desc(invoices.createdAt))
    .limit(200);
  return rows.map((r) => ({
    id: r.invoice.id,
    number: r.invoice.number,
    status: r.invoice.status,
    patientId: r.patient.id,
    patientName: displayPatientName(r.patient),
    patientMrn: r.patient.mrn,
    total: r.invoice.total,
    amountPaid: r.invoice.amountPaid,
    balance: balanceOf(r.invoice.total, r.invoice.amountPaid),
    paymentState: paymentState(r.invoice.total, r.invoice.amountPaid),
    createdAt: r.invoice.createdAt,
  }));
}

/** What issued invoices still owe, in total and for how many invoices. */
export async function outstandingSummary(tx: Tx, patientId?: string) {
  const [row] = await tx
    .select({
      amount: sql<string>`coalesce(sum(${invoices.total} - ${invoices.amountPaid}), 0)::numeric(12,2)::text`,
      count: sql<number>`count(*) filter (where ${invoices.amountPaid} < ${invoices.total})::int`,
    })
    .from(invoices)
    .where(and(eq(invoices.status, "issued"), patientId ? eq(invoices.patientId, patientId) : undefined));
  return { amount: row?.amount ?? "0.00", count: row?.count ?? 0 };
}

/** Money received in a period, net of refunds, per method. */
export async function collections(tx: Tx, from: Date, to: Date) {
  const rows = await tx
    .select({
      method: payments.method,
      net: sql<string>`sum(case when ${payments.kind} = 'payment' then ${payments.amount} else -${payments.amount} end)::numeric(12,2)::text`,
    })
    .from(payments)
    .where(and(gte(payments.receivedAt, from), lt(payments.receivedAt, to)))
    .groupBy(payments.method);
  const byMethod = Object.fromEntries(rows.map((r) => [r.method, r.net])) as Partial<Record<PaymentMethod, string>>;
  const total = fromMinor(rows.reduce((sum, r) => sum + toMinor(r.net), 0));
  return { total, byMethod };
}

export type VisitToBill = { visitId: string; patientId: string; patientName: string; patientMrn: string; serviceName: string | null; completedAt: Date | null };

/** Today's finished visits that do not have an invoice yet. */
export async function visitsToBill(tx: Tx, today: string): Promise<VisitToBill[]> {
  const rows = await tx
    .select({ visit: visits, patient: patients, serviceName: services.name })
    .from(visits)
    .innerJoin(patients, eq(patients.id, visits.patientId))
    .leftJoin(services, eq(services.id, visits.serviceId))
    .where(
      and(
        eq(visits.visitDate, today),
        inArray(visits.status, ["completed"]),
        sql`not exists (select 1 from ${invoices} where ${invoices.visitId} = ${visits.id} and ${invoices.status} <> 'void')`,
      ),
    )
    .orderBy(asc(visits.completedAt));
  return rows.map((r) => ({
    visitId: r.visit.id,
    patientId: r.patient.id,
    patientName: displayPatientName(r.patient),
    patientMrn: r.patient.mrn,
    serviceName: r.serviceName,
    completedAt: r.visit.completedAt,
  }));
}
