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
import { encryptedText } from "./_encrypted";
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
    /** Printed MRP of one pack of this batch: nothing from it sells above this. */
    mrp: numeric("mrp", { precision: 12, scale: 2 }),
    /** Units in the pack the MRP and pack cost are for. */
    packSize: integer("pack_size"),
    /** What a pack cost, as the old software or supplier stated it; keeps stock value exact. */
    packCost: numeric("pack_cost", { precision: 12, scale: 2 }),
    createdAt: createdAt(),
  },
  (t) => [
    unique("stock_batches_clinic_id_id_key").on(t.clinicId, t.id),
    uniqueIndex("stock_batches_drug_batch_idx").on(t.clinicId, t.drugId, t.batchNo, t.expiryDate),
    foreignKey({ name: "stock_batches_drug_fk", columns: [t.clinicId, t.drugId], foreignColumns: [drugs.clinicId, drugs.id] }),
    index("stock_batches_expiry_idx").on(t.clinicId, t.expiryDate),
    check("stock_batches_quantity_check", sql`${t.quantity} >= 0`),
    check("stock_batches_mrp_check", sql`${t.mrp} IS NULL OR ${t.mrp} >= 0`),
    check("stock_batches_pack_check", sql`${t.packSize} IS NULL OR ${t.packSize} >= 1`),
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
    check("stock_movements_reason_check", sql`${t.reason} IN ('opening', 'receipt', 'sale', 'dispense', 'adjustment', 'expired', 'damaged', 'return', 'supplier_return')`),
  ],
);

/**
 * A physical count of some or all of the shelves. The count screen and sheet
 * never show the system figure; each line records it, unseen, at the moment
 * the count was saved, so a sale after that cannot look like a shortage.
 */
