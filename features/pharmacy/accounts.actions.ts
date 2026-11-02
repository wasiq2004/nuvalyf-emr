"use server";

// Customers, receipts against their accounts, and supplier payments
// (docs/PHARMACY_DESIGN.md 4.4).
import { z } from "zod";
import { clinicAction } from "@/lib/auth/actions";
import { todayInTimeZone } from "@/lib/time";
import { idField, optionalId, optionalMoney, optionalPhone, optionalText, requiredText } from "@/lib/validation";
import { GSTIN_PATTERN } from "./gst-rules";
import { getCustomer, listCustomers, recordReceipt, saveCustomer } from "./customers.service";
import { recordSupplierPayment } from "./supplier-accounts.service";

const amount = z.string({ message: "Enter the amount" }).trim().regex(/^\d{1,8}(\.\d{1,2})?$/, "Enter an amount like 500 or 500.50");
const accountMethod = z.enum(["cash", "upi", "card", "bank", "cheque", "other"]);

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
