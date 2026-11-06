import "server-only";

// Documents the lab attaches to a test: a scanned report, a machine printout, a
// photo. They belong to the test, so the patient, clinic and access rules all
// come from the order and never from the request. docs/LAB_REPORTS.md.
import { createHash } from "crypto";
import { and, count, desc, eq, inArray, isNull } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import { labDocumentFiles, labDocuments, labOrders, labResults, users } from "@/lib/db/schema";
import { AppError } from "@/lib/errors";
import { MAX_DOCUMENTS_PER_ORDER, MAX_DOCUMENT_BYTES, cleanFileName, sniffDocumentType } from "./lab-document-rules";
import { staffName } from "./encounters.service";

export async function addLabDocument(tx: Tx, clinicId: string, orderId: string, file: { name: string; bytes: Buffer }, userId: string) {
  if (file.bytes.length === 0) throw new AppError("That file is empty.");
  if (file.bytes.length > MAX_DOCUMENT_BYTES) throw new AppError("That file is larger than 10 MB. Scan it at a lower resolution or split it.");
  const contentType = sniffDocumentType(file.bytes);
  if (!contentType) throw new AppError("Upload a PDF, JPG or PNG file.");

  // Locked so two uploads at once cannot both pass the count below.
  const [order] = await tx.select().from(labOrders).where(eq(labOrders.id, orderId)).for("update").limit(1);
  if (!order) throw new AppError("That test was not found.");
  if (order.status === "cancelled") throw new AppError("This test was cancelled.");

  const active = await tx.select({ sha256: labDocuments.sha256 }).from(labDocuments).where(and(eq(labDocuments.orderId, orderId), isNull(labDocuments.removedAt)));
  if (active.length >= MAX_DOCUMENTS_PER_ORDER) throw new AppError(`A test can have up to ${MAX_DOCUMENTS_PER_ORDER} documents.`);
  const sha256 = createHash("sha256").update(file.bytes).digest("hex");
  if (active.some((d) => d.sha256 === sha256)) throw new AppError("This file is already attached to this test.");

  const [row] = await tx
    .insert(labDocuments)
    .values({ clinicId, orderId, patientId: order.patientId, fileName: cleanFileName(file.name, contentType), contentType, sizeBytes: file.bytes.length, sha256, uploadedBy: userId })
    .returning({ id: labDocuments.id });
  await tx.insert(labDocumentFiles).values({ documentId: row.id, clinicId, content: file.bytes });

  // A document that arrives after the doctor read the result is news to them.
  if (order.status === "resulted" && order.readAt) await tx.update(labOrders).set({ readAt: null }).where(eq(labOrders.id, orderId));
  return { id: row.id, patientId: order.patientId, testName: order.testName };
}

export async function removeLabDocument(tx: Tx, id: string, reason: string, userId: string) {
  const [document] = await tx.select().from(labDocuments).where(and(eq(labDocuments.id, id), isNull(labDocuments.removedAt))).limit(1);
  if (!document) throw new AppError("That document is not on this test any more.");
  const [order] = await tx.select().from(labOrders).where(eq(labOrders.id, document.orderId)).for("update").limit(1);
  if (order?.status === "resulted") {
    // A result saved as "see the document" would point at nothing.
    const [lines] = await tx.select({ n: count() }).from(labResults).where(eq(labResults.orderId, order.id));
    const [others] = await tx.select({ n: count() }).from(labDocuments).where(and(eq(labDocuments.orderId, order.id), isNull(labDocuments.removedAt)));
    if (lines.n === 0 && others.n <= 1 && order.resultValue === RESULT_IN_DOCUMENT) throw new AppError("This result is in this document. Upload the correct one first, then remove this one.");
  }
  await tx.update(labDocuments).set({ removedAt: new Date(), removedBy: userId, removedReason: reason }).where(eq(labDocuments.id, id));
  return { id, patientId: document.patientId, testName: order?.testName ?? "" };
}

/** What a test says when its whole result is in an attached document. */
export const RESULT_IN_DOCUMENT = "See attached document";

export type LabDocumentRow = {
  id: string;
  orderId: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  uploadedAt: Date;
  uploadedByName: string | null;
  removedAt: Date | null;
  removedReason: string | null;
  removedByName: string | null;
};

async function rows(tx: Tx, where: ReturnType<typeof and>): Promise<LabDocumentRow[]> {
  const list = await tx.select().from(labDocuments).where(where).orderBy(desc(labDocuments.uploadedAt));
  const ids = [...new Set(list.flatMap((d) => [d.uploadedBy, d.removedBy]).filter((v): v is string => Boolean(v)))];
  const staff = ids.length ? await tx.select().from(users).where(inArray(users.id, ids)) : [];
  const nameOf = (id: string | null) => {
    const person = staff.find((s) => s.id === id);
    return person ? staffName(person) : null;
  };
  return list.map((d) => ({
    id: d.id,
    orderId: d.orderId,
    fileName: d.fileName,
    contentType: d.contentType,
    sizeBytes: d.sizeBytes,
    uploadedAt: d.uploadedAt,
    uploadedByName: nameOf(d.uploadedBy),
    removedAt: d.removedAt,
    removedReason: d.removedReason,
    removedByName: nameOf(d.removedBy),
  }));
}

/** One test's documents, with removed ones so the lab can see what happened to them. */
export function listOrderDocuments(tx: Tx, orderId: string) {
  return rows(tx, and(eq(labDocuments.orderId, orderId)));
}

export async function documentsForOrders(tx: Tx, orderIds: string[]) {
  const map = new Map<string, LabDocumentRow[]>();
  if (orderIds.length === 0) return map;
  for (const d of await rows(tx, and(inArray(labDocuments.orderId, orderIds), isNull(labDocuments.removedAt)))) map.set(d.orderId, [...(map.get(d.orderId) ?? []), d]);
  return map;
}

export type PatientLabDocument = LabDocumentRow & { testName: string };

/** Every document on a patient's record, newest first. */
export async function listPatientDocuments(tx: Tx, patientId: string): Promise<PatientLabDocument[]> {
  const list = await rows(tx, and(eq(labDocuments.patientId, patientId), isNull(labDocuments.removedAt)));
  const orderIds = [...new Set(list.map((d) => d.orderId))];
  const orders = orderIds.length ? await tx.select({ id: labOrders.id, testName: labOrders.testName }).from(labOrders).where(inArray(labOrders.id, orderIds)) : [];
  return list.map((d) => ({ ...d, testName: orders.find((o) => o.id === d.orderId)?.testName ?? "" }));
}

export async function activeDocumentCount(tx: Tx, orderId: string) {
  const [row] = await tx.select({ n: count() }).from(labDocuments).where(and(eq(labDocuments.orderId, orderId), isNull(labDocuments.removedAt)));
  return row.n;
}

/** One document to open. A removed document cannot be opened. */
export async function labDocumentForViewing(tx: Tx, id: string) {
  const [row] = await tx
    .select({ document: labDocuments, content: labDocumentFiles.content })
    .from(labDocuments)
    .innerJoin(labDocumentFiles, eq(labDocumentFiles.documentId, labDocuments.id))
    .where(and(eq(labDocuments.id, id), isNull(labDocuments.removedAt)))
    .limit(1);
  return row ?? null;
}

export async function labDocumentContents(tx: Tx, ids: string[]) {
  if (ids.length === 0) return new Map<string, Buffer>();
  const list = await tx.select().from(labDocumentFiles).where(inArray(labDocumentFiles.documentId, ids));
  return new Map(list.map((f) => [f.documentId, f.content]));
}