export const stockCounts = appSchema.table(
  "stock_counts",
  {
    id: id(),
    clinicId: clinicId().references(() => clinics.id, { onDelete: "restrict" }),
    /** SC-000001 */
    number: varchar("number", { length: 20 }).notNull(),
    scope: varchar("scope", { length: 10 }).notNull(),
    scopeLabel: varchar("scope_label", { length: 120 }).notNull(),
    status: varchar("status", { length: 10 }).notNull().default("counting"),
    createdBy: uuid("created_by").notNull(),
    createdAt: createdAt(),
    submittedBy: uuid("submitted_by"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    postedBy: uuid("posted_by"),
    postedAt: timestamp("posted_at", { withTimezone: true }),
  },
  (t) => [
    unique("stock_counts_clinic_id_id_key").on(t.clinicId, t.id),
    uniqueIndex("stock_counts_number_idx").on(t.clinicId, t.number),
    index("stock_counts_created_idx").on(t.clinicId, t.createdAt),
    // One open count at a time: two would each correct the same batch.
    uniqueIndex("stock_counts_one_open_idx").on(t.clinicId).where(sql`status IN ('counting', 'review')`),
    check("stock_counts_scope_check", sql`${t.scope} IN ('all', 'rack', 'cycle')`),
    check("stock_counts_status_check", sql`${t.status} IN ('counting', 'review', 'posted', 'cancelled')`),
  ],
);

export const stockCountLines = appSchema.table(
  "stock_count_lines",
  {
    id: id(),
    clinicId: clinicId(),
    countId: uuid("count_id").notNull(),
    drugId: uuid("drug_id").notNull(),
    batchId: uuid("batch_id").notNull(),
    /** A batch on the shelf that the count did not list. */
    found: boolean("found").notNull().default(false),
    firstCount: integer("first_count"),
    /** The ledger when the first count was saved. */
    firstSystem: integer("first_system"),
    firstBy: uuid("first_by"),
    firstAt: timestamp("first_at", { withTimezone: true }),
    recount: integer("recount"),
    /** The ledger when the recount was saved. */
    recountSystem: integer("recount_system"),
    recountBy: uuid("recount_by"),
    recountAt: timestamp("recount_at", { withTimezone: true }),
    reason: varchar("reason", { length: 20 }),
    note: varchar("note", { length: 300 }),
    /** What posting moved, for the record. */
    postedChange: integer("posted_change"),
  },
  (t) => [
    unique("stock_count_lines_batch_key").on(t.countId, t.batchId),
    foreignKey({ name: "stock_count_lines_count_fk", columns: [t.clinicId, t.countId], foreignColumns: [stockCounts.clinicId, stockCounts.id] }),
    foreignKey({ name: "stock_count_lines_batch_fk", columns: [t.clinicId, t.batchId], foreignColumns: [stockBatches.clinicId, stockBatches.id] }),
    index("stock_count_lines_drug_idx").on(t.clinicId, t.drugId),
    check("stock_count_lines_quantity_check", sql`(${t.firstCount} IS NULL OR ${t.firstCount} >= 0) AND (${t.recount} IS NULL OR ${t.recount} >= 0)`),
    check("stock_count_lines_snapshot_check", sql`(${t.firstCount} IS NULL) = (${t.firstSystem} IS NULL) AND (${t.recount} IS NULL) = (${t.recountSystem} IS NULL)`),
  ],
);

/** Named buyers: walk-ins on credit, nursing homes (B2B), patients. */
export const pharmacyCustomers = appSchema.table(
  "pharmacy_customers",
  {
    id: id(),
    clinicId: clinicId().references(() => clinics.id, { onDelete: "restrict" }),
    name: varchar("name", { length: 200 }).notNull(),
    phone: varchar("phone", { length: 20 }),
    address: varchar("address", { length: 300 }),
    /** A registered business buyer: its sales are B2B in GSTR-1. */
    gstin: varchar("gstin", { length: 15 }),
    stateCode: varchar("state_code", { length: 2 }),
    patientId: uuid("patient_id"),
    /** Most they may owe; empty means no limit. */
    creditLimit: numeric("credit_limit", { precision: 12, scale: 2 }),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    unique("pharmacy_customers_clinic_id_id_key").on(t.clinicId, t.id),
    foreignKey({ name: "pharmacy_customers_patient_fk", columns: [t.clinicId, t.patientId], foreignColumns: [patients.clinicId, patients.id] }),
    uniqueIndex("pharmacy_customers_patient_idx").on(t.clinicId, t.patientId),
    index("pharmacy_customers_name_idx").on(t.clinicId, t.name),
  ],
);

/**
 * A sale at the pharmacy counter, with or without a prescription: a tax
 * invoice (or bill of supply), paid in full or on a named customer's credit.
 * Sales from before GST setup have no fiscal year and no tax lines.
 */
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
    /** Named customer (credit sales, B2B buyers). */
    customerId: uuid("customer_id"),
    /** Snapshot of the buyer's GSTIN: a B2B invoice in GSTR-1. */
    customerGstin: varchar("customer_gstin", { length: 15 }),
    /** "2026-27"; null for sales made before GST setup. */
    fiscalYear: varchar("fiscal_year", { length: 7 }),
    /** tax_invoice, bill_of_supply (composition / unregistered), or legacy cash_memo. */
    documentType: varchar("document_type", { length: 20 }).notNull().default("cash_memo"),
    /** IGST instead of CGST + SGST (a B2B buyer in another state). */
    interState: boolean("inter_state").notNull().default(false),
    /** Bill discount (tax-inclusive) and the round-off added after it. */
    discount: numeric("discount", { precision: 12, scale: 2 }).notNull().default("0"),
    roundOff: numeric("round_off", { precision: 12, scale: 2 }).notNull().default("0"),
    taxTotal: numeric("tax_total", { precision: 12, scale: 2 }).notNull().default("0"),
    /** Schedule H/H1/X details: who prescribed, and where the patient lives. */
    prescriberName: varchar("prescriber_name", { length: 120 }),
    prescriberRegNo: varchar("prescriber_reg_no", { length: 60 }),
    patientAddress: varchar("patient_address", { length: 300 }),
    total: numeric("total", { precision: 12, scale: 2 }).notNull(),
    method: varchar("method", { length: 10 }).notNull(),
    reference: varchar("reference", { length: 100 }),
    /** Pharmacist's note when a prescription was filled differently. */
    dispenseNote: varchar("dispense_note", { length: 300 }),
    soldBy: uuid("sold_by").notNull(),
    soldAt: timestamp("sold_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("pharmacy_sales_clinic_id_id_key").on(t.clinicId, t.id),
    uniqueIndex("pharmacy_sales_number_idx").on(t.clinicId, t.number),
    foreignKey({ name: "pharmacy_sales_patient_fk", columns: [t.clinicId, t.patientId], foreignColumns: [patients.clinicId, patients.id] }),
    foreignKey({ name: "pharmacy_sales_rx_fk", columns: [t.clinicId, t.prescriptionId], foreignColumns: [prescriptions.clinicId, prescriptions.id] }),
    foreignKey({ name: "pharmacy_sales_customer_fk", columns: [t.clinicId, t.customerId], foreignColumns: [pharmacyCustomers.clinicId, pharmacyCustomers.id] }),
    index("pharmacy_sales_sold_idx").on(t.clinicId, t.soldAt),
    index("pharmacy_sales_customer_idx").on(t.clinicId, t.customerId),
    check("pharmacy_sales_method_check", sql`${t.method} IN ('cash', 'upi', 'card', 'other', 'credit', 'inpatient')`),
    check("pharmacy_sales_total_check", sql`${t.total} >= 0 AND ${t.discount} >= 0 AND ${t.taxTotal} >= 0 AND ${t.roundOff} > -1 AND ${t.roundOff} < 1`),
    check("pharmacy_sales_document_check", sql`${t.documentType} IN ('tax_invoice', 'bill_of_supply', 'cash_memo')`),
    check("pharmacy_sales_credit_check", sql`${t.method} <> 'credit' OR ${t.customerId} IS NOT NULL`),
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
    /** Units that left stock (always single units). */
    quantity: integer("quantity").notNull(),
    /** Sold loose ("unit") or by the pack ("pack": a strip). */
    soldAs: varchar("sold_as", { length: 10 }).notNull().default("unit"),
    packSize: integer("pack_size").notNull().default(1),
    /** Packs sold, for pack lines. */
    packs: integer("packs"),
    /** Price of what was sold: per unit, or per pack for pack lines. */
    unitPrice: numeric("unit_price", { precision: 12, scale: 2 }).notNull(),
    /** Gross: price x quantity (or packs), tax-inclusive, before the bill discount. */
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    /** This line's share of the bill discount. */
    discount: numeric("discount", { precision: 12, scale: 2 }).notNull().default("0"),
    /** What the line was sold for: amount - discount (tax-inclusive). */
    net: numeric("net", { precision: 12, scale: 2 }).generatedAlwaysAs(sql`amount - discount`),
    /** GST snapshot at the time of sale. Null taxable = sold before GST setup. */
    hsn: varchar("hsn", { length: 8 }),
    gstRate: numeric("gst_rate", { precision: 5, scale: 2 }).notNull().default("0"),
    taxable: numeric("taxable", { precision: 12, scale: 2 }),
    cgst: numeric("cgst", { precision: 12, scale: 2 }).notNull().default("0"),
    sgst: numeric("sgst", { precision: 12, scale: 2 }).notNull().default("0"),
    igst: numeric("igst", { precision: 12, scale: 2 }).notNull().default("0"),
    /** Drug schedule at the time of sale (H1/X lines form the register). */
    schedule: varchar("schedule", { length: 5 }).notNull().default("none"),
    /** Batch cost per unit when sold, for margin. */
    unitCost: numeric("unit_cost", { precision: 12, scale: 2 }),
    /**
     * The pharmacy's copy (docs/PHARMACY_DISPENSING.md). What was actually
     * given and how to take it; the doctor's signed prescription never changes.
     */
    dose: varchar("dose", { length: 60 }),
    frequency: varchar("frequency", { length: 40 }),
    durationDays: integer("duration_days"),
    instructions: varchar("instructions", { length: 300 }),
    /** none (counter sale), as_prescribed, changed, substituted or added. */
    lineChange: varchar("line_change", { length: 15 }).notNull().default("none"),
    /** What the doctor wrote for this line, when it was filled differently. */
    prescribedText: varchar("prescribed_text", { length: 400 }),
  },
  (t) => [
    foreignKey({ name: "sale_items_sale_fk", columns: [t.clinicId, t.saleId], foreignColumns: [pharmacySales.clinicId, pharmacySales.id] }),
    foreignKey({ name: "sale_items_batch_fk", columns: [t.clinicId, t.batchId], foreignColumns: [stockBatches.clinicId, stockBatches.id] }),
    index("sale_items_sale_idx").on(t.saleId),
    index("sale_items_rx_item_idx").on(t.prescriptionItemId),
    check("sale_items_discount_check", sql`${t.discount} >= 0 AND ${t.discount} <= ${t.amount}`),
    check(
      "sale_items_tax_check",
      sql`${t.taxable} IS NULL OR (${t.taxable} >= 0 AND ${t.taxable} + ${t.cgst} + ${t.sgst} + ${t.igst} = ${t.amount} - ${t.discount})`,
    ),
    check("sale_items_quantity_check", sql`${t.quantity} > 0`),
    check("sale_items_line_change_check", sql`${t.lineChange} IN ('none', 'as_prescribed', 'changed', 'substituted', 'added')`),
    check(
      "sale_items_amount_check",
      sql`(${t.soldAs} = 'unit' AND ${t.packs} IS NULL AND ${t.amount} = ${t.unitPrice} * ${t.quantity})
        OR (${t.soldAs} = 'pack' AND ${t.packs} > 0 AND ${t.quantity} = ${t.packs} * ${t.packSize} AND ${t.amount} = ${t.unitPrice} * ${t.packs})`,
    ),
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
    message: encryptedText("prescription_queries", "message").notNull(),
    raisedBy: uuid("raised_by").notNull(),
    raisedAt: timestamp("raised_at", { withTimezone: true }).notNull().defaultNow(),
    response: encryptedText("prescription_queries", "response"),
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
 * A supplier's bill, entered line by line. Saving it adds every line to stock
 * through the ledger, so the bill and its lines are a permanent record
 * (append-only, db/sql/security.sql); mistakes are corrected with a stock
 * adjustment. One bill number per supplier.
 */
export const purchaseBills = appSchema.table(
  "purchase_bills",
  {
    id: id(),
    clinicId: clinicId().references(() => clinics.id, { onDelete: "restrict" }),
    /** Our reference, PB-000001. */
    number: varchar("number", { length: 30 }).notNull(),
    supplierId: uuid("supplier_id").notNull(),
    /** The supplier's invoice number, as printed (stored upper case). */
    billNo: varchar("bill_no", { length: 60 }).notNull(),
    billDate: date("bill_date").notNull(),
    subtotal: numeric("subtotal", { precision: 12, scale: 2 }).notNull(),
    taxTotal: numeric("tax_total", { precision: 12, scale: 2 }).notNull(),
    total: numeric("total", { precision: 12, scale: 2 }).notNull(),
    notes: varchar("notes", { length: 500 }),
    enteredBy: uuid("entered_by").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("purchase_bills_clinic_id_id_key").on(t.clinicId, t.id),
    uniqueIndex("purchase_bills_number_idx").on(t.clinicId, t.number),
    uniqueIndex("purchase_bills_supplier_bill_idx").on(t.clinicId, t.supplierId, t.billNo),
    foreignKey({ name: "purchase_bills_supplier_fk", columns: [t.clinicId, t.supplierId], foreignColumns: [suppliers.clinicId, suppliers.id] }),
    index("purchase_bills_date_idx").on(t.clinicId, t.billDate),
    check("purchase_bills_total_check", sql`${t.total} = ${t.subtotal} + ${t.taxTotal} AND ${t.subtotal} >= 0 AND ${t.taxTotal} >= 0`),
  ],
);

export const purchaseBillItems = appSchema.table(
  "purchase_bill_items",
  {
    id: id(),
    clinicId: clinicId(),
    billId: uuid("bill_id").notNull(),
    drugId: uuid("drug_id").notNull(),
    batchId: uuid("batch_id").notNull(),
    /** The item's name as printed on the bill. */
    description: varchar("description", { length: 200 }).notNull(),
    batchNo: varchar("batch_no", { length: 60 }).notNull(),
    expiryDate: date("expiry_date").notNull(),
    /** Packs paid for, packs free, units per pack. */
    quantity: integer("quantity").notNull(),
    freeQuantity: integer("free_quantity").notNull().default(0),
    packSize: integer("pack_size").notNull(),
    /** Per pack, before tax. */
    rate: numeric("rate", { precision: 12, scale: 2 }).notNull(),
    mrp: numeric("mrp", { precision: 12, scale: 2 }),
    gstRate: numeric("gst_rate", { precision: 5, scale: 2 }).notNull().default("0"),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    taxAmount: numeric("tax_amount", { precision: 12, scale: 2 }).notNull(),
    /** Units that went into stock: (quantity + free) x pack size. */
    units: integer("units").notNull(),
  },
  (t) => [
    foreignKey({ name: "bill_items_bill_fk", columns: [t.clinicId, t.billId], foreignColumns: [purchaseBills.clinicId, purchaseBills.id] }),
    foreignKey({ name: "bill_items_drug_fk", columns: [t.clinicId, t.drugId], foreignColumns: [drugs.clinicId, drugs.id] }),
    foreignKey({ name: "bill_items_batch_fk", columns: [t.clinicId, t.batchId], foreignColumns: [stockBatches.clinicId, stockBatches.id] }),
    index("bill_items_bill_idx").on(t.billId),
    index("bill_items_drug_idx").on(t.clinicId, t.drugId),
    check("bill_items_quantity_check", sql`${t.quantity} > 0 AND ${t.freeQuantity} >= 0 AND ${t.packSize} > 0`),
    check("bill_items_units_check", sql`${t.units} = (${t.quantity} + ${t.freeQuantity}) * ${t.packSize}`),
    check("bill_items_amount_check", sql`${t.amount} = ${t.rate} * ${t.quantity} AND ${t.taxAmount} >= 0`),
    check("bill_items_gst_check", sql`${t.gstRate} >= 0 AND ${t.gstRate} <= 100`),
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

