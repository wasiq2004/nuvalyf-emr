import "server-only";

import { db } from "@/lib/db";
import {
  doctors,
  users,
  departments,
  doctorAvailability,
  appointments,
  patients,
} from "@/lib/db/schema";
import { eq, isNull, and, sql, gte, lt, desc, asc, ne } from "drizzle-orm";
import { CLINIC_TIMEZONE, MAX_BOOKING_DAYS_AHEAD, SLOT_MINUTES } from "@/lib/config";
import { AppError, isUniqueViolation } from "@/lib/errors";
import {
  addDaysToDateString,
  dayOfWeekFromDateString,
  todayInTimeZone,
  weekdayLabel,
  zonedTimeToUtc,
} from "@/lib/time";
import { displayName } from "@/features/auth/auth.service";
import { getPatientIdByUserId } from "@/features/patients/patient.service";
import { getDoctorIdByUserId } from "@/features/doctors/doctor.service";
import { computeAvailableSlots, type Slot } from "./appointment.slots";
import {
  ACTION_TARGET_STATUS,
  checkAppointmentAction,
  isAppointmentStatus,
  type AppointmentAction,
  type AppointmentStatus,
} from "./appointment.policy";

const notDeleted = isNull(appointments.deletedAt);
const notCancelled = ne(appointments.status, "cancelled");

/** UTC bounds of a clinic-local calendar day. */
function clinicDayBounds(date: string) {
  return {
    start: zonedTimeToUtc(date, "00:00", CLINIC_TIMEZONE),
    end: zonedTimeToUtc(addDaysToDateString(date, 1), "00:00", CLINIC_TIMEZONE),
  };
}

function toStatus(value: string | null): AppointmentStatus {
  return isAppointmentStatus(value) ? value : "pending";
}

// ---------------------------------------------------------------------------
// Slots & booking
// ---------------------------------------------------------------------------

export async function getAvailableSlots(
  doctorId: string,
  date: string,
  now: Date = new Date(),
): Promise<Slot[]> {
  const today = todayInTimeZone(CLINIC_TIMEZONE, now);
  if (date < today || date > addDaysToDateString(today, MAX_BOOKING_DAYS_AHEAD)) {
    return [];
  }

  const doctor = await db
    .select({ id: doctors.id })
    .from(doctors)
    .innerJoin(users, eq(doctors.userId, users.id))
    .where(and(eq(doctors.id, doctorId), isNull(doctors.deletedAt), isNull(users.deletedAt)))
    .limit(1);
  if (doctor.length === 0) throw new AppError("Doctor not found");

  const windows = await db
    .select({ startTime: doctorAvailability.startTime, endTime: doctorAvailability.endTime })
    .from(doctorAvailability)
    .where(
      and(
        eq(doctorAvailability.doctorId, doctorId),
        eq(doctorAvailability.dayOfWeek, dayOfWeekFromDateString(date)),
      ),
    );
  if (windows.length === 0) return [];

  const { start, end } = clinicDayBounds(date);
  const booked = await db
    .select({ startsAt: appointments.appointmentDatetime })
    .from(appointments)
    .where(
      and(
        eq(appointments.doctorId, doctorId),
        gte(appointments.appointmentDatetime, start),
        lt(appointments.appointmentDatetime, end),
        notDeleted,
        notCancelled,
      ),
    );

  return computeAvailableSlots({
    date,
    windows,
    bookedStarts: booked.map((b) => b.startsAt),
    now,
    timeZone: CLINIC_TIMEZONE,
    slotMinutes: SLOT_MINUTES,
  });
}

const SLOT_TAKEN = "That time is no longer available. Please choose another slot.";

