import "server-only";

// Clarification requests from the pharmacy to the prescriber. The signed
// prescription is never edited; if the doctor wants a change, it is recorded
// as an amendment on the consultation.
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Tx } from "@/lib/db";
import { patients, prescriptionItems, prescriptionQueries, prescriptions, users } from "@/lib/db/schema";
import { AppError } from "@/lib/errors";
import { displayPatientName } from "@/features/patients/patient-rules";
import { staffName } from "@/features/clinical/encounters.service";

export async function raiseQuery(tx: Tx, clinicId: string, prescriptionId: string, prescriptionItemId: string | null, message: string, actorId: string) {
  const [rx] = await tx.select().from(prescriptions).where(and(eq(prescriptions.id, prescriptionId), eq(prescriptions.status, "signed"))).limit(1);
  if (!rx) throw new AppError("Prescription not found.");
  if (prescriptionItemId) {
    const [item] = await tx
      .select({ id: prescriptionItems.id })
      .from(prescriptionItems)
      .where(and(eq(prescriptionItems.id, prescriptionItemId), eq(prescriptionItems.prescriptionId, prescriptionId)))
      .limit(1);
    if (!item) throw new AppError("That line is not on this prescription.");
  }
  const [row] = await tx
    .insert(prescriptionQueries)
    .values({ clinicId, prescriptionId, prescriptionItemId, addressedTo: rx.prescriberId, message, raisedBy: actorId })
    .returning({ id: prescriptionQueries.id });
  return { id: row.id, patientId: rx.patientId, encounterId: rx.encounterId };
}

export async function answerQuery(tx: Tx, queryId: string, response: string, actorId: string) {
  const [row] = await tx
    .update(prescriptionQueries)
    .set({ response, answeredBy: actorId, answeredAt: new Date() })
    .where(and(eq(prescriptionQueries.id, queryId), isNull(prescriptionQueries.answeredAt)))
    .returning({ id: prescriptionQueries.id, prescriptionId: prescriptionQueries.prescriptionId });
  if (!row) throw new AppError("This question has already been answered.");
  const [rx] = await tx.select({ patientId: prescriptions.patientId }).from(prescriptions).where(eq(prescriptions.id, row.prescriptionId)).limit(1);
  return { ...row, patientId: rx?.patientId ?? null };
}

const raiser = alias(users, "raiser");
const answerer = alias(users, "answerer");

export type QueryView = {
  id: string;
  prescriptionId: string;
  itemName: string | null;
  message: string;
  raisedByName: string;
  raisedAt: Date;
  response: string | null;
  answeredByName: string | null;
  answeredAt: Date | null;
};

async function queryRows(tx: Tx, where: ReturnType<typeof and>) {
  const rows = await tx
    .select({
      q: prescriptionQueries,
      itemName: prescriptionItems.drugName,
      rTitle: raiser.title,
      rFirst: raiser.firstName,
      rLast: raiser.lastName,
      aTitle: answerer.title,
      aFirst: answerer.firstName,
      aLast: answerer.lastName,
    })
    .from(prescriptionQueries)
    .innerJoin(raiser, eq(raiser.id, prescriptionQueries.raisedBy))
    .leftJoin(answerer, eq(answerer.id, prescriptionQueries.answeredBy))
    .leftJoin(prescriptionItems, eq(prescriptionItems.id, prescriptionQueries.prescriptionItemId))
    .where(where)
    .orderBy(asc(prescriptionQueries.raisedAt));
  return rows.map(
    (r): QueryView => ({
      id: r.q.id,
      prescriptionId: r.q.prescriptionId,
      itemName: r.itemName,
      message: r.q.message,
      raisedByName: staffName({ title: r.rTitle, firstName: r.rFirst, lastName: r.rLast }),
      raisedAt: r.q.raisedAt,
      response: r.q.response,
      answeredByName: r.aFirst ? staffName({ title: r.aTitle, firstName: r.aFirst, lastName: r.aLast ?? "" }) : null,
      answeredAt: r.q.answeredAt,
    }),
  );
}

export function listQueriesForPrescription(tx: Tx, prescriptionId: string) {
  return queryRows(tx, and(eq(prescriptionQueries.prescriptionId, prescriptionId)));
}

export type OpenQuery = QueryView & { patientName: string; patientMrn: string; encounterId: string };

/** Questions waiting for this prescriber. */
export async function listOpenQueriesFor(tx: Tx, userId: string): Promise<OpenQuery[]> {
  const open = await queryRows(tx, and(eq(prescriptionQueries.addressedTo, userId), isNull(prescriptionQueries.answeredAt)));
  if (open.length === 0) return [];
  const rx = await tx
    .select({ id: prescriptions.id, encounterId: prescriptions.encounterId, patient: patients })
    .from(prescriptions)
    .innerJoin(patients, eq(patients.id, prescriptions.patientId))
    .where(eq(prescriptions.prescriberId, userId))
    .orderBy(desc(prescriptions.signedAt));
  return open.flatMap((q) => {
    const r = rx.find((x) => x.id === q.prescriptionId);
    return r ? [{ ...q, patientName: displayPatientName(r.patient), patientMrn: r.patient.mrn, encounterId: r.encounterId }] : [];
  });
}
