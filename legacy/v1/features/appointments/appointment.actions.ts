"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/auth/guards";
import { logAuditAction } from "@/lib/audit";
import { toActionError } from "@/lib/errors";
import {
  appointmentActionSchema,
  bookAppointmentSchema,
  slotQuerySchema,
} from "./appointment.schema";
import { changeAppointmentStatus, createAppointment, getAvailableSlots } from "./appointment.service";
import type { Slot } from "./appointment.slots";
import type { AppointmentAction } from "./appointment.policy";

type Failure = { success?: false; error: string };

function revalidateAppointmentViews() {
  revalidatePath("/patient", "layout");
  revalidatePath("/doctor", "layout");
  revalidatePath("/admin", "layout");
}

export async function getAvailableSlotsAction(
  doctorId: string,
  date: string,
): Promise<{ success: true; slots: Slot[] } | Failure> {
  try {
    await requireUser(["patient"]);

    const parsed = slotQuerySchema.safeParse({ doctorId, date });
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid request" };

    const slots = await getAvailableSlots(parsed.data.doctorId, parsed.data.date);
    return { success: true, slots };
  } catch (error) {
    return toActionError(error, "Failed to load available slots");
  }
}

export async function bookAppointmentAction(input: {
  doctorId: string;
  date: string;
  time: string;
  notes?: string;
}): Promise<{ success: true } | Failure> {
  try {
    const user = await requireUser(["patient"]);

    const parsed = bookAppointmentSchema.safeParse(input);
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid booking" };

    const appointment = await createAppointment({ patientUserId: user.id, ...parsed.data });

    await logAuditAction({
      userId: user.id,
      action: "BOOK_APPOINTMENT",
      resource: "appointments",
      resourceId: appointment.id,
      details: `Doctor ${parsed.data.doctorId} at ${appointment.startsAt.toISOString()}`,
    });

    revalidateAppointmentViews();
    return { success: true };
  } catch (error) {
    return toActionError(error, "Booking failed. Please try again.");
  }
}

const AUDIT_ACTION: Record<AppointmentAction, string> = {
  confirm: "CONFIRM_APPOINTMENT",
  complete: "COMPLETE_APPOINTMENT",
  cancel: "CANCEL_APPOINTMENT",
};

export async function updateAppointmentStatusAction(
  appointmentId: string,
  action: AppointmentAction,
): Promise<{ success: true } | Failure> {
  try {
    const user = await requireUser(["patient", "doctor"]);

    const parsed = appointmentActionSchema.safeParse({ appointmentId, action });
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid request" };

    const result = await changeAppointmentStatus({
      actor: { id: user.id, role: user.role as "patient" | "doctor" },
      appointmentId: parsed.data.appointmentId,
      action: parsed.data.action,
    });

    await logAuditAction({
      userId: user.id,
      action: AUDIT_ACTION[parsed.data.action],
      resource: "appointments",
      resourceId: result.id,
      details: `${result.from} -> ${result.to} by ${user.role}`,
    });

    revalidateAppointmentViews();
    return { success: true };
  } catch (error) {
    return toActionError(error, "Failed to update the appointment");
  }
}
