"use server";

import { z } from "zod";
import { clinicAction } from "@/lib/auth/actions";
import { idField, optionalText, requiredText } from "@/lib/validation";
import { AppError } from "@/lib/errors";
import { todayInTimeZone } from "@/lib/time";
import { MAX_DOCUMENT_BYTES } from "./lab-document-rules";
import { addLabDocument, removeLabDocument } from "./lab-documents.service";
import { CHOSEN_LAB_FLAGS } from "./lab-rules";
import { RESULT_FLAGS, cancelLabOrder, markResultRead, orderLab, saveLabResult } from "./lab.service";

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

/** Saves a test's result: its own parameters, anything added, and any notes. */
export const saveLabResultAction = clinicAction(
  {
    name: "lab.result",
    permission: "lab:result",
    module: "lab",
    schema: z.object({
      id: idField,
      values: z.array(z.object({ parameterId: idField, value: z.string().trim().max(200) })).max(100),
      added: z
        .array(
          z.object({
            name: requiredText(120, "The parameter name"),
            value: requiredText(500, "The result"),
            unit: optionalText(40),
            reference: optionalText(80),
            flag: z.enum(CHOSEN_LAB_FLAGS).optional(),
          }),
        )
        .max(30),
      notes: optionalText(1000),
      documentFlag: z.enum(RESULT_FLAGS).optional(),
    }),
  },
  async ({ session, db, audit }, input) =>
    db(async (tx) => {
      const row = await saveLabResult(tx, session.clinicId, input.id, input, session.userId, todayInTimeZone(session.timezone));
      await audit(tx, { action: "LAB_RESULT_ENTERED", targetType: "lab_order", targetId: row.id, patientId: row.patientId, details: { test: row.testName, flag: row.flag, parameters: row.parameters, added: input.added.length, documents: row.documents } });
      return { flag: row.flag };
    }),
);

export const uploadLabDocumentAction = clinicAction(
  {
    name: "lab.documentUpload",
    permission: "lab:result",
    module: "lab",
    schema: z.object({ orderId: idField, file: z.instanceof(File, { error: "Choose a file." }) }),
  },
  async ({ session, db, audit }, input) => {
    if (input.file.size > MAX_DOCUMENT_BYTES) throw new AppError("That file is larger than 10 MB. Scan it at a lower resolution or split it.");
    const bytes = Buffer.from(await input.file.arrayBuffer());
    return db(async (tx) => {
      const row = await addLabDocument(tx, session.clinicId, input.orderId, { name: input.file.name, bytes }, session.userId);
      // No file name in the audit trail: names often carry clinical detail.
      await audit(tx, { action: "LAB_DOCUMENT_UPLOADED", targetType: "lab_document", targetId: row.id, patientId: row.patientId, details: { test: row.testName, bytes: bytes.length } });
      return { id: row.id };
    });
  },
);

export const removeLabDocumentAction = clinicAction(
  {
    name: "lab.documentRemove",
    permission: "lab:result",
    module: "lab",
    schema: z.object({ id: idField, reason: requiredText(300, "The reason") }),
  },
  async ({ session, db, audit }, input) =>
    db(async (tx) => {
      const row = await removeLabDocument(tx, input.id, input.reason, session.userId);
      await audit(tx, { action: "LAB_DOCUMENT_REMOVED", targetType: "lab_document", targetId: row.id, patientId: row.patientId, details: { test: row.testName, reason: input.reason } });
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
