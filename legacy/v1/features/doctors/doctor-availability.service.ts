import "server-only";

import { db } from "@/lib/db";
import { doctors, doctorAvailability } from "@/lib/db/schema";
import { eq, isNull, and, asc } from "drizzle-orm";
import { AppError } from "@/lib/errors";
import { normalizeTimeString } from "@/lib/time";
import type { AvailabilitySlot } from "./doctor-availability.types";

const NO_PROFILE_MESSAGE =
  "Doctor profile not found. Please ask an administrator to set up your profile.";

export async function getDoctorAvailability(userId: string) {
  const doctorResult = await db
    .select({ id: doctors.id })
    .from(doctors)
    .where(and(eq(doctors.userId, userId), isNull(doctors.deletedAt)))
    .limit(1);

  if (doctorResult.length === 0) {
    throw new AppError(NO_PROFILE_MESSAGE);
  }

  const result = await db
    .select({
      dayOfWeek: doctorAvailability.dayOfWeek,
      startTime: doctorAvailability.startTime,
      endTime: doctorAvailability.endTime,
    })
    .from(doctorAvailability)
    .where(eq(doctorAvailability.doctorId, doctorResult[0].id))
    .orderBy(asc(doctorAvailability.dayOfWeek));

  const slots: AvailabilitySlot[] = result.map((row) => ({
    dayOfWeek: row.dayOfWeek as AvailabilitySlot["dayOfWeek"],
    startTime: normalizeTimeString(row.startTime),
    endTime: normalizeTimeString(row.endTime),
  }));

  return { slots };
}

export async function upsertDoctorAvailability(userId: string, slots: AvailabilitySlot[]) {
  return db.transaction(async (tx) => {
    const doctorResult = await tx
      .select({ id: doctors.id })
      .from(doctors)
      .where(and(eq(doctors.userId, userId), isNull(doctors.deletedAt)))
      .limit(1);

    if (doctorResult.length === 0) {
      throw new AppError(NO_PROFILE_MESSAGE);
    }

    const doctorId = doctorResult[0].id;

    await tx.delete(doctorAvailability).where(eq(doctorAvailability.doctorId, doctorId));

    if (slots.length > 0) {
      await tx.insert(doctorAvailability).values(
        slots.map((slot) => ({
          doctorId,
          dayOfWeek: slot.dayOfWeek,
          startTime: slot.startTime,
          endTime: slot.endTime,
        })),
      );
    }

    return { success: true };
  });
}
