// Pharmacy module: stock against the clinic's own medicine list, batches with
// expiry, an append-only movement ledger, sales (counter and prescription),
// clarification queries to prescribers, suppliers and purchase orders.
//
// Quantities are never edited directly: every change is a stock_movements
// row, and a trigger applies it to the batch (db/sql/security.sql). A batch
// can never go below zero.
import { boolean, check, date, foreignKey, index, integer, jsonb, numeric, primaryKey, text, timestamp, unique, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { appSchema, clinicId, createdAt, id, updatedAt } from "./_shared";
import { clinics } from "./platform";
import { drugs } from "./catalog";
import { patients } from "./frontdesk";
import { prescriptions } from "./clinical";

export const stockBatches = appSchema.table(
  "stock_batches",
  {
    id: id(),
    clinicId: clinicId().references(() => clinics.id, { onDelete: "restrict" }),
    drugId: uuid("drug_id").notNull(),
    batchNo: varchar("batch_no", { length: 60 }).notNull(),
    expiryDate: date("expiry_date").notNull(),
    /** Maintained by the ledger trigger only. */
    quantity: integer("quantity").notNull().default(0),
    unitCost: numeric("unit_cost", { precision: 12, scale: 2 }),
    createdAt: createdAt(),
  },
  (t) => [
    unique("stock_batches_clinic_id_id_key").on(t.clinicId, t.id),
    uniqueIndex("stock_batches_drug_batch_idx").on(t.clinicId, t.drugId, t.batchNo, t.expiryDate),
    foreignKey({ name: "stock_batches_drug_fk", columns: [t.clinicId, t.drugId], foreignColumns: [drugs.clinicId, drugs.id] }),
    index("stock_batches_expiry_idx").on(t.clinicId, t.expiryDate),
    check("stock_batches_quantity_check", sql`${t.quantity} >= 0`),
  ],
);

export const stockMovements = appSchema.table(
  "stock_movements",
  {
    id: id(),
    clinicId: clinicId(),
    drugId: uuid("drug_id").notNull(),
    batchId: uuid("batch_id").notNull(),
    /** Positive in, negative out. */
    change: integer("change").notNull(),
    reason: varchar("reason", { length: 20 }).notNull(),
    sourceType: varchar("source_type", { length: 30 }),
    sourceId: uuid("source_id"),
    note: varchar("note", { length: 300 }),
    actorId: uuid("actor_id").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({ name: "stock_movements_batch_fk", columns: [t.clinicId, t.batchId], foreignColumns: [stockBatches.clinicId, stockBatches.id] }),
    index("stock_movements_drug_idx").on(t.clinicId, t.drugId, t.createdAt),
    check("stock_movements_change_check", sql`${t.change} <> 0`),
    check("stock_movements_reason_check", sql`${t.reason} IN ('opening', 'receipt', 'sale', 'dispense', 'adjustment', 'expired', 'damaged', 'return')`),
  ],
);

/** A sale at the pharmacy counter, with or without a prescription. Paid in full. */
export const pharmacySales = appSchema.table(
  "pharmacy_sales",
  {
    id: id(),
    clinicId: clinicId().references(() => clinics.id, { onDelete: "restrict" }),
    number: varchar("number", { length: 30 }).notNull(),
    patientId: uuid("patient_id"),
    prescriptionId: uuid("prescription_id"),
    customerName: varchar("customer_name", { length: 200 }),
    customerPhone: varchar("customer_phone", { length: 20 }),
    total: numeric("total", { precision: 12, scale: 2 }).notNull(),
    method: varchar("method", { length: 10 }).notNull(),
    reference: varchar("reference", { length: 100 }),
    soldBy: uuid("sold_by").notNull(),
    soldAt: timestamp("sold_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("pharmacy_sales_clinic_id_id_key").on(t.clinicId, t.id),
    uniqueIndex("pharmacy_sales_number_idx").on(t.clinicId, t.number),
    foreignKey({ name: "pharmacy_sales_patient_fk", columns: [t.clinicId, t.patientId], foreignColumns: [patients.clinicId, patients.id] }),
    foreignKey({ name: "pharmacy_sales_rx_fk", columns: [t.clinicId, t.prescriptionId], foreignColumns: [prescriptions.clinicId, prescriptions.id] }),
    index("pharmacy_sales_sold_idx").on(t.clinicId, t.soldAt),
    check("pharmacy_sales_method_check", sql`${t.method} IN ('cash', 'upi', 'card', 'other')`),
    check("pharmacy_sales_total_check", sql`${t.total} >= 0`),
  ],
);

export const pharmacySaleItems = appSchema.table(
  "pharmacy_sale_items",
  {
    id: id(),
    clinicId: clinicId(),
    saleId: uuid("sale_id").notNull(),
    drugId: uuid("drug_id").notNull(),
    batchId: uuid("batch_id").notNull(),
    prescriptionItemId: uuid("prescription_item_id"),
    description: varchar("description", { length: 300 }).notNull(),
    batchNo: varchar("batch_no", { length: 60 }).notNull(),
    expiryDate: date("expiry_date").notNull(),
    quantity: integer("quantity").notNull(),
    unitPrice: numeric("unit_price", { precision: 12, scale: 2 }).notNull(),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  },
  (t) => [
    foreignKey({ name: "sale_items_sale_fk", columns: [t.clinicId, t.saleId], foreignColumns: [pharmacySales.clinicId, pharmacySales.id] }),
    foreignKey({ name: "sale_items_batch_fk", columns: [t.clinicId, t.batchId], foreignColumns: [stockBatches.clinicId, stockBatches.id] }),
    index("sale_items_sale_idx").on(t.saleId),
    index("sale_items_rx_item_idx").on(t.prescriptionItemId),
    check("sale_items_quantity_check", sql`${t.quantity} > 0`),
    check("sale_items_amount_check", sql`${t.amount} = ${t.unitPrice} * ${t.quantity}`),
  ],
);

/** The pharmacist asks the prescriber; the prescription itself is never edited. */
export const prescriptionQueries = appSchema.table(
  "prescription_queries",
  {
    id: id(),
    clinicId: clinicId(),
    prescriptionId: uuid("prescription_id").notNull(),
    prescriptionItemId: uuid("prescription_item_id"),
    /** Who must answer: the prescriber at the time. */
    addressedTo: uuid("addressed_to").notNull(),
    message: text("message").notNull(),
    raisedBy: uuid("raised_by").notNull(),
    raisedAt: timestamp("raised_at", { withTimezone: true }).notNull().defaultNow(),
    response: text("response"),
    answeredBy: uuid("answered_by"),
    answeredAt: timestamp("answered_at", { withTimezone: true }),
  },
  (t) => [
    foreignKey({ name: "rx_queries_rx_fk", columns: [t.clinicId, t.prescriptionId], foreignColumns: [prescriptions.clinicId, prescriptions.id] }),
    index("rx_queries_open_idx").on(t.clinicId, t.addressedTo, t.answeredAt),
  ],
);

export const suppliers = appSchema.table(
  "suppliers",
  {
    id: id(),
    clinicId: clinicId().references(() => clinics.id, { onDelete: "restrict" }),
    name: varchar("name", { length: 200 }).notNull(),
    contactName: varchar("contact_name", { length: 120 }),
    phone: varchar("phone", { length: 30 }),
    email: varchar("email", { length: 255 }),
    taxId: varchar("tax_id", { length: 40 }),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [unique("suppliers_clinic_id_id_key").on(t.clinicId, t.id)],
);

export const purchaseOrders = appSchema.table(
  "purchase_orders",
  {
    id: id(),
    clinicId: clinicId().references(() => clinics.id, { onDelete: "restrict" }),
    number: varchar("number", { length: 30 }).notNull(),
    supplierId: uuid("supplier_id").notNull(),
    status: varchar("status", { length: 20 }).notNull().default("draft"),
    notes: text("notes"),
    createdBy: uuid("created_by").notNull(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    decidedBy: uuid("decided_by"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionNote: varchar("decision_note", { length: 300 }),
    receivedBy: uuid("received_by"),
    receivedAt: timestamp("received_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("purchase_orders_clinic_id_id_key").on(t.clinicId, t.id),
    uniqueIndex("purchase_orders_number_idx").on(t.clinicId, t.number),
    foreignKey({ name: "purchase_orders_supplier_fk", columns: [t.clinicId, t.supplierId], foreignColumns: [suppliers.clinicId, suppliers.id] }),
    check("purchase_orders_status_check", sql`${t.status} IN ('draft', 'submitted', 'approved', 'rejected', 'received', 'cancelled')`),
  ],
);

export const purchaseOrderItems = appSchema.table(
  "purchase_order_items",
  {
    id: id(),
    clinicId: clinicId(),
    purchaseOrderId: uuid("purchase_order_id").notNull(),
    drugId: uuid("drug_id").notNull(),
    quantity: integer("quantity").notNull(),
    unitCost: numeric("unit_cost", { precision: 12, scale: 2 }),
    receivedQuantity: integer("received_quantity").notNull().default(0),
  },
  (t) => [
    foreignKey({ name: "po_items_po_fk", columns: [t.clinicId, t.purchaseOrderId], foreignColumns: [purchaseOrders.clinicId, purchaseOrders.id] }).onDelete("cascade"),
    foreignKey({ name: "po_items_drug_fk", columns: [t.clinicId, t.drugId], foreignColumns: [drugs.clinicId, drugs.id] }),
    uniqueIndex("po_items_drug_idx").on(t.purchaseOrderId, t.drugId),
    check("po_items_quantity_check", sql`${t.quantity} > 0 AND ${t.receivedQuantity} >= 0`),
  ],
);

/**
 * Idempotency for multi-step operations (sales, dispensing, receiving): the
 * first request with a key does the work and stores its result; a retry with
 * the same key gets that result back without repeating anything.
 */
export const idempotencyKeys = appSchema.table(
  "idempotency_keys",
  {
    clinicId: clinicId(),
    scope: varchar("scope", { length: 40 }).notNull(),
    key: varchar("key", { length: 64 }).notNull(),
    fingerprint: varchar("fingerprint", { length: 64 }).notNull(),
    result: jsonb("result"),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.clinicId, t.scope, t.key] })],
);

