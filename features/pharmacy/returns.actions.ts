"use server";

// Credit notes (returns, cancellations) and debit notes (purchase returns).
// docs/PHARMACY_DESIGN.md 4.2 and 4.3.
import { z } from "zod";
import { clinicAction } from "@/lib/auth/actions";
import { todayInTimeZone } from "@/lib/time";
import { idField, requiredText } from "@/lib/validation";
import { createSaleReturn } from "./returns.service";
import { createPurchaseReturn } from "./supplier-accounts.service";

const idempotencyKey = z.string().trim().min(16, "Reload the page and try again.").max(64);
const units = z.coerce.number({ message: "Enter a number" }).int("Whole units only").min(0).max(100000);

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