export async function createAppointment(input: {
  patientUserId: string;
  doctorId: string;
  date: string;
  time: string;
  notes?: string;
}) {
  const patientId = await getPatientIdByUserId(input.patientUserId);
  if (!patientId) throw new AppError("Patient profile not found.");

  // Re-derive availability on the server; never trust the client's slot list.
  const slots = await getAvailableSlots(input.doctorId, input.date);
  const slot = slots.find((s) => s.time === input.time);
  if (!slot) throw new AppError(SLOT_TAKEN);

  const startsAt = new Date(slot.startsAt);

  const clash = await db
    .select({ id: appointments.id })
    .from(appointments)
    .where(
      and(
        eq(appointments.patientId, patientId),
        eq(appointments.appointmentDatetime, startsAt),
        notDeleted,
        notCancelled,
      ),
    )
    .limit(1);
  if (clash.length > 0) {
    throw new AppError("You already have another appointment at this time.");
  }

  try {
    const result = await db
      .insert(appointments)
      .values({
        patientId,
        doctorId: input.doctorId,
        appointmentDatetime: startsAt,
        notes: input.notes || null,
        status: "pending",
      })
      .returning({ id: appointments.id, startsAt: appointments.appointmentDatetime });
    return result[0];
  } catch (error) {
    // The partial unique index catches two patients racing for the same slot.
    if (isUniqueViolation(error)) throw new AppError(SLOT_TAKEN);
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Listings
// ---------------------------------------------------------------------------

export type AppointmentListItem = {
  id: string;
  startsAt: Date;
  status: AppointmentStatus;
  notes: string | null;
  counterpartName: string;
  counterpartEmail: string | null;
  department: string | null;
};

type When = "upcoming" | "past";

export async function listPatientAppointments(
  userId: string,
  when: When,
  now: Date = new Date(),
): Promise<AppointmentListItem[]> {
  const doctorUsers = users;
  const rows = await db
    .select({
      id: appointments.id,
      startsAt: appointments.appointmentDatetime,
      status: appointments.status,
      notes: appointments.notes,
      firstName: doctorUsers.firstName,
      lastName: doctorUsers.lastName,
      email: doctorUsers.email,
      department: departments.name,
    })
    .from(appointments)
    .innerJoin(patients, eq(appointments.patientId, patients.id))
    .innerJoin(doctors, eq(appointments.doctorId, doctors.id))
    .innerJoin(doctorUsers, eq(doctors.userId, doctorUsers.id))
    .leftJoin(departments, eq(doctors.departmentId, departments.id))
    .where(
      and(
        eq(patients.userId, userId),
        when === "upcoming"
          ? gte(appointments.appointmentDatetime, now)
          : lt(appointments.appointmentDatetime, now),
        notDeleted,
        isNull(patients.deletedAt),
      ),
    )
    .orderBy(
      when === "upcoming"
        ? asc(appointments.appointmentDatetime)
        : desc(appointments.appointmentDatetime),
    )
    .limit(when === "upcoming" ? 100 : 50);

  return rows.map((r) => ({
    id: r.id,
    startsAt: r.startsAt,
    status: toStatus(r.status),
    notes: r.notes,
    counterpartName: displayName(r.firstName, r.lastName) || "Doctor",
    counterpartEmail: r.email,
    department: r.department,
  }));
}

export async function listDoctorAppointments(
  userId: string,
  when: When,
  now: Date = new Date(),
): Promise<AppointmentListItem[]> {
  const patientUsers = users;
  const rows = await db
    .select({
      id: appointments.id,
      startsAt: appointments.appointmentDatetime,
      status: appointments.status,
      notes: appointments.notes,
      firstName: patientUsers.firstName,
      lastName: patientUsers.lastName,
      email: patientUsers.email,
    })
    .from(appointments)
    .innerJoin(patients, eq(appointments.patientId, patients.id))
    .innerJoin(patientUsers, eq(patients.userId, patientUsers.id))
    .innerJoin(doctors, eq(appointments.doctorId, doctors.id))
    .where(
      and(
        eq(doctors.userId, userId),
        when === "upcoming"
          ? gte(appointments.appointmentDatetime, now)
          : lt(appointments.appointmentDatetime, now),
        notDeleted,
        isNull(patients.deletedAt),
      ),
    )
    .orderBy(
      when === "upcoming"
        ? asc(appointments.appointmentDatetime)
        : desc(appointments.appointmentDatetime),
    )
    .limit(when === "upcoming" ? 100 : 50);

  return rows.map((r) => ({
    id: r.id,
    startsAt: r.startsAt,
    status: toStatus(r.status),
    notes: r.notes,
    counterpartName: displayName(r.firstName, r.lastName) || "Patient",
    counterpartEmail: r.email,
    department: null,
  }));
}

// ---------------------------------------------------------------------------
// Status changes
// ---------------------------------------------------------------------------

export async function changeAppointmentStatus(input: {
  actor: { id: string; role: "patient" | "doctor" };
  appointmentId: string;
  action: AppointmentAction;
  now?: Date;
}) {
  const now = input.now ?? new Date();

  const rows = await db
    .select({
      id: appointments.id,
      status: appointments.status,
      startsAt: appointments.appointmentDatetime,
      patientUserId: patients.userId,
      doctorUserId: doctors.userId,
    })
    .from(appointments)
    .innerJoin(patients, eq(appointments.patientId, patients.id))
    .innerJoin(doctors, eq(appointments.doctorId, doctors.id))
    .where(and(eq(appointments.id, input.appointmentId), notDeleted))
    .limit(1);

  const appointment = rows[0];
  const ownerId =
    input.actor.role === "patient" ? appointment?.patientUserId : appointment?.doctorUserId;

  // Same message for "missing" and "not yours" so IDs cannot be probed.
  if (!appointment || ownerId !== input.actor.id) {
    throw new AppError("Appointment not found");
  }

  const currentStatus = toStatus(appointment.status);
  const reason = checkAppointmentAction({
    actor: input.actor.role,
    action: input.action,
    status: currentStatus,
    startsAt: appointment.startsAt,
    now,
  });
  if (reason) throw new AppError(reason);

  const nextStatus = ACTION_TARGET_STATUS[input.action];

  // Compare-and-set on the status guards against concurrent updates.
  const updated = await db
    .update(appointments)
    .set({ status: nextStatus, updatedAt: now })
    .where(and(eq(appointments.id, appointment.id), eq(appointments.status, currentStatus)))
    .returning({ id: appointments.id, status: appointments.status });

  if (updated.length === 0) {
    throw new AppError("This appointment was just updated. Refresh the page and try again.");
  }

  return { id: appointment.id, from: currentStatus, to: nextStatus };
}

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

type DayCount = { date: string; appointments: number };

/** Next 7 clinic-local days, each with a count (zero-filled). */
async function appointmentsNext7Days(doctorId?: string): Promise<DayCount[]> {
  const today = todayInTimeZone(CLINIC_TIMEZONE);
  const start = zonedTimeToUtc(today, "00:00", CLINIC_TIMEZONE);
  const end = zonedTimeToUtc(addDaysToDateString(today, 7), "00:00", CLINIC_TIMEZONE);

  const rows = await db
    .select({
      day: sql<string>`to_char(${appointments.appointmentDatetime} AT TIME ZONE ${CLINIC_TIMEZONE}, 'YYYY-MM-DD')`,
      count: sql<number>`count(*)::int`,
    })
    .from(appointments)
    .where(
      and(
        doctorId ? eq(appointments.doctorId, doctorId) : undefined,
        gte(appointments.appointmentDatetime, start),
        lt(appointments.appointmentDatetime, end),
        notDeleted,
        notCancelled,
      ),
    )
    .groupBy(sql`1`);

  const counts = new Map(rows.map((r) => [r.day, Number(r.count)]));
  return Array.from({ length: 7 }, (_, i) => {
    const date = addDaysToDateString(today, i);
    return { date: weekdayLabel(date), appointments: counts.get(date) ?? 0 };
  });
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export async function getDoctorAnalytics(userId: string) {
  const doctorId = await getDoctorIdByUserId(userId);
  if (!doctorId) return null;

  const now = new Date();
  const isUpcoming = sql`${appointments.appointmentDatetime} >= ${now.toISOString()}::timestamptz`;

  const [totals] = await db
    .select({
      upcoming: sql<number>`count(*) filter (where ${isUpcoming} and ${notCancelled})::int`,
      past: sql<number>`count(*) filter (where not (${isUpcoming}) and ${notCancelled})::int`,
      uniquePatients: sql<number>`count(distinct ${appointments.patientId}) filter (where ${notCancelled})::int`,
    })
    .from(appointments)
    .where(and(eq(appointments.doctorId, doctorId), notDeleted));

  const statusRows = await db
    .select({ status: appointments.status, count: sql<number>`count(*)::int` })
    .from(appointments)
    .where(and(eq(appointments.doctorId, doctorId), notDeleted))
    .groupBy(appointments.status);

  return {
    totalUpcoming: Number(totals?.upcoming ?? 0),
    totalPast: Number(totals?.past ?? 0),
    uniquePatients: Number(totals?.uniquePatients ?? 0),
    statusDistribution: statusRows.map((r) => ({
      name: capitalize(r.status || "pending"),
      value: Number(r.count),
    })),
    appointmentsByDay: await appointmentsNext7Days(doctorId),
  };
}

export async function getPatientAnalytics(userId: string) {
  const patientId = await getPatientIdByUserId(userId);
  if (!patientId) return null;

  const [totals] = await db
    .select({
      totalVisits: sql<number>`count(*)::int`,
      uniqueDoctors: sql<number>`count(distinct ${appointments.doctorId})::int`,
    })
    .from(appointments)
    .where(and(eq(appointments.patientId, patientId), notDeleted, notCancelled));

  const departmentRows = await db
    .select({ department: departments.name, count: sql<number>`count(${appointments.id})::int` })
    .from(appointments)
    .innerJoin(doctors, eq(appointments.doctorId, doctors.id))
    .innerJoin(departments, eq(doctors.departmentId, departments.id))
    .where(and(eq(appointments.patientId, patientId), notDeleted, notCancelled))
    .groupBy(departments.name);

  return {
    totalVisits: Number(totals?.totalVisits ?? 0),
    uniqueDoctors: Number(totals?.uniqueDoctors ?? 0),
    departmentDistribution: departmentRows.map((r) => ({
      name: r.department,
      value: Number(r.count),
    })),
  };
}

export async function getAdminAnalytics() {
  const [doctorCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(doctors)
    .where(isNull(doctors.deletedAt));
  const [patientCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(patients)
    .where(isNull(patients.deletedAt));
  const [appointmentCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(appointments)
    .where(notDeleted);
  const [departmentCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(departments);

  const departmentRows = await db
    .select({ department: departments.name, count: sql<number>`count(${appointments.id})::int` })
    .from(appointments)
    .innerJoin(doctors, eq(appointments.doctorId, doctors.id))
    .innerJoin(departments, eq(doctors.departmentId, departments.id))
    .where(and(notDeleted, notCancelled))
    .groupBy(departments.name);

  return {
    totalDoctors: Number(doctorCount?.count ?? 0),
    totalPatients: Number(patientCount?.count ?? 0),
    totalAppointments: Number(appointmentCount?.count ?? 0),
    totalDepartments: Number(departmentCount?.count ?? 0),
    appointmentsByDay: await appointmentsNext7Days(),
    departmentDistribution: departmentRows.map((r) => ({
      name: r.department,
      value: Number(r.count),
    })),
  };
}
