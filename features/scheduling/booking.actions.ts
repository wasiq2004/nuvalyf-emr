"use server";

import { z } from "zod";
import { clinicAction } from "@/lib/auth/actions";
import { idField, optionalText, requiredText } from "@/lib/validation";
import { isValidDateString, isValidTimeString } from "@/lib/time";
import { getClinicSettings } from "@/features/settings/settings.service";
import { addLeave, bookAppointment, cancelAppointment, getAvailableSlots, markNoShow, removeLeave, rescheduleAppointment } from "./booking.service";

const dateField = z.string().refine(isValidDateString, "Choose a date");

export const getSlotsAction = clinicAction(
  {
    name: "appointments.slots",
    permission: "appointment:manage",
    schema: z.object({ doctorId: idField, serviceId: idField, date: dateField }),
  },
  async ({ session, db }, input) =>
    db(async (tx) => {
      const settings = await getClinicSettings(tx, session.clinicId);
      return getAvailableSlots(tx, { ...input, timeZone: session.timezone, gridMinutes: settings.slotMinutes });
    }),
);

export const bookAppointmentAction = clinicAction(
  {
    name: "appointments.book",
    permission: "appointment:manage",
    schema: z.object({
      patientId: idField,
      doctorId: idField,
      serviceId: idField,
      date: dateField,
      time: z.string().refine(isValidTimeString, "Choose a time"),
      notes: optionalText(1000),
    }),
  },
  async ({ session, db, audit }, input) =>
    db(async (tx) => {
      const settings = await getClinicSettings(tx, session.clinicId);
      const appointment = await bookAppointment(
        tx,
        session.clinicId,
        { ...input, timeZone: session.timezone, gridMinutes: settings.slotMinutes },
        session.userId,
      );
      await audit(tx, {
        action: "APPOINTMENT_BOOKED",
        targetType: "appointment",
        targetId: appointment.id,
        patientId: input.patientId,
        details: { doctorId: input.doctorId, startsAt: appointment.startsAt.toISOString() },
      });
      return { id: appointment.id };
    }),
);

export const cancelAppointmentAction = clinicAction(
  {
    name: "appointments.cancel",
    permission: "appointment:manage",
    schema: z.object({ id: idField, reason: requiredText(500, "A reason") }),
  },
  async ({ db, audit }, input) =>
    db(async (tx) => {
      const appointment = await cancelAppointment(tx, input.id, input.reason);
      await audit(tx, {
        action: "APPOINTMENT_CANCELLED",
        targetType: "appointment",
        targetId: input.id,
        patientId: appointment.patientId,
        details: { reason: input.reason },
      });
    }),
);

export const markNoShowAction = clinicAction(
  { name: "appointments.noShow", permission: "appointment:manage", schema: z.object({ id: idField }) },
  async ({ db, audit }, input) =>
    db(async (tx) => {
      const appointment = await markNoShow(tx, input.id);
      await audit(tx, { action: "APPOINTMENT_NO_SHOW", targetType: "appointment", targetId: input.id, patientId: appointment.patientId });
    }),
);

export const rescheduleAppointmentAction = clinicAction(
  {
    name: "appointments.reschedule",
    permission: "appointment:manage",
    schema: z.object({ id: idField, date: dateField, time: z.string().refine(isValidTimeString, "Choose a time") }),
  },
  async ({ session, db, audit }, input) =>
    db(async (tx) => {
      const settings = await getClinicSettings(tx, session.clinicId);
      const moved = await rescheduleAppointment(tx, session.clinicId, input.id, { date: input.date, time: input.time, timeZone: session.timezone, gridMinutes: settings.slotMinutes }, session.userId);
      await audit(tx, {
        action: "APPOINTMENT_RESCHEDULED",
        targetType: "appointment",
        targetId: moved.id,
        patientId: moved.patientId,
        details: { from: moved.previousStartsAt.toISOString(), to: moved.startsAt.toISOString(), previousId: input.id },
      });
      return { id: moved.id };
    }),
);

export const addLeaveAction = clinicAction(
  {
    name: "schedules.addLeave",
    permission: "settings:manage",
    schema: z.object({ doctorId: idField, date: dateField, reason: requiredText(200, "A reason") }),
  },
  async ({ session, db, audit }, input) =>
    db(async (tx) => {
      const result = await addLeave(tx, session.clinicId, { ...input, timeZone: session.timezone }, session.userId);
      await audit(tx, { action: "DOCTOR_LEAVE_ADDED", targetType: "user", targetId: input.doctorId, details: { date: input.date, affected: result.affected } });
      return result;
    }),
);

export const removeLeaveAction = clinicAction(
  { name: "schedules.removeLeave", permission: "settings:manage", schema: z.object({ id: idField }) },
  async ({ db, audit }, input) =>
    db(async (tx) => {
      const row = await removeLeave(tx, input.id);
      await audit(tx, { action: "DOCTOR_LEAVE_REMOVED", targetType: "user", targetId: row.doctorId, details: { date: row.date } });
    }),
);
