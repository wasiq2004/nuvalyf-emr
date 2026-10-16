import "server-only";

import { and, asc, eq } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import { doctorServices, roles, schedules, services, userRoles, users } from "@/lib/db/schema";
import { AppError } from "@/lib/errors";
import { normalizeTimeString } from "@/lib/time";
import { findOverlap, type ScheduleWindow } from "./schedule-rules";

export async function listDoctors(tx: Tx, { activeOnly = true } = {}) {
  const rows = await tx
    .select({
      id: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
      title: users.title,
      specialty: users.specialty,
      registrationNumber: users.registrationNumber,
      status: users.status,
    })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.userId, users.id))
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(eq(roles.key, "doctor"))
    .orderBy(asc(users.firstName), asc(users.lastName));
  return activeOnly ? rows.filter((d) => d.status === "active") : rows;
}

async function assertDoctor(tx: Tx, doctorId: string) {
  const [row] = await tx
    .select({ id: users.id })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.userId, users.id))
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(and(eq(users.id, doctorId), eq(roles.key, "doctor")))
    .limit(1);
  if (!row) throw new AppError("That staff member does not hold the Doctor role.");
}

export async function getDoctorSchedule(tx: Tx, doctorId: string) {
  const windows = await tx
    .select({ weekday: schedules.weekday, startTime: schedules.startTime, endTime: schedules.endTime })
    .from(schedules)
    .where(eq(schedules.doctorId, doctorId))
    .orderBy(asc(schedules.weekday), asc(schedules.startTime));
  const offered = await tx
    .select({ serviceId: doctorServices.serviceId })
    .from(doctorServices)
    .where(eq(doctorServices.doctorId, doctorId));

  return {
    windows: windows.map((w) => ({
      weekday: w.weekday,
      startTime: normalizeTimeString(w.startTime),
      endTime: normalizeTimeString(w.endTime),
    })),
    serviceIds: offered.map((o) => o.serviceId),
  };
}

/** Replaces a doctor's whole weekly schedule and service list atomically. */
export async function replaceDoctorSchedule(
  tx: Tx,
  clinicId: string,
  doctorId: string,
  input: { windows: ScheduleWindow[]; serviceIds: string[] },
) {
  await assertDoctor(tx, doctorId);

  const overlap = findOverlap(input.windows);
  if (overlap) throw new AppError(overlap);

  if (input.serviceIds.length > 0) {
    const known = await tx.select({ id: services.id }).from(services);
    const knownIds = new Set(known.map((s) => s.id));
    if (input.serviceIds.some((id) => !knownIds.has(id))) throw new AppError("Unknown service selected.");
  }

  await tx.delete(schedules).where(eq(schedules.doctorId, doctorId));
  if (input.windows.length > 0) {
    await tx.insert(schedules).values(input.windows.map((w) => ({ clinicId, doctorId, ...w })));
  }

  await tx.delete(doctorServices).where(eq(doctorServices.doctorId, doctorId));
  if (input.serviceIds.length > 0) {
    await tx.insert(doctorServices).values(input.serviceIds.map((serviceId) => ({ clinicId, doctorId, serviceId })));
  }
}
