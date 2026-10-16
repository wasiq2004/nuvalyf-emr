import { z } from "zod";
import { isValidDateString, isValidTimeString } from "@/lib/time";

const dateString = z.string().refine(isValidDateString, "Invalid date");
const timeString = z.string().refine(isValidTimeString, "Invalid time");

export const slotQuerySchema = z.object({
  doctorId: z.uuid("Invalid doctor"),
  date: dateString,
});

export const bookAppointmentSchema = z.object({
  doctorId: z.uuid("Invalid doctor"),
  date: dateString,
  time: timeString,
  notes: z.string().trim().max(1000, "Notes are limited to 1000 characters").optional(),
});

export const appointmentActionSchema = z.object({
  appointmentId: z.uuid("Invalid appointment"),
  action: z.enum(["confirm", "complete", "cancel"]),
});

export type BookAppointmentInput = z.infer<typeof bookAppointmentSchema>;
