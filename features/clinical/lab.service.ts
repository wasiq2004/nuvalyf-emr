import "server-only";

// Lab module: the doctor orders during the consultation, the Lab Technician
// enters results, and results go back to the ordering doctor, staying on
// their screen until they mark them read.
import { and, asc, desc, eq, gte, isNull } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import { encounters, labOrders, labTests, patients, users } from "@/lib/db/schema";
import { AppError } from "@/lib/errors";
import { ageOn, displayPatientName } from "@/features/patients/patient-rules";
import { requireOwnOpenEncounter, staffName } from "./encounters.service";

export const RESULT_FLAGS = ["normal", "abnormal", "critical"] as const;

export async function listLabTestOptions(tx: Tx) {
  return tx
    .select({ id: labTests.id, name: labTests.name, sampleType: labTests.sampleType })
    .from(labTests)
    .where(eq(labTests.isActive, true))
    .orderBy(asc(labTests.name));
}

export async function orderLab(tx: Tx, clinicId: string, encounterId: string, testId: string, notes: string | undefined, userId: string) {
  const encounter = await requireOwnOpenEncounter(tx, encounterId, userId);
  const [test] = await tx.select().from(labTests).where(and(eq(labTests.id, testId), eq(labTests.isActive, true))).limit(1);
  if (!test) throw new AppError("Choose a test from the clinic's list.");
  const already = await tx
    .select({ id: labOrders.id })
    .from(labOrders)
    .where(and(eq(labOrders.encounterId, encounterId), eq(labOrders.testId, testId), eq(labOrders.status, "ordered")))
    .limit(1);
  if (already.length) throw new AppError(`${test.name} is already ordered for this consultation.`);
  const [row] = await tx
    .insert(labOrders)
    .values({
      clinicId,
      encounterId,
      patientId: encounter.patientId,
      testId,
      testName: test.name,
      unit: test.unit,
      referenceRange: test.referenceRange,
      notes: notes ?? null,
      orderedBy: userId,
    })
    .returning({ id: labOrders.id });
  return { id: row.id, patientId: encounter.patientId, testName: test.name };
}

/** Only the doctor who ordered a test can cancel it. */
export async function cancelLabOrder(tx: Tx, id: string, userId: string) {
  const [row] = await tx
    .update(labOrders)
    .set({ status: "cancelled" })
    .where(and(eq(labOrders.id, id), eq(labOrders.status, "ordered"), eq(labOrders.orderedBy, userId)))
    .returning({ id: labOrders.id, patientId: labOrders.patientId, testName: labOrders.testName });
  if (!row) throw new AppError("Only the ordering doctor can cancel a test, and only before it is resulted.");
  return row;
}

export async function listEncounterLabOrders(tx: Tx, encounterId: string) {
  return tx.select().from(labOrders).where(eq(labOrders.encounterId, encounterId)).orderBy(asc(labOrders.orderedAt));
}

export async function listPatientLabOrders(tx: Tx, patientId: string, limit = 20) {
  return tx.select().from(labOrders).where(eq(labOrders.patientId, patientId)).orderBy(desc(labOrders.orderedAt)).limit(limit);
}

export type LabWorkItem = {
  id: string;
  testName: string;
  unit: string | null;
  referenceRange: string | null;
  notes: string | null;
  status: string;
  orderedAt: Date;
  orderedByName: string;
  patientName: string;
  patientMrn: string;
  patientAge: number | null;
  patientSex: string;
  resultValue: string | null;
  resultFlag: string | null;
  resultNotes: string | null;
  resultedAt: Date | null;
};

