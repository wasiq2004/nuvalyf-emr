import "server-only";

import { and, asc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import { appointments, doctorServices, patients, scheduleExceptions, schedules, services, users, visits } from "@/lib/db/schema";
import { AppError, isConcurrentConflict, isUniqueViolation } from "@/lib/errors";
import { addDaysToDateString, dayOfWeekFromDateString, todayInTimeZone, zonedTimeToUtc } from "@/lib/time";
import { displayPatientName } from "@/features/patients/patient-rules";
import { listDoctors } from "./schedules.service";
import { computeAvailableSlots, type Slot } from "./slots";

export const MAX_BOOKING_DAYS_AHEAD = 120;

export async function getBookingOptions(tx: Tx) {
  const [doctors, activeServices, offered] = await Promise.all([
    listDoctors(tx),
    tx.select().from(services).where(eq(services.isActive, true)).orderBy(asc(services.name)),
    tx.select().from(doctorServices),
  ]);

  return {
    doctors: doctors.map((d) => ({
      id: d.id,
      name: [d.title, d.firstName, d.lastName].filter(Boolean).join(" "),
      specialty: d.specialty,
      // A doctor with no explicit list offers every active service.
      serviceIds: offered.some((o) => o.doctorId === d.id)
        ? offered.filter((o) => o.doctorId === d.id).map((o) => o.serviceId)
        : activeServices.map((s) => s.id),
    })),
    services: activeServices.map((s) => ({ id: s.id, name: s.name, durationMinutes: s.durationMinutes, price: s.price })),
  };
}

function dayBounds(date: string, timeZone: string) {
  return { start: zonedTimeToUtc(date, "00:00", timeZone), end: zonedTimeToUtc(addDaysToDateString(date, 1), "00:00", timeZone) };
}

export async function getAvailableSlots(
  tx: Tx,
  input: { doctorId: string; serviceId: string; date: string; timeZone: string; gridMinutes: number; now?: Date },
): Promise<Slot[]> {
  const now = input.now ?? new Date();
  const today = todayInTimeZone(input.timeZone, now);
  if (input.date < today || input.date > addDaysToDateString(today, MAX_BOOKING_DAYS_AHEAD)) return [];

  const options = await getBookingOptions(tx);
  const doctor = options.doctors.find((d) => d.id === input.doctorId);
  if (!doctor) throw new AppError("Doctor not found.");
  const service = options.services.find((s) => s.id === input.serviceId);
  if (!service) throw new AppError("Service not found.");
  if (!doctor.serviceIds.includes(service.id)) throw new AppError(`${doctor.name} does not offer ${service.name}.`);
  if (await leaveOn(tx, input.doctorId, input.date)) return [];

  const windows = await tx
    .select({ startTime: schedules.startTime, endTime: schedules.endTime })
    .from(schedules)
    .where(and(eq(schedules.doctorId, input.doctorId), eq(schedules.weekday, dayOfWeekFromDateString(input.date))));
  if (windows.length === 0) return [];

  const { start, end } = dayBounds(input.date, input.timeZone);
  const busy = await tx
    .select({ start: appointments.startsAt, end: appointments.endsAt })
    .from(appointments)
    .where(
      and(
        eq(appointments.doctorId, input.doctorId),
        lt(appointments.startsAt, end),
        gte(appointments.endsAt, start),
        inArray(appointments.status, ["booked", "checked_in", "completed"]),
      ),
    );

  return computeAvailableSlots({
    date: input.date,
    windows,
    busy,
    now,
    timeZone: input.timeZone,
    gridMinutes: input.gridMinutes,
    durationMinutes: service.durationMinutes,
  });
}

const SLOT_TAKEN = "That time was just taken. Please choose another slot.";

export async function bookAppointment(
  tx: Tx,
  clinicId: string,
  input: {
    patientId: string;
    doctorId: string;
    serviceId: string;
    date: string;
    time: string;
    notes?: string;
    timeZone: string;
    gridMinutes: number;
  },
  actorId: string,
) {
  const [patient] = await tx.select({ id: patients.id }).from(patients).where(eq(patients.id, input.patientId)).limit(1);
  if (!patient) throw new AppError("Patient not found.");
  const leave = await leaveOn(tx, input.doctorId, input.date);
  if (leave) throw new AppError(`The doctor is away on ${input.date} (${leave.reason}).`);

  // Re-derive availability on the server; never trust the client's slot list.
  const slots = await getAvailableSlots(tx, input);
  const slot = slots.find((s) => s.time === input.time);
  if (!slot) throw new AppError(SLOT_TAKEN);

  try {
    const [row] = await tx
      .insert(appointments)
      .values({
        clinicId,
        patientId: input.patientId,
        doctorId: input.doctorId,
        serviceId: input.serviceId,
        startsAt: new Date(slot.startsAt),
        endsAt: new Date(slot.endsAt),
        notes: input.notes ?? null,
        createdBy: actorId,
      })
      .returning({ id: appointments.id, startsAt: appointments.startsAt });
    return row;
  } catch (error) {
    // The exclusion constraint catches two bookings racing for one slot.
    if (isConcurrentConflict(error)) throw new AppError(SLOT_TAKEN);
    throw error;
  }
}

export type DayAppointment = {
  id: string;
  startsAt: Date;
  endsAt: Date;
  status: string;
  notes: string | null;
  patientId: string;
  patientName: string;
  patientMrn: string;
  patientMobile: string | null;
  doctorId: string;
  doctorName: string;
  serviceId: string | null;
  serviceName: string | null;
  visitId: string | null;
};

export async function listAppointmentsForDay(
  tx: Tx,
  input: { date: string; timeZone: string; doctorId?: string },
): Promise<DayAppointment[]> {
  const { start, end } = dayBounds(input.date, input.timeZone);
  const rows = await tx
    .select({
      appointment: appointments,
      patient: patients,
      doctorFirst: users.firstName,
      doctorLast: users.lastName,
      doctorTitle: users.title,
      serviceName: services.name,
      visitId: visits.id,
    })
    .from(appointments)
    .innerJoin(patients, eq(patients.id, appointments.patientId))
    .innerJoin(users, eq(users.id, appointments.doctorId))
    .leftJoin(services, eq(services.id, appointments.serviceId))
    .leftJoin(visits, eq(visits.appointmentId, appointments.id))
    .where(
      and(
        gte(appointments.startsAt, start),
        lt(appointments.startsAt, end),
        input.doctorId ? eq(appointments.doctorId, input.doctorId) : undefined,
      ),
    )
    .orderBy(asc(appointments.startsAt));

  return rows.map((r) => ({
    id: r.appointment.id,
    startsAt: r.appointment.startsAt,
    endsAt: r.appointment.endsAt,
    status: r.appointment.status,
    notes: r.appointment.notes,
    patientId: r.patient.id,
    patientName: displayPatientName(r.patient),
    patientMrn: r.patient.mrn,
    patientMobile: r.patient.mobile,
    doctorId: r.appointment.doctorId,
    serviceId: r.appointment.serviceId,
    doctorName: [r.doctorTitle, r.doctorFirst, r.doctorLast].filter(Boolean).join(" "),
    serviceName: r.serviceName,
    visitId: r.visitId,
  }));
}

export async function listPatientAppointments(tx: Tx, patientId: string) {
  return tx
    .select({
      id: appointments.id,
      startsAt: appointments.startsAt,
      status: appointments.status,
      serviceName: services.name,
      doctorFirst: users.firstName,
      doctorLast: users.lastName,
      doctorTitle: users.title,
    })
    .from(appointments)
    .innerJoin(users, eq(users.id, appointments.doctorId))
    .leftJoin(services, eq(services.id, appointments.serviceId))
    .where(eq(appointments.patientId, patientId))
    .orderBy(sql`${appointments.startsAt} desc`)
    .limit(50);
}

async function loadAppointment(tx: Tx, id: string) {
  const [row] = await tx.select().from(appointments).where(eq(appointments.id, id)).limit(1);
  if (!row) throw new AppError("Appointment not found.");
  return row;
}

/**
 * Moves a booked appointment to another slot in one step. The old booking is
 * released and the new one taken in the same transaction: if the new slot is
 * gone, nothing changes.
 */
export async function rescheduleAppointment(
  tx: Tx,
  clinicId: string,
  id: string,
  input: { date: string; time: string; timeZone: string; gridMinutes: number },
  actorId: string,
) {
  const [current] = await tx.select().from(appointments).where(eq(appointments.id, id)).for("update").limit(1);
  if (!current) throw new AppError("Appointment not found.");
  if (current.status !== "booked") throw new AppError(`A ${current.status.replace("_", " ")} appointment cannot be moved.`);
  if (!current.serviceId) throw new AppError("This appointment has no service; book a new one instead.");
  await tx
    .update(appointments)
    .set({ status: "cancelled", cancelReason: `Rescheduled to ${input.date} ${input.time}`, updatedAt: new Date() })
    .where(eq(appointments.id, id));
  const moved = await bookAppointment(
    tx,
    clinicId,
    { patientId: current.patientId, doctorId: current.doctorId, serviceId: current.serviceId, date: input.date, time: input.time, notes: current.notes ?? undefined, timeZone: input.timeZone, gridMinutes: input.gridMinutes },
    actorId,
  );
  return { id: moved.id, startsAt: moved.startsAt, previousStartsAt: current.startsAt, patientId: current.patientId };
}

// ---------------------------------------------------------------------------
// Leave days
// ---------------------------------------------------------------------------

export async function leaveOn(tx: Tx, doctorId: string, date: string) {
  const [row] = await tx
    .select()
    .from(scheduleExceptions)
    .where(and(eq(scheduleExceptions.doctorId, doctorId), eq(scheduleExceptions.date, date)))
    .limit(1);
  return row ?? null;
}

export async function listLeave(tx: Tx, doctorId: string, fromDate: string) {
  const rows = await tx
    .select()
    .from(scheduleExceptions)
    .where(and(eq(scheduleExceptions.doctorId, doctorId), gte(scheduleExceptions.date, fromDate)))
    .orderBy(scheduleExceptions.date);
  return rows;
}

/** Marks a doctor away for a day. Returns how many bookings that day still need moving. */
export async function addLeave(tx: Tx, clinicId: string, input: { doctorId: string; date: string; reason: string; timeZone: string }, actorId: string) {
  const [doctor] = await tx.select({ id: users.id }).from(users).where(eq(users.id, input.doctorId)).limit(1);
  if (!doctor) throw new AppError("Doctor not found.");
  try {
    await tx.insert(scheduleExceptions).values({ clinicId, doctorId: input.doctorId, date: input.date, reason: input.reason, createdBy: actorId });
  } catch (error) {
    if (isUniqueViolation(error)) throw new AppError("That day is already marked as leave.");
    throw error;
  }
  return { affected: await bookedOn(tx, input.doctorId, input.date, input.timeZone) };
}

export async function removeLeave(tx: Tx, id: string) {
  const [row] = await tx.delete(scheduleExceptions).where(eq(scheduleExceptions.id, id)).returning();
  if (!row) throw new AppError("Leave day not found.");
  return row;
}

/** Booked appointments for a doctor on a day (e.g. ones that clash with leave). */
export async function bookedOn(tx: Tx, doctorId: string, date: string, timeZone: string) {
  const { start, end } = dayBounds(date, timeZone);
  const rows = await tx
    .select({ id: appointments.id })
    .from(appointments)
    .where(and(eq(appointments.doctorId, doctorId), eq(appointments.status, "booked"), gte(appointments.startsAt, start), lt(appointments.startsAt, end)));
  return rows.length;
}

export async function cancelAppointment(tx: Tx, id: string, reason: string) {
  const current = await loadAppointment(tx, id);
  if (current.status !== "booked") throw new AppError(`A ${current.status.replace("_", " ")} appointment cannot be cancelled.`);
  await tx
    .update(appointments)
    .set({ status: "cancelled", cancelReason: reason, updatedAt: new Date() })
    .where(and(eq(appointments.id, id), eq(appointments.status, "booked")));
  return current;
}

export async function markNoShow(tx: Tx, id: string, now = new Date()) {
  const current = await loadAppointment(tx, id);
  if (current.status !== "booked") throw new AppError("Only a booked appointment can be marked as a no-show.");
  if (current.startsAt > now) throw new AppError("The appointment time has not arrived yet.");
  await tx
    .update(appointments)
    .set({ status: "no_show", updatedAt: new Date() })
    .where(and(eq(appointments.id, id), eq(appointments.status, "booked")));
  return current;
}

/** Marks the patient ARRIVED: the appointment becomes checked in and a visit joins the queue. */
export async function checkInAppointment(tx: Tx, clinicId: string, id: string, actorId: string, today: string) {
  const current = await loadAppointment(tx, id);
  if (current.status !== "booked") throw new AppError("Only a booked appointment can be checked in.");

  const updated = await tx
    .update(appointments)
    .set({ status: "checked_in", updatedAt: new Date() })
    .where(and(eq(appointments.id, id), eq(appointments.status, "booked")))
    .returning({ id: appointments.id });
  if (updated.length === 0) throw new AppError("This appointment was just updated. Refresh and try again.");

  const [visit] = await tx
    .insert(visits)
    .values({
      clinicId,
      patientId: current.patientId,
      appointmentId: current.id,
      doctorId: current.doctorId,
      serviceId: current.serviceId,
      visitDate: today,
      checkedInBy: actorId,
    })
    .returning({ id: visits.id });
  return { visitId: visit.id, patientId: current.patientId };
}

/** Somebody already standing there: straight into the queue. */
export async function addWalkIn(
  tx: Tx,
  clinicId: string,
  input: { patientId: string; doctorId?: string | null; serviceId?: string | null },
  actorId: string,
  today: string,
) {
  const [patient] = await tx.select({ id: patients.id }).from(patients).where(eq(patients.id, input.patientId)).limit(1);
  if (!patient) throw new AppError("Patient not found.");

  const [already] = await tx
    .select({ id: visits.id })
    .from(visits)
    .where(
      and(
        eq(visits.patientId, input.patientId),
        eq(visits.visitDate, today),
        inArray(visits.status, ["waiting", "in_triage", "ready", "with_doctor"]),
      ),
    )
    .limit(1);
  if (already) throw new AppError("This patient is already in today's queue.");

  const [visit] = await tx
    .insert(visits)
    .values({
      clinicId,
      patientId: input.patientId,
      doctorId: input.doctorId ?? null,
      serviceId: input.serviceId ?? null,
      visitDate: today,
      checkedInBy: actorId,
    })
    .returning({ id: visits.id });
  return visit;
}
