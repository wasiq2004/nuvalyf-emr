"use server";

// Reorder drafts and shelf-label barcodes.
import { z } from "zod";
import { clinicAction } from "@/lib/auth/actions";
import { idField, optionalMoney } from "@/lib/validation";
import { createReorderDrafts } from "./reorder.service";
import { assignBarcodes } from "./labels.service";

export const createReorderDraftsAction = clinicAction(
  {
    name: "pharmacy.createReorderDrafts",
    permission: "purchase:create",
    module: "pharmacy",
    schema: z.object({
      picks: z
        .array(
          z.object({
            drugId: idField,
            supplierId: idField,
            units: z.coerce.number().int().min(1).max(100000),
            unitCost: optionalMoney,
          }),
        )
        .min(1, "Choose at least one item")
        .max(200),
    }),
  },
  async ({ session, db, audit }, input) =>
    db(async (tx) => {
      const orders = await createReorderDrafts(tx, session.clinicId, input.picks, session.userId);
      for (const o of orders) {
        await audit(tx, { action: "PURCHASE_ORDER_CREATED", targetType: "purchase_order", targetId: o.id, details: { number: o.number, lines: o.lines, from: "reorder suggestions" } });
      }
      return orders;
    }),
);

export const assignBarcodesAction = clinicAction(
  {
    name: "pharmacy.assignBarcodes",
    permission: "medicine:manage",
    module: "pharmacy",
    schema: z.object({ drugIds: z.array(idField).min(1).max(500) }),
  },
  async ({ session, db, audit }, input) =>
    db(async (tx) => {
      const assigned = await assignBarcodes(tx, session.clinicId, input.drugIds);
      if (assigned) await audit(tx, { action: "BARCODES_ASSIGNED", targetType: "drug", details: { count: assigned } });
      return { assigned };
    }),
);
