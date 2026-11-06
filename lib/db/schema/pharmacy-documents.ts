// Pharmacy documents beyond the sale itself (docs/PHARMACY_DESIGN.md):
// settings, named customers, credit notes (sales returns and cancellations),
// debit notes (purchase returns), customer receipts and supplier payments.
//
// Every document is append-only (db/sql/security.sql). A mistake is undone
// by another document that points at the first, never by editing it.
import { boolean, check, date, foreignKey, index, integer, numeric, unique, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { appSchema, clinicId, createdAt, id, updatedAt } from "./_shared";
import { clinics } from "./platform";
import { drugs } from "./catalog";
import { pharmacyCustomers, pharmacySales, purchaseBills, stockBatches, suppliers } from "./pharmacy";

const money = (name: string) => numeric(name, { precision: 12, scale: 2 });

/** One row per clinic; edited by the Clinic Admin. */
export const pharmacySettings = appSchema.table(
  "pharmacy_settings",
  {
    clinicId: uuid("clinic_id")
      .primaryKey()
      .references(() => clinics.id, { onDelete: "restrict" }),
    /** The pharmacy's GSTIN (15 characters); empty when unregistered. */
    gstin: varchar("gstin", { length: 15 }),
    /** GST state code, e.g. "33" for Tamil Nadu; decides CGST+SGST vs IGST. */
    stateCode: varchar("state_code", { length: 2 }),
    /** regular: tax invoice; composition / unregistered: bill of supply, no GST charged. */
    gstScheme: varchar("gst_scheme", { length: 15 }).notNull().default("regular"),
    drugLicence20b: varchar("drug_licence_20b", { length: 60 }),
    drugLicence21b: varchar("drug_licence_21b", { length: 60 }),
    roundOff: boolean("round_off").notNull().default(true),
    /** Largest bill discount the counter may give without a Clinic Admin. */
    maxDiscountPercent: numeric("max_discount_percent", { precision: 5, scale: 2 }).notNull().default("10"),
    /** For medicines without their own: HSN 3004, GST 5 % (rates since Sept 2025). */
    defaultHsn: varchar("default_hsn", { length: 8 }).notNull().default("3004"),
    defaultGstRate: numeric("default_gst_rate", { precision: 5, scale: 2 }).notNull().default("5"),
    reorderLeadDays: integer("reorder_lead_days").notNull().default(7),
    reorderCoverDays: integer("reorder_cover_days").notNull().default(15),
    updatedBy: uuid("updated_by"),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("pharmacy_settings_scheme_check", sql`${t.gstScheme} IN ('regular', 'composition', 'unregistered')`),
    check("pharmacy_settings_discount_check", sql`${t.maxDiscountPercent} BETWEEN 0 AND 100`),
    check("pharmacy_settings_gst_check", sql`${t.defaultGstRate} BETWEEN 0 AND 40`),
    check("pharmacy_settings_reorder_check", sql`${t.reorderLeadDays} BETWEEN 0 AND 120 AND ${t.reorderCoverDays} BETWEEN 1 AND 180`),
  ],
);

/** Credit note: goods returned, or a whole sale cancelled. */
export const saleReturns = appSchema.table(
  "sale_returns",
  {
    id: id(),
    clinicId: clinicId(),
    /** CN/2627/000001 */
    number: varchar("number", { length: 30 }).notNull(),
    fiscalYear: varchar("fiscal_year", { length: 7 }).notNull(),
    /** The NuvaLyf sale; empty when the bill was issued by the old software. */
    saleId: uuid("sale_id"),
    /** The old software's bill this note is against. */
    oldBillNo: varchar("old_bill_no", { length: 60 }),
    oldBillDate: date("old_bill_date"),
    /** The buyer of an old bill (a sale carries its own). */
    customerId: uuid("customer_id"),
    customerName: varchar("customer_name", { length: 200 }),
    customerGstin: varchar("customer_gstin", { length: 15 }),
    kind: varchar("kind", { length: 15 }).notNull(),
    reason: varchar("reason", { length: 300 }).notNull(),
    /** How the money went back: the sale's method, or the customer's account. */
    refundMethod: varchar("refund_method", { length: 10 }).notNull(),
    /** Refund including any round-off given back on a cancellation. */
    total: money("total").notNull(),
    roundOff: money("round_off").notNull().default("0"),
    taxTotal: money("tax_total").notNull(),
    createdBy: uuid("created_by").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("sale_returns_clinic_id_id_key").on(t.clinicId, t.id),
    uniqueIndex("sale_returns_number_idx").on(t.clinicId, t.number),
    foreignKey({ name: "sale_returns_sale_fk", columns: [t.clinicId, t.saleId], foreignColumns: [pharmacySales.clinicId, pharmacySales.id] }),
    foreignKey({ name: "sale_returns_customer_fk", columns: [t.clinicId, t.customerId], foreignColumns: [pharmacyCustomers.clinicId, pharmacyCustomers.id] }),
    index("sale_returns_sale_idx").on(t.saleId),
    index("sale_returns_old_bill_idx").on(t.clinicId, t.oldBillNo),
    check("sale_returns_source_check", sql`(${t.saleId} IS NULL) <> (${t.oldBillNo} IS NULL)`),
    index("sale_returns_created_idx").on(t.clinicId, t.createdAt),
    check("sale_returns_kind_check", sql`${t.kind} IN ('return', 'cancellation')`),
    check("sale_returns_method_check", sql`${t.refundMethod} IN ('cash', 'upi', 'card', 'other', 'account', 'inpatient')`),
    check("sale_returns_total_check", sql`${t.total} >= 0 AND ${t.taxTotal} >= 0`),
  ],
);

export const saleReturnItems = appSchema.table(
  "sale_return_items",
  {
    id: id(),
    clinicId: clinicId(),
    returnId: uuid("return_id").notNull(),
    /** Empty on an old bill: the columns below keep what the sale line would. */
    saleItemId: uuid("sale_item_id"),
    drugId: uuid("drug_id").notNull(),
    batchId: uuid("batch_id").notNull(),
    /** Units back into the batch. */
    quantity: integer("quantity").notNull(),
    /** Tax-inclusive refund for these units, and the tax reversed in it. */
    net: money("net").notNull(),
    taxable: money("taxable").notNull(),
    cgst: money("cgst").notNull().default("0"),
    sgst: money("sgst").notNull().default("0"),
    igst: money("igst").notNull().default("0"),
    description: varchar("description", { length: 300 }),
    hsn: varchar("hsn", { length: 8 }),
    gstRate: numeric("gst_rate", { precision: 5, scale: 2 }),
    unitCost: money("unit_cost"),
  },
  (t) => [
    foreignKey({ name: "sale_return_items_return_fk", columns: [t.clinicId, t.returnId], foreignColumns: [saleReturns.clinicId, saleReturns.id] }),
    foreignKey({ name: "sale_return_items_batch_fk", columns: [t.clinicId, t.batchId], foreignColumns: [stockBatches.clinicId, stockBatches.id] }),
    index("sale_return_items_return_idx").on(t.returnId),
    index("sale_return_items_sale_item_idx").on(t.saleItemId),
    check("sale_return_items_quantity_check", sql`${t.quantity} > 0`),
    check("sale_return_items_source_check", sql`${t.saleItemId} IS NOT NULL OR ${t.gstRate} IS NOT NULL`),
    check("sale_return_items_tax_check", sql`${t.net} = ${t.taxable} + ${t.cgst} + ${t.sgst} + ${t.igst}`),
  ],
);

/**
 * What a customer owed, or the pharmacy owed a supplier, when it moved to
 * NuvaLyf. Balances are still added up from documents: this is that first
 * document. Append-only; a correction is another row with a reason.
 */
export const accountOpenings = appSchema.table(
  "account_openings",
  {
    id: id(),
    clinicId: clinicId(),
    customerId: uuid("customer_id"),
    supplierId: uuid("supplier_id"),
    /** Positive: they owe (customer) or are owed (supplier). Negative: a correction. */
    amount: money("amount").notNull(),
    asOf: date("as_of").notNull(),
    reference: varchar("reference", { length: 100 }),
    note: varchar("note", { length: 300 }),
    createdBy: uuid("created_by").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({ name: "account_openings_customer_fk", columns: [t.clinicId, t.customerId], foreignColumns: [pharmacyCustomers.clinicId, pharmacyCustomers.id] }),
    foreignKey({ name: "account_openings_supplier_fk", columns: [t.clinicId, t.supplierId], foreignColumns: [suppliers.clinicId, suppliers.id] }),
    index("account_openings_customer_idx").on(t.customerId),
    index("account_openings_supplier_idx").on(t.supplierId),
    check("account_openings_party_check", sql`(${t.customerId} IS NULL) <> (${t.supplierId} IS NULL)`),
    check("account_openings_amount_check", sql`${t.amount} <> 0`),
  ],
);

/** Debit note: stock sent back to a supplier (often expired or damaged). */
export const purchaseReturns = appSchema.table(
  "purchase_returns",
  {
    id: id(),
    clinicId: clinicId(),
    /** DN/2627/000001 */
    number: varchar("number", { length: 30 }).notNull(),
    fiscalYear: varchar("fiscal_year", { length: 7 }).notNull(),
    supplierId: uuid("supplier_id").notNull(),
    billId: uuid("bill_id"),
    reason: varchar("reason", { length: 300 }).notNull(),
    taxable: money("taxable").notNull(),
    taxTotal: money("tax_total").notNull(),
    total: money("total").notNull(),
    createdBy: uuid("created_by").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("purchase_returns_clinic_id_id_key").on(t.clinicId, t.id),
    uniqueIndex("purchase_returns_number_idx").on(t.clinicId, t.number),
    foreignKey({ name: "purchase_returns_supplier_fk", columns: [t.clinicId, t.supplierId], foreignColumns: [suppliers.clinicId, suppliers.id] }),
    foreignKey({ name: "purchase_returns_bill_fk", columns: [t.clinicId, t.billId], foreignColumns: [purchaseBills.clinicId, purchaseBills.id] }),
    index("purchase_returns_supplier_idx").on(t.clinicId, t.supplierId),
    check("purchase_returns_total_check", sql`${t.total} = ${t.taxable} + ${t.taxTotal} AND ${t.taxable} >= 0 AND ${t.taxTotal} >= 0`),
  ],
);

export const purchaseReturnItems = appSchema.table(
  "purchase_return_items",
  {
    id: id(),
    clinicId: clinicId(),
    returnId: uuid("return_id").notNull(),
    drugId: uuid("drug_id").notNull(),
    batchId: uuid("batch_id").notNull(),
    billItemId: uuid("bill_item_id"),
    quantity: integer("quantity").notNull(),
    unitCost: money("unit_cost").notNull(),
    gstRate: numeric("gst_rate", { precision: 5, scale: 2 }).notNull().default("0"),
    taxable: money("taxable").notNull(),
    tax: money("tax").notNull(),
  },
  (t) => [
    foreignKey({ name: "purchase_return_items_return_fk", columns: [t.clinicId, t.returnId], foreignColumns: [purchaseReturns.clinicId, purchaseReturns.id] }),
    foreignKey({ name: "purchase_return_items_batch_fk", columns: [t.clinicId, t.batchId], foreignColumns: [stockBatches.clinicId, stockBatches.id] }),
    foreignKey({ name: "purchase_return_items_drug_fk", columns: [t.clinicId, t.drugId], foreignColumns: [drugs.clinicId, drugs.id] }),
    index("purchase_return_items_return_idx").on(t.returnId),
    index("purchase_return_items_bill_item_idx").on(t.billItemId),
    check("purchase_return_items_quantity_check", sql`${t.quantity} > 0`),
    check("purchase_return_items_amount_check", sql`${t.taxable} = ${t.unitCost} * ${t.quantity} AND ${t.tax} >= 0`),
  ],
);

/** Money received against a customer's balance. */
export const customerReceipts = appSchema.table(
  "customer_receipts",
  {
    id: id(),
    clinicId: clinicId(),
    /** RC/2627/000001 */
    number: varchar("number", { length: 30 }).notNull(),
    customerId: uuid("customer_id").notNull(),
    amount: money("amount").notNull(),
    method: varchar("method", { length: 10 }).notNull(),
    reference: varchar("reference", { length: 100 }),
    note: varchar("note", { length: 300 }),
    receivedBy: uuid("received_by").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("customer_receipts_number_idx").on(t.clinicId, t.number),
    foreignKey({ name: "customer_receipts_customer_fk", columns: [t.clinicId, t.customerId], foreignColumns: [pharmacyCustomers.clinicId, pharmacyCustomers.id] }),
    index("customer_receipts_customer_idx").on(t.clinicId, t.customerId),
    check("customer_receipts_amount_check", sql`${t.amount} > 0`),
    check("customer_receipts_method_check", sql`${t.method} IN ('cash', 'upi', 'card', 'bank', 'cheque', 'other')`),
  ],
);

/** Money paid against a supplier's balance. */
export const supplierPayments = appSchema.table(
  "supplier_payments",
  {
    id: id(),
    clinicId: clinicId(),
    /** PY/2627/000001 */
    number: varchar("number", { length: 30 }).notNull(),
    supplierId: uuid("supplier_id").notNull(),
    amount: money("amount").notNull(),
    method: varchar("method", { length: 10 }).notNull(),
    reference: varchar("reference", { length: 100 }),
    note: varchar("note", { length: 300 }),
    paidBy: uuid("paid_by").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("supplier_payments_number_idx").on(t.clinicId, t.number),
    foreignKey({ name: "supplier_payments_supplier_fk", columns: [t.clinicId, t.supplierId], foreignColumns: [suppliers.clinicId, suppliers.id] }),
    index("supplier_payments_supplier_idx").on(t.clinicId, t.supplierId),
    check("supplier_payments_amount_check", sql`${t.amount} > 0`),
    check("supplier_payments_method_check", sql`${t.method} IN ('cash', 'upi', 'card', 'bank', 'cheque', 'other')`),
  ],
);
