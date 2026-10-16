"use server";

import { revalidatePath } from "next/cache";
import { createDoctorSchema } from "./doctor.schema";
import { createUser } from "@/features/auth/auth.service";
import { createDoctorProfile } from "./doctor.service";
import { requireUser } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { logAuditAction } from "@/lib/audit";
import { isForeignKeyViolation, isUniqueViolation, toActionError } from "@/lib/errors";

type CreateDoctorState = { success?: boolean; error?: string } | null;

export async function createDoctorAction(
  _prev: CreateDoctorState,
  formData: FormData,
): Promise<CreateDoctorState> {
  try {
    const admin = await requireUser(["admin"]);

    const parsed = createDoctorSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
    }

    const { first_name, last_name, email, password, ...profile } = parsed.data;

    // User and profile are created atomically: no orphaned doctor accounts.
    const doctor = await db.transaction(async (tx) => {
      const user = await createUser(
        { email, password, role: "doctor", firstName: first_name, lastName: last_name },
        tx,
      );
      return createDoctorProfile(user.id, profile, tx);
    });

    await logAuditAction({
      userId: admin.id,
      action: "CREATE_DOCTOR",
      resource: "doctors",
      resourceId: doctor.id,
      details: `Admin created doctor account for ${email}`,
    });

    revalidatePath("/admin", "layout");
    return { success: true };
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { error: "An account with this email already exists" };
    }
    if (isForeignKeyViolation(error)) {
      return { error: "The selected department no longer exists" };
    }
    return toActionError(error);
  }
}
