"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/guards";
import { logAuditAction } from "@/lib/audit";
import { toActionError } from "@/lib/errors";
import { normalizeTimeString } from "@/lib/time";
import { availabilitySchema } from "./doctor-availability.schema";
import { upsertDoctorAvailability } from "./doctor-availability.service";

type ActionState = {
  success?: boolean;
  error?: string;
};

export async function updateAvailabilityAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const user = await requireUser(["doctor"]);

    const slotsString = formData.get("slots");
    if (typeof slotsString !== "string") {
      return { error: "No schedule data received" };
    }

    let rawSlots: unknown;
    try {
      rawSlots = JSON.parse(slotsString);
    } catch {
      return { error: "Invalid schedule data" };
    }
    if (!Array.isArray(rawSlots)) {
      return { error: "Invalid schedule data" };
    }

    // Normalize "HH:mm:ss" to "HH:mm" before validating.
    const normalizedSlots = rawSlots.map((slot: Record<string, unknown>) => ({
      dayOfWeek: slot?.dayOfWeek,
      startTime: normalizeTimeString(String(slot?.startTime ?? "")),
      endTime: normalizeTimeString(String(slot?.endTime ?? "")),
    }));

    const validated = availabilitySchema.safeParse({ slots: normalizedSlots });
    if (!validated.success) {
      return { error: validated.error.issues[0]?.message || "Validation error" };
    }

    await upsertDoctorAvailability(user.id, validated.data.slots);

    await logAuditAction({
      userId: user.id,
      action: "UPDATE_AVAILABILITY",
      resource: "doctor_availability",
      details: `${validated.data.slots.length} working day(s)`,
    });

    revalidatePath("/doctor/availability");
    return { success: true };
  } catch (error) {
    return toActionError(error, "Failed to update availability. Please try again.");
  }
}
