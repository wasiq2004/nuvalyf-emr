"use server";

import { z } from "zod";
import { clinicAction } from "@/lib/auth/actions";
import { idField, optionalId, optionalText, requiredText } from "@/lib/validation";
import { ITEM_KINDS, PAYMENT_METHODS } from "./billing-rules";
import {
  addInvoiceItem,
  createInvoice,
  createInvoiceForVisit,
  discardDraft,
  issueInvoice,
  recordPayment,
  recordRefund,
  removeInvoiceItem,
  setDiscount,
  voidInvoice,
} from "./billing.service";

const amountField = (label: string) =>
  z
    .string({ message: `${label} is required` })
    .trim()
    .regex(/^\d{1,9}(\.\d{1,2})?$/, "Enter an amount like 500 or 499.50");

const idempotencyKey = z.string().trim().min(16, "Reload the page and try again.").max(64);

export const createInvoiceForVisitAction = clinicAction(
  { name: "billing.invoiceVisit", permission: "billing:manage", schema: z.object({ visitId: idField }) },
  async ({ session, db, audit }, input) =>
    db(async (tx) => {
      const row = await createInvoiceForVisit(tx, session.clinicId, input.visitId, session.userId);
      if (row.created) await audit(tx, { action: "INVOICE_CREATED", targetType: "invoice", targetId: row.id, patientId: row.patientId, details: { visitId: input.visitId } });
      return { id: row.id };
    }),
);

export const createInvoiceAction = clinicAction(
  { name: "billing.createInvoice", permission: "billing:manage", schema: z.object({ patientId: idField }) },
  async ({ session, db, audit }, input) =>
    db(async (tx) => {
      const row = await createInvoice(tx, session.clinicId, input.patientId, session.userId);
      await audit(tx, { action: "INVOICE_CREATED", targetType: "invoice", targetId: row.id, patientId: row.patientId });
      return { id: row.id };
    }),
);

export const addInvoiceItemAction = clinicAction(
  {
    name: "billing.addItem",
    permission: "billing:manage",
    schema: z
      .object({
        invoiceId: idField,
        serviceId: optionalId,
        kind: z.enum(ITEM_KINDS).default("other"),
        description: optionalText(300),
        quantity: z.coerce.number({ message: "Enter a quantity" }).int("Whole numbers only").min(1).max(10000).default(1),
        unitPrice: z.union([z.literal(""), amountField("Price")]).optional(),
      })
      .refine((v) => v.serviceId || (v.description && v.unitPrice), {
        message: "Choose a service, or enter a description and a price",
        path: ["description"],
      }),
  },
  async ({ session, db, audit }, input) =>
    db(async (tx) => {
      const row = await addInvoiceItem(tx, session.clinicId, input.invoiceId, {
        kind: input.kind,
        description: input.description ?? "",
        quantity: input.quantity,
        unitPrice: input.unitPrice || "0",
        serviceId: input.serviceId,
      });
      await audit(tx, { action: "INVOICE_LINE_ADDED", targetType: "invoice", targetId: input.invoiceId, patientId: row.patientId, details: { line: row.description } });
    }),
);

export const removeInvoiceItemAction = clinicAction(
  { name: "billing.removeItem", permission: "billing:manage", schema: z.object({ id: idField }) },
  async ({ db, audit }, input) =>
    db(async (tx) => {
      const row = await removeInvoiceItem(tx, input.id);
      await audit(tx, { action: "INVOICE_LINE_REMOVED", targetType: "invoice", targetId: row.invoiceId, patientId: row.patientId });
    }),
);

export const setDiscountAction = clinicAction(
  {
    name: "billing.discount",
    permission: "billing:manage",
    schema: z.object({ invoiceId: idField, discount: amountField("Discount"), reason: optionalText(300) }),
  },
  async ({ db, audit }, input) =>
    db(async (tx) => {
      const row = await setDiscount(tx, input.invoiceId, input.discount, input.reason);
      await audit(tx, {
        action: "INVOICE_DISCOUNT_SET",
        targetType: "invoice",
        targetId: input.invoiceId,
        patientId: row.patientId,
        severity: "warning",
        details: { discount: input.discount, reason: input.reason },
      });
    }),
);

export const issueInvoiceAction = clinicAction(
  { name: "billing.issue", permission: "billing:manage", schema: z.object({ invoiceId: idField }) },
  async ({ session, db, audit }, input) =>
    db(async (tx) => {
      const row = await issueInvoice(tx, input.invoiceId, session.userId);
      await audit(tx, { action: "INVOICE_ISSUED", targetType: "invoice", targetId: input.invoiceId, patientId: row.patientId, details: { number: row.number } });
    }),
);

export const discardDraftAction = clinicAction(
  { name: "billing.discard", permission: "billing:manage", schema: z.object({ invoiceId: idField }) },
  async ({ db, audit }, input) =>
    db(async (tx) => {
      const row = await discardDraft(tx, input.invoiceId);
      await audit(tx, { action: "INVOICE_DRAFT_DISCARDED", targetType: "invoice", targetId: input.invoiceId, patientId: row.patientId, details: { number: row.number } });
      return { patientId: row.patientId };
    }),
);

export const voidInvoiceAction = clinicAction(
  { name: "billing.void", permission: "billing:manage", schema: z.object({ invoiceId: idField, reason: requiredText(300, "A reason") }) },
  async ({ session, db, audit }, input) =>
    db(async (tx) => {
      const row = await voidInvoice(tx, input.invoiceId, input.reason, session.userId);
      await audit(tx, {
        action: "INVOICE_VOIDED",
        targetType: "invoice",
        targetId: input.invoiceId,
        patientId: row.patientId,
        severity: "warning",
        details: { number: row.number, reason: input.reason },
      });
    }),
);

export const recordPaymentAction = clinicAction(
  {
    name: "billing.payment",
    permission: "billing:manage",
    schema: z.object({
      invoiceId: idField,
      amount: amountField("Amount"),
      method: z.enum(PAYMENT_METHODS, { message: "Choose how they paid" }),
      reference: optionalText(100),
      idempotencyKey,
    }),
  },
  async ({ session, db, audit }, input) =>
    db(async (tx) => {
      const row = await recordPayment(tx, session.clinicId, input, session.userId);
      if (!row.duplicate) {
        await audit(tx, {
          action: "PAYMENT_RECORDED",
          targetType: "payment",
          targetId: row.paymentId,
          patientId: row.patientId,
          details: { invoice: row.number, amount: input.amount, method: input.method },
        });
      }
      return { paymentId: row.paymentId, duplicate: row.duplicate };
    }),
);

export const recordRefundAction = clinicAction(
  {
    name: "billing.refund",
    permission: "billing:manage",
    schema: z.object({
      invoiceId: idField,
      amount: amountField("Amount"),
      method: z.enum(PAYMENT_METHODS, { message: "Choose how it was refunded" }),
      reason: requiredText(300, "A reason"),
      idempotencyKey,
    }),
  },
  async ({ session, db, audit }, input) =>
    db(async (tx) => {
      const row = await recordRefund(tx, session.clinicId, input, session.userId);
      if (!row.duplicate) {
        await audit(tx, {
          action: "REFUND_RECORDED",
          targetType: "payment",
          targetId: row.paymentId,
          patientId: row.patientId,
          severity: "warning",
          details: { invoice: row.number, amount: input.amount, method: input.method, reason: input.reason },
        });
      }
      return { paymentId: row.paymentId, duplicate: row.duplicate };
    }),
);
