"use server";

// Customers, receipts against their accounts, and supplier payments
// (docs/PHARMACY_DESIGN.md 4.4).
import { z } from "zod";
import { clinicAction } from "@/lib/auth/actions";
import { isValidDateString, todayInTimeZone } from "@/lib/time";
import { idField, optionalId, optionalMoney, optionalPhone, optionalText, requiredText } from "@/lib/validation";
import { MAX_IMPORT_BYTES } from "@/features/import/import-rules";
import { addOpening, checkBalanceImport, recordRejectedBalanceImport, runBalanceImport, type BalanceReport } from "./opening-balances.service";
import { GSTIN_PATTERN } from "./gst-rules";
import { getCustomer, listCustomers, recordReceipt, saveCustomer } from "./customers.service";
import { recordSupplierPayment } from "./supplier-accounts.service";

const amount = z.string({ message: "Enter the amount" }).trim().regex(/^\d{1,8}(\.\d{1,2})?$/, "Enter an amount like 500 or 500.50");
const accountMethod = z.enum(["cash", "upi", "card", "bank", "cheque", "other"]);
const idempotencyKey = z.string().trim().min(16, "Reload the page and try again.").max(64);

export const addOpeningAction = clinicAction(
  {
    name: "pharmacy.addOpening",
    permission: "accounts:manage",
    module: "pharmacy",
    schema: z.object({
      side: z.enum(["customer", "supplier"]),
      partyId: idField,
      amount: z.string({ message: "Enter the amount" }).trim().regex(/^-?\d{1,8}(\.\d{1,2})?$/, "Enter an amount like 1500 or -200.50"),
      asOf: z.string({ message: "Enter the date" }).refine(isValidDateString, "Enter the date"),
      reference: optionalText(100),
      note: optionalText(300),
    }),
  },
  async ({ session, db, audit }, input) =>
    db(async (tx) => {
      const row = await addOpening(tx, session.clinicId, input, session.userId, todayInTimeZone(session.timezone));
      await audit(tx, { action: "OPENING_BALANCE_ADDED", targetType: input.side === "customer" ? "pharmacy_customer" : "supplier", targetId: input.partyId, severity: "warning", details: { name: row.name, amount: input.amount, asOf: input.asOf } });
      return row;
    }),
);

const balanceFile = {
  fileName: z.string().trim().min(1).max(200),
  csv: z.string().min(1, "Choose a CSV file").max(MAX_IMPORT_BYTES, "The file is larger than 2 MB. Split it."),
};

export const checkBalanceImportAction = clinicAction(
  { name: "pharmacy.checkBalanceImport", permission: "accounts:manage", module: "pharmacy", schema: z.object(balanceFile) },
  async ({ session, db }, input) => db((tx) => checkBalanceImport(tx, input.csv, todayInTimeZone(session.timezone))),
);

export type BalanceImportOutcome = { status: "imported"; customerTotal: string; supplierTotal: string } | { status: "rejected"; report: BalanceReport };

export const runBalanceImportAction = clinicAction(
  { name: "pharmacy.runBalanceImport", permission: "accounts:manage", module: "pharmacy", schema: z.object({ ...balanceFile, idempotencyKey }) },
  async ({ session, db, audit }, input): Promise<BalanceImportOutcome> => {
    const today = todayInTimeZone(session.timezone);
    const report = await db((tx) => checkBalanceImport(tx, input.csv, today));
    if (report.problems.length > 0) {
      await db(async (tx) => {
        await recordRejectedBalanceImport(tx, session.clinicId, input.fileName, report, session.userId);
        await audit(tx, { action: "BALANCE_IMPORT_REJECTED", targetType: "import", severity: "warning", details: { file: input.fileName, rows: report.rows, problems: report.problems.length } });
      });
      return { status: "rejected", report };
    }
    return db(async (tx) => {
      const { result, replayed } = await runBalanceImport(tx, session.clinicId, input, session.userId, today);
      if (!replayed) await audit(tx, { action: "BALANCE_IMPORT_COMPLETED", targetType: "import", targetId: result.jobId, severity: "warning", details: { file: input.fileName, customers: result.customers, customerTotal: result.customerTotal, suppliers: result.suppliers, supplierTotal: result.supplierTotal } });
      return { status: "imported", customerTotal: result.customerTotal, supplierTotal: result.supplierTotal };
    });
  },
);

