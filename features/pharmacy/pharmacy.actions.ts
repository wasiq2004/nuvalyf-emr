"use server";

import { z } from "zod";
import { clinicAction } from "@/lib/auth/actions";
import { isValidDateString, todayInTimeZone } from "@/lib/time";
import { idField, optionalId, optionalMoney, optionalPhone, optionalText, requiredText } from "@/lib/validation";
import { PAYMENT_METHODS } from "@/features/billing/billing-rules";
import { closePrescription, sell, sellableStock } from "./sales.service";
import { adjustStock, receiveStock, setReorderLevel } from "./stock.service";
import { answerQuery, raiseQuery } from "./queries.service";
import { cancelOrder, createOrder, decideOrder, receiveOrder, removeOrderItem, saveSupplier, setOrderItem, submitOrder } from "./purchasing.service";

const idempotencyKey = z.string().trim().min(16, "Reload the page and try again.").max(64);
const quantity = (label = "Quantity") => z.coerce.number({ message: `${label} must be a number` }).int("Whole units only").min(1, `${label} must be at least 1`).max(100000);
const expiryField = z.string({ message: "Expiry is required" }).refine(isValidDateString, "Enter the expiry date");
const batchField = z.string({ message: "Batch is required" }).trim().min(1, "Batch is required").max(60);

// ---------------------------------------------------------------------------
// Selling and dispensing
// ---------------------------------------------------------------------------

const saleLine = z.object({ drugId: idField, batchId: idField, quantity: quantity(), prescriptionItemId: optionalId });

export const searchSellableAction = clinicAction(
  { name: "pharmacy.searchStock", permission: "pharmacy:sell", module: "pharmacy", schema: z.object({ query: z.string().max(100).default("") }) },
  async ({ session, db }, input) => db((tx) => sellableStock(tx, input.query, todayInTimeZone(session.timezone))),
);

export const counterSaleAction = clinicAction(
  {
    name: "pharmacy.counterSale",
    permission: "pharmacy:sell",
    module: "pharmacy",
    schema: z.object({
      lines: z.array(saleLine).min(1, "Add at least one medicine").max(50),
      customerName: optionalText(200),
      customerPhone: optionalPhone,
      method: z.enum(PAYMENT_METHODS),
      reference: optionalText(100),
      idempotencyKey,
    }),
  },
  async ({ session, db, audit }, input) =>
    db(async (tx) => {
      const { result, replayed } = await sell(tx, session.clinicId, { ...input, lines: input.lines.map((l) => ({ ...l, prescriptionItemId: null })) }, session.userId, todayInTimeZone(session.timezone));
      if (!replayed) {
        await audit(tx, { action: "PHARMACY_SALE", targetType: "pharmacy_sale", targetId: result.saleId, details: { number: result.number, total: result.total, method: input.method } });
      }
      return result;
    }),
);

export const dispenseAction = clinicAction(
  {
    name: "pharmacy.dispense",
    permission: "pharmacy:dispense",
    module: "pharmacy",
    schema: z.object({
      prescriptionId: idField,
      lines: z.array(saleLine.extend({ prescriptionItemId: idField })).min(1, "Fill at least one line").max(50),
      method: z.enum(PAYMENT_METHODS),
      reference: optionalText(100),
      idempotencyKey,
    }),
  },
  async ({ session, db, audit }, input) =>
    db(async (tx) => {
      const { result, replayed } = await sell(tx, session.clinicId, input, session.userId, todayInTimeZone(session.timezone));
      if (!replayed) {
        await audit(tx, {
          action: "PRESCRIPTION_DISPENSED",
          targetType: "prescription",
          targetId: input.prescriptionId,
          patientId: result.patientId,
          details: { sale: result.number, total: result.total, status: result.dispenseStatus },
        });
      }
      return result;
    }),
);

export const closePrescriptionAction = clinicAction(
  {
    name: "pharmacy.closePrescription",
    permission: "pharmacy:dispense",
    module: "pharmacy",
    schema: z.object({ prescriptionId: idField, reason: requiredText(300, "A reason") }),
  },
  async ({ db, audit }, input) =>
    db(async (tx) => {
      const rx = await closePrescription(tx, input.prescriptionId);
      await audit(tx, {
        action: "PRESCRIPTION_CLOSED_UNDISPENSED",
        targetType: "prescription",
        targetId: rx.id,
        patientId: rx.patientId,
        severity: "warning",
        details: { reason: input.reason },
      });
    }),
);

// ---------------------------------------------------------------------------
// Clarifications
// ---------------------------------------------------------------------------

