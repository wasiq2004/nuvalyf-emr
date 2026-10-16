"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/guards";
import { logAuditAction } from "@/lib/audit";
import { toActionError } from "@/lib/errors";
import { patientProfileSchema } from "./patient.schema";
import { updatePatientProfile } from "./patient.service";

export async function updatePatientProfileAction(
  formData: FormData,
): Promise<{ success: true } | { success?: false; error: string }> {
  try {
    const user = await requireUser(["patient"]);

    const parsed = patientProfileSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
    }

    await updatePatientProfile(user.id, parsed.data);

    await logAuditAction({
      userId: user.id,
      action: "UPDATE_PROFILE",
      resource: "patients",
      resourceId: user.id,
    });

    revalidatePath("/patient", "layout");
    return { success: true };
  } catch (error) {
    return toActionError(error);
  }
}
