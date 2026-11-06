"use server";

// Stock counts (docs/STOCK_MIGRATION.md). Each step needs stock:manage; every
// correction reaches the ledger through postStockCountAction alone.
import { z } from "zod";
import { clinicAction } from "@/lib/auth/actions";
import { isValidDateString, todayInTimeZone } from "@/lib/time";
import { idField, optionalText } from "@/lib/validation";
import { COUNT_REASON_KEYS } from "./stock-count-rules";
import { addFoundBatch, cancelCount, postCount, saveCounts, saveReview, startCount, submitCount } from "./stock-count.service";

const counted = z.coerce.number({ message: "Counts must be numbers" }).int("Whole units only").min(0, "A count cannot be negative").max(1000000);
const maybeCounted = counted.nullable();

export const startStockCountAction = clinicAction(
  {
    name: "pharmacy.startStockCount",
    permission: "stock:manage",
    module: "pharmacy",
    schema: z.object({ scope: z.enum(["all", "rack", "cycle"]), rack: optionalText(40) }),
  },
  async ({ session, db, audit }, input) =>
    db(async (tx) => {
      const row = await startCount(tx, session.clinicId, input, session.userId, todayInTimeZone(session.timezone));
      await audit(tx, { action: "STOCK_COUNT_STARTED", targetType: "stock_count", targetId: row.id, details: { number: row.number, scope: row.scopeLabel, lines: row.lines } });
      return row;
    }),
);

export const saveStockCountAction = clinicAction(
  {
    name: "pharmacy.saveStockCount",
    permission: "stock:manage",
    module: "pharmacy",
    schema: z.object({ countId: idField, entries: z.array(z.object({ lineId: idField, counted: maybeCounted })).max(5000) }),
  },
  async ({ session, db }, input) => db((tx) => saveCounts(tx, input.countId, input.entries, session.userId)),
);

export const addFoundBatchAction = clinicAction(
  {
    name: "pharmacy.addFoundBatch",
    permission: "stock:manage",
    module: "pharmacy",
    schema: z.object({
      countId: idField,
      drugId: idField,
      batchNo: z.string({ message: "Batch is required" }).trim().min(1, "Batch is required").max(60),
      expiryDate: z.string({ message: "Expiry is required" }).refine(isValidDateString, "Enter the expiry date"),
      counted,
    }),
  },
  async ({ session, db, audit }, input) =>
    db(async (tx) => {
      const row = await addFoundBatch(tx, session.clinicId, input, session.userId);
      await audit(tx, { action: "STOCK_COUNT_BATCH_FOUND", targetType: "stock_count", targetId: input.countId, details: { medicine: row.name, batch: row.batchNo, counted: input.counted } });
      return row;
    }),
);

export const submitStockCountAction = clinicAction(
  { name: "pharmacy.submitStockCount", permission: "stock:manage", module: "pharmacy", schema: z.object({ countId: idField }) },
  async ({ session, db, audit }, input) =>
    db(async (tx) => {
      const row = await submitCount(tx, input.countId, session.userId);
      await audit(tx, { action: "STOCK_COUNT_SUBMITTED", targetType: "stock_count", targetId: input.countId, details: row });
      return row;
    }),
);

export const saveStockReviewAction = clinicAction(
  {
    name: "pharmacy.saveStockReview",
    permission: "stock:manage",
    module: "pharmacy",
    schema: z.object({
      countId: idField,
      entries: z
        .array(z.object({ lineId: idField, recount: maybeCounted, reason: z.enum(COUNT_REASON_KEYS).nullable(), note: z.string().trim().max(300).nullable() }))
        .max(5000),
    }),
  },
  async ({ session, db }, input) => db((tx) => saveReview(tx, input.countId, input.entries, session.userId)),
);

export const postStockCountAction = clinicAction(
  { name: "pharmacy.postStockCount", permission: "stock:manage", module: "pharmacy", schema: z.object({ countId: idField }) },
  async ({ session, db, audit }, input) =>
    db(async (tx) => {
      const row = await postCount(tx, session.clinicId, input.countId, session.userId);
      await audit(tx, { action: "STOCK_COUNT_POSTED", targetType: "stock_count", targetId: input.countId, severity: row.shortage > 0 ? "warning" : "info", details: row });
      return row;
    }),
);

export const cancelStockCountAction = clinicAction(
  { name: "pharmacy.cancelStockCount", permission: "stock:manage", module: "pharmacy", schema: z.object({ countId: idField }) },
  async ({ db, audit }, input) =>
    db(async (tx) => {
      const row = await cancelCount(tx, input.countId);
      await audit(tx, { action: "STOCK_COUNT_CANCELLED", targetType: "stock_count", targetId: input.countId, details: row });
      return row;
    }),
);
