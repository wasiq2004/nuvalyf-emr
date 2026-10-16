import "server-only";

import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import { patients, services, tasks, users, visits } from "@/lib/db/schema";
import { AppError } from "@/lib/errors";
import { ageOn, displayPatientName } from "@/features/patients/patient-rules";
import { ACTIVE_STATUSES, sortQueue, type VisitStatus } from "./queue-rules";

export type QueueItem = {
  id: string;
  status: VisitStatus;
  isEmergency: boolean;
  position: number;
  arrivedAt: Date;
  calledAt: Date | null;
  readyAt: Date | null;
  companionPhone: string | null;
  patientId: string;
  patientName: string;
  patientMrn: string;
  patientAge: number | null;
  patientSex: string;
  isPlaceholder: boolean;
  doctorId: string | null;
  doctorName: string | null;
  serviceName: string | null;
  appointmentId: string | null;
};

export async function listQueue(tx: Tx, date: string, { includeFinished = false } = {}): Promise<QueueItem[]> {
  const rows = await tx
    .select({
      visit: visits,
      patient: patients,
      doctorFirst: users.firstName,
      doctorLast: users.lastName,
      doctorTitle: users.title,
      serviceName: services.name,
    })
    .from(visits)
    .innerJoin(patients, eq(patients.id, visits.patientId))
    .leftJoin(users, eq(users.id, visits.doctorId))
    .leftJoin(services, eq(services.id, visits.serviceId))
    .where(
      and(
        eq(visits.visitDate, date),
        includeFinished ? undefined : inArray(visits.status, [...ACTIVE_STATUSES]),
      ),
    )
    .orderBy(asc(visits.arrivedAt));

  return sortQueue(
    rows.map((r) => ({
      id: r.visit.id,
      status: r.visit.status as VisitStatus,
      isEmergency: r.visit.isEmergency,
      position: r.visit.position,
      arrivedAt: r.visit.arrivedAt,
      calledAt: r.visit.calledAt,
      readyAt: r.visit.readyAt,
      companionPhone: r.visit.companionPhone,
      patientId: r.patient.id,
      patientName: displayPatientName(r.patient),
      patientMrn: r.patient.mrn,
      patientAge: ageOn(r.patient, date),
      patientSex: r.patient.sex,
      isPlaceholder: r.patient.isPlaceholder,
      doctorId: r.visit.doctorId,
      doctorName: r.doctorFirst ? [r.doctorTitle, r.doctorFirst, r.doctorLast].filter(Boolean).join(" ") : null,
      serviceName: r.serviceName,
      appointmentId: r.visit.appointmentId,
    })),
  );
}

/**
 * Moves a routine patient up or down among routine patients. Emergencies are
 * ordered by their flag and cannot be moved.
 */
export async function moveInQueue(tx: Tx, visitId: string, direction: "up" | "down", date: string) {
  const queue = (await listQueue(tx, date)).filter((v) => v.status === "waiting" && !v.isEmergency);
  const index = queue.findIndex((v) => v.id === visitId);
  if (index === -1) throw new AppError("Only routine patients still waiting can be moved.");
  const swapWith = direction === "up" ? index - 1 : index + 1;
  if (swapWith < 0 || swapWith >= queue.length) return;

  // Re-number everyone so positions are dense, then swap the pair.
  const order = queue.map((v) => v.id);
  [order[index], order[swapWith]] = [order[swapWith], order[index]];
  for (let i = 0; i < order.length; i++) {
    await tx.update(visits).set({ position: i, updatedAt: new Date() }).where(eq(visits.id, order[i]));
  }
}

export async function markLeft(tx: Tx, visitId: string) {
  const updated = await tx
    .update(visits)
    .set({ status: "left", completedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(visits.id, visitId), inArray(visits.status, ["waiting", "ready"])))
    .returning({ id: visits.id, patientId: visits.patientId });
  if (updated.length === 0) throw new AppError("Only a patient who is waiting can be marked as left.");
  return updated[0];
}

export async function listOpenTasks(tx: Tx) {
  return tx
    .select()
    .from(tasks)
    .where(eq(tasks.status, "open"))
    .orderBy(sql`case when ${tasks.priority} = 'urgent' then 0 else 1 end`, asc(tasks.createdAt));
}

export async function completeTask(tx: Tx, id: string, actorId: string) {
  const [task] = await tx.select().from(tasks).where(eq(tasks.id, id)).limit(1);
  if (!task || task.status !== "open") throw new AppError("Task not found or already done.");
  // Registration tasks close themselves when the record is completed, so the
  // register cannot be marked whole while it is not.
  if (task.type === "complete_registration") {
    throw new AppError("This task closes itself once the patient's record is completed.");
  }
  await tx
    .update(tasks)
    .set({ status: "done", completedBy: actorId, completedAt: new Date() })
    .where(and(eq(tasks.id, id), eq(tasks.status, "open")));
  return task;
}
