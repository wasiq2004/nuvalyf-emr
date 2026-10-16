"use server";

import { z } from "zod";
import { clinicAction } from "@/lib/auth/actions";
import { checkbox, idField, optionalText, requiredText, stringList } from "@/lib/validation";
import { isValidTimeString, normalizeTimeString } from "@/lib/time";
import { createService, updateService } from "./services.service";
import { replaceDoctorSchedule } from "./schedules.service";

const serviceSchema = z.object({
  name: requiredText(150, "Service name"),
  description: optionalText(500),
  durationMinutes: z.coerce.number({ message: "Enter a duration" }).int("Use whole minutes").min(5).max(480),
  price: z.coerce.number({ message: "Enter a price" }).min(0, "Price cannot be negative").max(10_000_000),
  isActive: checkbox,
});

export const createServiceAction = clinicAction(
  { name: "services.create", permission: "settings:manage", schema: serviceSchema },
  async ({ session, db, audit }, input) =>
    db(async (tx) => {
      const row = await createService(tx, session.clinicId, input);
      await audit(tx, { action: "SERVICE_CREATED", targetType: "service", targetId: row.id, details: { name: input.name } });
    }),
);

export const updateServiceAction = clinicAction(
  { name: "services.update", permission: "settings:manage", schema: serviceSchema.extend({ id: idField }) },
  async ({ db, audit }, { id, ...input }) =>
    db(async (tx) => {
      await updateService(tx, id, input);
      await audit(tx, { action: "SERVICE_UPDATED", targetType: "service", targetId: id });
    }),
);

const windowSchema = z.object({
  weekday: z.number().int().min(0).max(6),
  startTime: z.string().refine((v) => isValidTimeString(normalizeTimeString(v)), "Invalid time").transform(normalizeTimeString),
  endTime: z.string().refine((v) => isValidTimeString(normalizeTimeString(v)), "Invalid time").transform(normalizeTimeString),
});

const scheduleSchema = z.object({
  doctorId: idField,
  // The schedule editor posts its windows as JSON.
  windows: z
    .string()
    .transform((value, ctx) => {
      try {
        return JSON.parse(value) as unknown;
      } catch {
        ctx.addIssue({ code: "custom", message: "Invalid schedule data" });
        return z.NEVER;
      }
    })
    .pipe(z.array(windowSchema).max(50, "Too many working windows")),
  serviceIds: stringList.pipe(z.array(idField)),
});

export const saveDoctorScheduleAction = clinicAction(
  { name: "schedules.save", permission: "settings:manage", schema: scheduleSchema },
  async ({ session, db, audit }, input) =>
    db(async (tx) => {
      await replaceDoctorSchedule(tx, session.clinicId, input.doctorId, { windows: input.windows, serviceIds: input.serviceIds });
      await audit(tx, {
        action: "SCHEDULE_UPDATED",
        targetType: "user",
        targetId: input.doctorId,
        details: { windows: input.windows.length, services: input.serviceIds.length },
      });
    }),
);
