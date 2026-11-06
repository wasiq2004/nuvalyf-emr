"use server";

// Credit notes (returns, cancellations) and debit notes (purchase returns).
// docs/PHARMACY_DESIGN.md 4.2 and 4.3.
import { z } from "zod";
import { clinicAction } from "@/lib/auth/actions";
import { isValidDateString, todayInTimeZone } from "@/lib/time";
import { checkbox, idField, optionalId, optionalText, requiredText } from "@/lib/validation";
import { searchItems } from "@/features/catalog/items.service";
import { createOldBillReturn, createSaleReturn } from "./returns.service";
import { createPurchaseReturn } from "./supplier-accounts.service";

const idempotencyKey = z.string().trim().min(16, "Reload the page and try again.").max(64);
const units = z.coerce.number({ message: "Enter a number" }).int("Whole units only").min(0).max(100000);

const oldBillLine = z.object({
  drugId: idField,
  batchNo: z.string({ message: "Batch is required" }).trim().min(1, "Batch is required").max(60),
  expiryDate: z.string({ message: "Expiry is required" }).refine(isValidDateString, "Enter the expiry date"),
  quantity: units.min(1, "Quantity must be at least 1"),
  amount: z.string({ message: "Enter the amount" }).trim().regex(/^\d{1,8}(\.\d{1,2})?$/, "Enter the amount like 45 or 45.50"),
  resaleable: checkbox,
});

/** Every item, in stock or not: what comes back may have sold out long ago. */
export const searchReturnItemsAction = clinicAction(
  { name: "pharmacy.searchReturnItems", permission: "pharmacy:return", module: "pharmacy", schema: z.object({ query: z.string().max(200).default("") }) },
  async ({ db }, input) => db((tx) => searchItems(tx, input.query, { limit: 12 })),
);

export const oldBillReturnAction = clinicAction(
  {
    name: "pharmacy.oldBillReturn",
    permission: "pharmacy:return",
    module: "pharmacy",
    schema: z.object({
      oldBillNo: requiredText(60, "The old bill number"),
      oldBillDate: z.string({ message: "Enter the bill date" }).refine(isValidDateString, "Enter the bill date"),
      customerId: optionalId,
      customerName: optionalText(200),
      refundMethod: z.enum(["cash", "upi", "card", "other", "account"]),
      reason: requiredText(300, "A reason"),
      lines: z.array(oldBillLine).min(1, "Add what is being returned").max(50),
      confirmRepeat: checkbox,
      idempotencyKey,
    }),
  },
  async ({ session, db, audit }, input) =>
    db(async (tx) => {
      const { result, replayed } = await createOldBillReturn(tx, session.clinicId, input, session.userId, todayInTimeZone(session.timezone));
      if (!replayed) {
        await audit(tx, {
          action: "PHARMACY_OLD_BILL_RETURNED",
          targetType: "sale_return",
          targetId: result.returnId,
          severity: "warning",
          details: { creditNote: result.number, oldBill: result.oldBillNo, refund: result.refund, method: result.refundMethod, units: result.units, reason: input.reason },
        });
      }
      return result;
    }),
);

export const saleReturnAction = clinicAction(
  {
    name: "pharmacy.saleReturn",
    permission: "pharmacy:return",
    module: "pharmacy",
    schema: z.object({
      saleId: idField,
      reason: requiredText(300, "A reason"),
      lines: z.array(z.object({ saleItemId: idField, quantity: units })).min(1).max(50),
      idempotencyKey,
    }),
  },
  async ({ session, db, audit }, input) =>
    db(async (tx) => {
      const { result, replayed } = await createSaleReturn(tx, session.clinicId, { ...input, kind: "return" }, session.userId, todayInTimeZone(session.timezone), session.timezone);
      if (!replayed) {
        await audit(tx, {
          action: "PHARMACY_SALE_RETURNED",
          targetType: "pharmacy_sale",
          targetId: input.saleId,
          details: { creditNote: result.number, sale: result.saleNumber, refund: result.refund, method: result.refundMethod, units: result.units, reason: input.reason },
        });
      }
      return result;
    }),
);

export const cancelSaleAction = clinicAction(
  {
    name: "pharmacy.cancelSale",
    permission: "pharmacy:cancel",
    module: "pharmacy",
    schema: z.object({ saleId: idField, reason: requiredText(300, "A reason"), idempotencyKey }),
  },
  async ({ session, db, audit }, input) =>
    db(async (tx) => {
      const { result, replayed } = await createSaleReturn(tx, session.clinicId, { ...input, kind: "cancellation", lines: [] }, session.userId, todayInTimeZone(session.timezone), session.timezone);
      if (!replayed) {
        await audit(tx, {
          action: "PHARMACY_SALE_CANCELLED",
          targetType: "pharmacy_sale",
          targetId: input.saleId,
          severity: "warning",
          details: { creditNote: result.number, sale: result.saleNumber, refund: result.refund, reason: input.reason },
        });
      }
      return result;
    }),
);

export const purchaseReturnAction = clinicAction(
  {
    name: "pharmacy.purchaseReturn",
    permission: "stock:manage",
    module: "pharmacy",
    schema: z.object({
      supplierId: idField,
      reason: requiredText(300, "A reason"),
      lines: z.array(z.object({ batchId: idField, quantity: units })).min(1).max(100),
      idempotencyKey,
    }),
  },
  async ({ session, db, audit }, input) =>
    db(async (tx) => {
      const { result, replayed } = await createPurchaseReturn(tx, session.clinicId, input, session.userId, todayInTimeZone(session.timezone));
      if (!replayed) {
        await audit(tx, {
          action: "PURCHASE_RETURNED",
          targetType: "purchase_return",
          targetId: result.returnId,
          details: { debitNote: result.number, supplier: result.supplierName, total: result.total, units: result.units, reason: input.reason },
        });
      }
      return result;
    }),
);