async function labRows(tx: Tx, where: ReturnType<typeof and>, today: string, order: "asc" | "desc", limit: number): Promise<LabWorkItem[]> {
  const rows = await tx
    .select({ order: labOrders, patient: patients, title: users.title, firstName: users.firstName, lastName: users.lastName })
    .from(labOrders)
    .innerJoin(patients, eq(patients.id, labOrders.patientId))
    .innerJoin(users, eq(users.id, labOrders.orderedBy))
    .where(where)
    .orderBy(order === "asc" ? asc(labOrders.orderedAt) : desc(labOrders.resultedAt))
    .limit(limit);
  return rows.map((r) => ({
    id: r.order.id,
    testName: r.order.testName,
    unit: r.order.unit,
    referenceRange: r.order.referenceRange,
    notes: r.order.notes,
    status: r.order.status,
    orderedAt: r.order.orderedAt,
    orderedByName: staffName(r),
    patientName: displayPatientName(r.patient),
    patientMrn: r.patient.mrn,
    patientAge: ageOn(r.patient, today),
    patientSex: r.patient.sex,
    resultValue: r.order.resultValue,
    resultFlag: r.order.resultFlag,
    resultNotes: r.order.resultNotes,
    resultedAt: r.order.resultedAt,
  }));
}

/** Tests waiting for a result, oldest first. */
export function listLabWorklist(tx: Tx, today: string) {
  return labRows(tx, and(eq(labOrders.status, "ordered")), today, "asc", 200);
}

export function listRecentResults(tx: Tx, today: string, since: Date) {
  return labRows(tx, and(eq(labOrders.status, "resulted"), gte(labOrders.resultedAt, since)), today, "desc", 50);
}

export async function enterResult(
  tx: Tx,
  id: string,
  input: { value: string; flag: (typeof RESULT_FLAGS)[number]; notes?: string },
  userId: string,
) {
  const [row] = await tx
    .update(labOrders)
    .set({
      status: "resulted",
      resultValue: input.value,
      resultFlag: input.flag,
      resultNotes: input.notes ?? null,
      resultedBy: userId,
      resultedAt: new Date(),
    })
    .where(and(eq(labOrders.id, id), eq(labOrders.status, "ordered")))
    .returning({ id: labOrders.id, patientId: labOrders.patientId, testName: labOrders.testName });
  if (!row) throw new AppError("This test has already been resulted or was cancelled.");
  return row;
}

export type UnreadResult = LabWorkItem & { encounterId: string };

/** Results for tests this doctor ordered that they have not read yet. */
export async function listUnreadResults(tx: Tx, doctorId: string, today: string): Promise<UnreadResult[]> {
  const rows = await tx
    .select({ order: labOrders, patient: patients, title: users.title, firstName: users.firstName, lastName: users.lastName, encounterId: encounters.id })
    .from(labOrders)
    .innerJoin(patients, eq(patients.id, labOrders.patientId))
    .innerJoin(users, eq(users.id, labOrders.orderedBy))
    .innerJoin(encounters, eq(encounters.id, labOrders.encounterId))
    .where(and(eq(labOrders.orderedBy, doctorId), eq(labOrders.status, "resulted"), isNull(labOrders.readAt)))
    .orderBy(desc(labOrders.resultedAt));
  return rows.map((r) => ({
    id: r.order.id,
    encounterId: r.encounterId,
    testName: r.order.testName,
    unit: r.order.unit,
    referenceRange: r.order.referenceRange,
    notes: r.order.notes,
    status: r.order.status,
    orderedAt: r.order.orderedAt,
    orderedByName: staffName(r),
    patientName: displayPatientName(r.patient),
    patientMrn: r.patient.mrn,
    patientAge: ageOn(r.patient, today),
    patientSex: r.patient.sex,
    resultValue: r.order.resultValue,
    resultFlag: r.order.resultFlag,
    resultNotes: r.order.resultNotes,
    resultedAt: r.order.resultedAt,
  }));
}

export async function markResultRead(tx: Tx, id: string, doctorId: string) {
  const [row] = await tx
    .update(labOrders)
    .set({ readAt: new Date() })
    .where(and(eq(labOrders.id, id), eq(labOrders.orderedBy, doctorId), eq(labOrders.status, "resulted"), isNull(labOrders.readAt)))
    .returning({ id: labOrders.id, patientId: labOrders.patientId });
  if (!row) throw new AppError("Only the ordering doctor can mark an unread result as read.");
  return row;
}
