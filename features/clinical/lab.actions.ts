"use server";

import { z } from "zod";
import { clinicAction } from "@/lib/auth/actions";
import { idField, optionalText, requiredText } from "@/lib/validation";
import { RESULT_FLAGS, cancelLabOrder, enterParameterResults, enterResult, markResultRead, orderLab } from "./lab.service";
import { todayInTimeZone } from "@/lib/time";

export const orderLabAction = clinicAction(
  {
    name: "lab.order",
    permission: "lab:order",
    module: "lab",
    schema: z.object({ encounterId: idField, testId: idField, notes: optionalText(300) }),
  },
  async ({ session, db, audit }, input) =>
    db(async (tx) => {
      const row = await orderLab(tx, session.clinicId, input.encounterId, input.testId, input.notes, session.userId);
      await audit(tx, { action: "LAB_ORDERED", targetType: "lab_order", targetId: row.id, patientId: row.patientId, details: { test: row.testName } });
      return { id: row.id };
    }),
);

export const cancelLabOrderAction = clinicAction(
  { name: "lab.cancel", permission: "lab:order", module: "lab", schema: z.object({ id: idField }) },
  async ({ session, db, audit }, input) =>
    db(async (tx) => {
      const row = await cancelLabOrder(tx, input.id, session.userId);
      await audit(tx, { action: "LAB_ORDER_CANCELLED", targetType: "lab_order", targetId: row.id, patientId: row.patientId, details: { test: row.testName } });
    }),
);

export const enterLabResultAction = clinicAction(
  {
    name: "lab.result",
    permission: "lab:result",
    module: "lab",
    schema: z.object({
      id: idField,
      value: requiredText(500, "The result"),
      flag: z.enum(RESULT_FLAGS),
      notes: optionalText(1000),
    }),
  },
  async ({ session, db, audit }, input) =>
    db(async (tx) => {
      const row = await enterResult(tx, input.id, input, session.userId);
      await audit(tx, {
        action: "LAB_RESULT_ENTERED",
        targetType: "lab_order",
        targetId: row.id,
        patientId: row.patientId,
        details: { test: row.testName, flag: input.flag },
      });
    }),
);

/** A test with its own parameters; flags are decided on the server. */
export const enterLabParametersAction = clinicAction(
  {
    name: "lab.resultParameters",
    permission: "lab:result",
    module: "lab",
    schema: z.object({
      id: idField,
      values: z.array(z.object({ parameterId: idField, value: z.string().trim().max(200) })).min(1).max(100),
      notes: optionalText(1000),
    }),
  },
  async ({ session, db, audit }, input) =>
    db(async (tx) => {
      const row = await enterParameterResults(tx, session.clinicId, input.id, input, session.userId, todayInTimeZone(session.timezone));
      await audit(tx, { action: "LAB_RESULT_ENTERED", targetType: "lab_order", targetId: row.id, patientId: row.patientId, details: { test: row.testName, flag: row.flag, parameters: row.parameters } });
      return { flag: row.flag };
    }),
);

export const markResultReadAction = clinicAction(
  { name: "lab.markRead", permission: "lab:order", module: "lab", schema: z.object({ id: idField }) },
  async ({ session, db, audit }, input) =>
    db(async (tx) => {
      const row = await markResultRead(tx, input.id, session.userId);
      await audit(tx, { action: "LAB_RESULT_READ", targetType: "lab_order", targetId: row.id, patientId: row.patientId });
    }),
);
