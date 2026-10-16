// Billing: invoices and recorded payments (decision D7: payments are recorded,
// not processed - no gateway). Amounts are NUMERIC and travel as strings.
//
// Database guards (db/sql/security.sql): an issued invoice's lines cannot
// change, payments are append-only (a refund is a new row), and a payment's
// idempotency key is unique per clinic so a double-submit records one payment.
import { check, foreignKey, index, integer, numeric, text, timestamp, unique, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { appSchema, clinicId, createdAt, id, updatedAt } from "./_shared";
import { clinics } from "./platform";
import { patients, visits } from "./frontdesk";

export const invoices = appSchema.table(
  "invoices",
  {
    id: id(),
    clinicId: clinicId().references(() => clinics.id, { onDelete: "restrict" }),
    /** Per-clinic number, e.g. INV-000123; assigned when the invoice is created. */
    number: varchar("number", { length: 30 }).notNull(),
    patientId: uuid("patient_id").notNull(),
    visitId: uuid("visit_id"),
    status: varchar("status", { length: 20 }).notNull().default("draft"),
    subtotal: numeric("subtotal", { precision: 12, scale: 2 }).notNull().default("0"),
    discount: numeric("discount", { precision: 12, scale: 2 }).notNull().default("0"),
    discountReason: varchar("discount_reason", { length: 300 }),
    total: numeric("total", { precision: 12, scale: 2 }).notNull().default("0"),
    /** Net of refunds; maintained with the payment in one transaction. */
    amountPaid: numeric("amount_paid", { precision: 12, scale: 2 }).notNull().default("0"),
    notes: text("notes"),
    issuedAt: timestamp("issued_at", { withTimezone: true }),
    issuedBy: uuid("issued_by"),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    voidedBy: uuid("voided_by"),
    voidReason: varchar("void_reason", { length: 300 }),
    createdBy: uuid("created_by").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("invoices_clinic_id_id_key").on(t.clinicId, t.id),
    uniqueIndex("invoices_clinic_number_idx").on(t.clinicId, t.number),
    // One live invoice per visit.
    uniqueIndex("invoices_visit_idx").on(t.visitId).where(sql`${t.visitId} IS NOT NULL AND ${t.status} <> 'void'`),
    foreignKey({ name: "invoices_patient_fk", columns: [t.clinicId, t.patientId], foreignColumns: [patients.clinicId, patients.id] }),
    foreignKey({ name: "invoices_visit_fk", columns: [t.clinicId, t.visitId], foreignColumns: [visits.clinicId, visits.id] }),
    index("invoices_patient_idx").on(t.clinicId, t.patientId),
    index("invoices_status_idx").on(t.clinicId, t.status, t.createdAt),
    check("invoices_status_check", sql`${t.status} IN ('draft', 'issued', 'void')`),
    check("invoices_amounts_check", sql`${t.subtotal} >= 0 AND ${t.discount} >= 0 AND ${t.total} >= 0 AND ${t.discount} <= ${t.subtotal}`),
    check("invoices_paid_check", sql`${t.amountPaid} >= 0 AND ${t.amountPaid} <= ${t.total}`),
  ],
);

export const invoiceItems = appSchema.table(
  "invoice_items",
  {
    id: id(),
    clinicId: clinicId(),
    invoiceId: uuid("invoice_id").notNull(),
    kind: varchar("kind", { length: 20 }).notNull(),
    description: varchar("description", { length: 300 }).notNull(),
    quantity: integer("quantity").notNull().default(1),
    unitPrice: numeric("unit_price", { precision: 12, scale: 2 }).notNull(),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    /** What the line was raised from, if anything (service, lab order, ...). */
    sourceType: varchar("source_type", { length: 30 }),
    sourceId: uuid("source_id"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({ name: "invoice_items_invoice_fk", columns: [t.clinicId, t.invoiceId], foreignColumns: [invoices.clinicId, invoices.id] }).onDelete("cascade"),
    index("invoice_items_invoice_idx").on(t.invoiceId),
    check("invoice_items_kind_check", sql`${t.kind} IN ('service', 'lab', 'medicine', 'other')`),
    check("invoice_items_quantity_check", sql`${t.quantity} > 0`),
    check("invoice_items_amount_check", sql`${t.unitPrice} >= 0 AND ${t.amount} = ${t.unitPrice} * ${t.quantity}`),
  ],
);

export const payments = appSchema.table(
  "payments",
  {
    id: id(),
    clinicId: clinicId(),
    invoiceId: uuid("invoice_id").notNull(),
    patientId: uuid("patient_id").notNull(),
    kind: varchar("kind", { length: 10 }).notNull().default("payment"),
    /** Always positive; a refund reduces what was paid. */
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    method: varchar("method", { length: 10 }).notNull(),
    reference: varchar("reference", { length: 100 }),
    reason: varchar("reason", { length: 300 }),
    /** Sent by the form; the same key twice returns the first payment. */
    idempotencyKey: varchar("idempotency_key", { length: 64 }).notNull(),
    receivedBy: uuid("received_by").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("payments_idempotency_idx").on(t.clinicId, t.idempotencyKey),
    foreignKey({ name: "payments_invoice_fk", columns: [t.clinicId, t.invoiceId], foreignColumns: [invoices.clinicId, invoices.id] }),
    index("payments_invoice_idx").on(t.invoiceId),
    index("payments_received_idx").on(t.clinicId, t.receivedAt),
    check("payments_kind_check", sql`${t.kind} IN ('payment', 'refund')`),
    check("payments_method_check", sql`${t.method} IN ('cash', 'upi', 'card', 'other')`),
    check("payments_amount_check", sql`${t.amount} > 0`),
    check("payments_refund_reason_check", sql`${t.kind} = 'payment' OR ${t.reason} IS NOT NULL`),
  ],
);