export const raiseQueryAction = clinicAction(
  {
    name: "pharmacy.raiseQuery",
    permission: "pharmacy:dispense",
    module: "pharmacy",
    schema: z.object({ prescriptionId: idField, prescriptionItemId: optionalId, message: requiredText(1000, "Your question") }),
  },
  async ({ session, db, audit }, input) =>
    db(async (tx) => {
      const row = await raiseQuery(tx, session.clinicId, input.prescriptionId, input.prescriptionItemId, input.message, session.userId);
      await audit(tx, { action: "PRESCRIPTION_QUERY_RAISED", targetType: "prescription", targetId: input.prescriptionId, patientId: row.patientId });
      return { id: row.id };
    }),
);

export const answerQueryAction = clinicAction(
  {
    name: "pharmacy.answerQuery",
    permission: "prescription:sign",
    schema: z.object({ id: idField, response: requiredText(1000, "Your answer") }),
  },
  async ({ session, db, audit }, input) =>
    db(async (tx) => {
      const row = await answerQuery(tx, input.id, input.response, session.userId);
      await audit(tx, { action: "PRESCRIPTION_QUERY_ANSWERED", targetType: "prescription", targetId: row.prescriptionId, patientId: row.patientId });
    }),
);

// ---------------------------------------------------------------------------
// Stock
// ---------------------------------------------------------------------------

export const receiveStockAction = clinicAction(
  {
    name: "pharmacy.receiveStock",
    permission: "stock:manage",
    module: "pharmacy",
    schema: z.object({
      drugId: idField,
      batchNo: batchField,
      expiryDate: expiryField,
      quantity: quantity(),
      unitCost: optionalMoney,
      reason: z.enum(["opening", "receipt", "return"]),
      note: optionalText(300),
    }),
  },
  async ({ session, db, audit }, input) =>
    db(async (tx) => {
      const row = await receiveStock(tx, session.clinicId, input, session.userId, todayInTimeZone(session.timezone));
      await audit(tx, {
        action: "STOCK_RECEIVED",
        targetType: "stock_batch",
        targetId: row.batchId,
        details: { medicine: row.drugName, batch: row.batchNo, quantity: input.quantity, reason: input.reason },
      });
    }),
);

export const adjustStockAction = clinicAction(
  {
    name: "pharmacy.adjustStock",
    permission: "stock:manage",
    module: "pharmacy",
    schema: z.object({
      batchId: idField,
      change: z.coerce.number({ message: "Enter a number" }).int("Whole units only").refine((v) => v !== 0, "Enter a change other than zero").pipe(z.number().min(-100000).max(100000)),
      reason: z.enum(["adjustment", "expired", "damaged"]),
      note: requiredText(300, "A note"),
    }),
  },
  async ({ session, db, audit }, input) =>
    db(async (tx) => {
      const row = await adjustStock(tx, session.clinicId, input, session.userId);
      await audit(tx, {
        action: "STOCK_ADJUSTED",
        targetType: "stock_batch",
        targetId: input.batchId,
        severity: input.change < 0 ? "warning" : "info",
        details: { batch: row.batchNo, change: input.change, reason: input.reason, note: input.note },
      });
    }),
);

export const setReorderLevelAction = clinicAction(
  {
    name: "pharmacy.reorderLevel",
    permission: "stock:manage",
    module: "pharmacy",
    schema: z.object({ drugId: idField, reorderLevel: z.coerce.number({ message: "Enter a number" }).int().min(0).max(100000) }),
  },
  async ({ db, audit }, input) =>
    db(async (tx) => {
      const row = await setReorderLevel(tx, input.drugId, input.reorderLevel);
      await audit(tx, { action: "REORDER_LEVEL_SET", targetType: "drug", targetId: row.id, details: { medicine: row.name, level: input.reorderLevel } });
    }),
);

// ---------------------------------------------------------------------------
// Suppliers and purchase orders
// ---------------------------------------------------------------------------

export const saveSupplierAction = clinicAction(
  {
    name: "pharmacy.saveSupplier",
    permission: "purchase:create",
    module: "pharmacy",
    schema: z.object({
      id: optionalId,
      name: requiredText(200, "Name"),
      contactName: optionalText(120),
      phone: optionalPhone,
      email: z.union([z.literal(""), z.email("Enter a valid email")]).optional().transform((v) => v || undefined),
      taxId: optionalText(40),
    }),
  },
  async ({ session, db, audit }, input) =>
    db(async (tx) => {
      const row = await saveSupplier(tx, session.clinicId, input.id, input);
      await audit(tx, { action: input.id ? "SUPPLIER_UPDATED" : "SUPPLIER_ADDED", targetType: "supplier", targetId: row.id, details: { name: input.name } });
      return row;
    }),
);

