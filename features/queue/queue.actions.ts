"use server";

import { z } from "zod";
import { clinicAction } from "@/lib/auth/actions";
import { idField, optionalId } from "@/lib/validation";
import { todayInTimeZone } from "@/lib/time";
import { addWalkIn, checkInAppointment } from "@/features/scheduling/booking.service";
import { completeTask, markLeft, moveInQueue } from "./queue.service";

export const checkInAction = clinicAction(
  { name: "queue.checkIn", permission: "queue:checkin", schema: z.object({ appointmentId: idField }) },
  async ({ session, db, audit }, input) =>
    db(async (tx) => {
      const result = await checkInAppointment(tx, session.clinicId, input.appointmentId, session.userId, todayInTimeZone(session.timezone));
      await audit(tx, { action: "PATIENT_CHECKED_IN", targetType: "visit", targetId: result.visitId, patientId: result.patientId });
      return result;
    }),
);

export const walkInAction = clinicAction(
  {
    name: "queue.walkIn",
    permission: "queue:checkin",
    schema: z.object({ patientId: idField, doctorId: optionalId, serviceId: optionalId }),
  },
  async ({ session, db, audit }, input) =>
    db(async (tx) => {
      const visit = await addWalkIn(tx, session.clinicId, input, session.userId, todayInTimeZone(session.timezone));
      await audit(tx, { action: "WALK_IN_ADDED", targetType: "visit", targetId: visit.id, patientId: input.patientId });
      return visit;
    }),
);

export const moveInQueueAction = clinicAction(
  {
    name: "queue.move",
    permission: "queue:checkin",
    schema: z.object({ visitId: idField, direction: z.enum(["up", "down"]) }),
  },
  async ({ session, db, audit }, input) =>
    db(async (tx) => {
      await moveInQueue(tx, input.visitId, input.direction, todayInTimeZone(session.timezone));
      await audit(tx, { action: "QUEUE_REORDERED", targetType: "visit", targetId: input.visitId, details: { direction: input.direction } });
    }),
);

export const markLeftAction = clinicAction(
  { name: "queue.markLeft", permission: "queue:checkin", schema: z.object({ visitId: idField }) },
  async ({ db, audit }, input) =>
    db(async (tx) => {
      const visit = await markLeft(tx, input.visitId);
      await audit(tx, { action: "VISIT_LEFT_UNSEEN", targetType: "visit", targetId: visit.id, patientId: visit.patientId });
    }),
);

export const completeTaskAction = clinicAction(
  { name: "tasks.complete", permission: "patient:write", schema: z.object({ id: idField }) },
  async ({ session, db, audit }, input) =>
    db(async (tx) => {
      const task = await completeTask(tx, input.id, session.userId);
      await audit(tx, { action: "TASK_COMPLETED", targetType: "task", targetId: task.id, patientId: task.patientId });
    }),
);