export const searchCustomersAction = clinicAction(
  { name: "pharmacy.searchCustomers", permission: "pharmacy:sell", module: "pharmacy", schema: z.object({ query: z.string().max(100).default("") }) },
  async ({ db }, input) =>
    db(async (tx) =>
      (await listCustomers(tx, input.query, 10))
        .filter((c) => c.isActive)
        .map((c) => ({ id: c.id, name: c.name, phone: c.phone, gstin: c.gstin, creditLimit: c.creditLimit })),
    ),
);

/** Counter staff can add buyers; only accounts staff set credit limits. */
export const saveCustomerAction = clinicAction(
  {
    name: "pharmacy.saveCustomer",
    permission: "pharmacy:sell",
    module: "pharmacy",
    schema: z.object({
      id: optionalId,
      name: requiredText(200, "Name"),
      phone: optionalPhone,
      address: optionalText(300),
      gstin: z
        .union([z.literal(""), z.string().trim().toUpperCase().regex(GSTIN_PATTERN, "Enter a valid 15-character GSTIN")])
        .optional()
        .transform((v) => v || undefined),
      stateCode: z
        .union([z.literal(""), z.string().trim().regex(/^\d{2}$/, "Two digits")])
        .optional()
        .transform((v) => v || undefined),
      creditLimit: optionalMoney,
    }),
  },
  async ({ session, db, audit }, input) =>
    db(async (tx) => {
      const canSetCredit = session.permissions.has("accounts:manage");
      const existing = input.id ? await getCustomer(tx, input.id) : null;
      const creditLimit = canSetCredit ? input.creditLimit : (existing?.creditLimit ?? undefined);
      const row = await saveCustomer(tx, session.clinicId, input.id, { ...input, creditLimit });
      await audit(tx, {
        action: input.id ? "PHARMACY_CUSTOMER_UPDATED" : "PHARMACY_CUSTOMER_ADDED",
        targetType: "pharmacy_customer",
        targetId: row.id,
        details: { name: input.name, gstin: input.gstin ?? null, creditLimit: creditLimit ?? null },
      });
      return { id: row.id, name: input.name, phone: input.phone ?? null, gstin: input.gstin ?? null, creditLimit: creditLimit ?? null };
    }),
);

export const recordReceiptAction = clinicAction(
  {
    name: "pharmacy.recordReceipt",
    permission: "accounts:manage",
    module: "pharmacy",
    schema: z.object({ customerId: idField, amount, method: accountMethod, reference: optionalText(100), note: optionalText(300) }),
  },
  async ({ session, db, audit }, input) =>
    db(async (tx) => {
      const row = await recordReceipt(tx, session.clinicId, input, session.userId, todayInTimeZone(session.timezone));
      await audit(tx, { action: "CUSTOMER_RECEIPT", targetType: "pharmacy_customer", targetId: input.customerId, details: { number: row.number, amount: input.amount, method: input.method } });
      return row;
    }),
);

export const recordSupplierPaymentAction = clinicAction(
  {
    name: "pharmacy.recordSupplierPayment",
    permission: "accounts:manage",
    module: "pharmacy",
    schema: z.object({ supplierId: idField, amount, method: accountMethod, reference: optionalText(100), note: optionalText(300) }),
  },
  async ({ session, db, audit }, input) =>
    db(async (tx) => {
      const row = await recordSupplierPayment(tx, session.clinicId, input, session.userId, todayInTimeZone(session.timezone));
      await audit(tx, { action: "SUPPLIER_PAYMENT", targetType: "supplier", targetId: input.supplierId, details: { number: row.number, amount: input.amount, method: input.method } });
      return row;
    }),
);