export const createOrderAction = clinicAction(
  { name: "pharmacy.createOrder", permission: "purchase:create", module: "pharmacy", schema: z.object({ supplierId: idField }) },
  async ({ session, db, audit }, input) =>
    db(async (tx) => {
      const row = await createOrder(tx, session.clinicId, input.supplierId, session.userId);
      await audit(tx, { action: "PURCHASE_ORDER_CREATED", targetType: "purchase_order", targetId: row.id, details: { number: row.number } });
      return row;
    }),
);

export const setOrderItemAction = clinicAction(
  {
    name: "pharmacy.setOrderItem",
    permission: "purchase:create",
    module: "pharmacy",
    schema: z.object({ orderId: idField, drugId: idField, quantity: quantity(), unitCost: optionalMoney }),
  },
  async ({ session, db, audit }, input) =>
    db(async (tx) => {
      const row = await setOrderItem(tx, session.clinicId, input.orderId, input);
      await audit(tx, { action: "PURCHASE_ORDER_LINE_SET", targetType: "purchase_order", targetId: input.orderId, details: { medicine: row.drugName, quantity: input.quantity } });
    }),
);

export const removeOrderItemAction = clinicAction(
  { name: "pharmacy.removeOrderItem", permission: "purchase:create", module: "pharmacy", schema: z.object({ id: idField }) },
  async ({ db, audit }, input) =>
    db(async (tx) => {
      const row = await removeOrderItem(tx, input.id);
      await audit(tx, { action: "PURCHASE_ORDER_LINE_REMOVED", targetType: "purchase_order", targetId: row.orderId });
    }),
);

export const submitOrderAction = clinicAction(
  { name: "pharmacy.submitOrder", permission: "purchase:create", module: "pharmacy", schema: z.object({ orderId: idField }) },
  async ({ db, audit }, input) =>
    db(async (tx) => {
      const row = await submitOrder(tx, input.orderId);
      await audit(tx, { action: "PURCHASE_ORDER_SUBMITTED", targetType: "purchase_order", targetId: input.orderId, details: { number: row.number } });
    }),
);

export const decideOrderAction = clinicAction(
  {
    name: "pharmacy.decideOrder",
    permission: "purchase:approve",
    module: "pharmacy",
    schema: z.object({ orderId: idField, decision: z.enum(["approved", "rejected"]), note: optionalText(300) }),
  },
  async ({ session, db, audit }, input) =>
    db(async (tx) => {
      const row = await decideOrder(tx, input.orderId, input.decision, input.note, session.userId);
      await audit(tx, {
        action: input.decision === "approved" ? "PURCHASE_ORDER_APPROVED" : "PURCHASE_ORDER_REJECTED",
        targetType: "purchase_order",
        targetId: input.orderId,
        details: { number: row.number, note: input.note },
      });
    }),
);

export const cancelOrderAction = clinicAction(
  { name: "pharmacy.cancelOrder", permission: "purchase:create", module: "pharmacy", schema: z.object({ orderId: idField }) },
  async ({ db, audit }, input) =>
    db(async (tx) => {
      const row = await cancelOrder(tx, input.orderId);
      await audit(tx, { action: "PURCHASE_ORDER_CANCELLED", targetType: "purchase_order", targetId: input.orderId, details: { number: row.number } });
    }),
);

export const receiveOrderAction = clinicAction(
  {
    name: "pharmacy.receiveOrder",
    permission: "stock:manage",
    module: "pharmacy",
    schema: z.object({
      orderId: idField,
      lines: z
        .array(
          z.object({
            itemId: idField,
            batchNo: batchField,
            expiryDate: expiryField,
            quantity: z.coerce.number().int().min(0).max(100000),
            unitCost: optionalMoney,
          }),
        )
        .min(1)
        .max(100),
      idempotencyKey,
    }),
  },
  async ({ session, db, audit }, input) =>
    db(async (tx) => {
      const { result, replayed } = await receiveOrder(tx, session.clinicId, input.orderId, input.lines, input.idempotencyKey, session.userId, todayInTimeZone(session.timezone));
      if (!replayed) {
        await audit(tx, { action: "PURCHASE_ORDER_RECEIVED", targetType: "purchase_order", targetId: input.orderId, details: result });
      }
      return result;
    }),
);
