"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireUser } from "@/lib/auth/guards";
import { logAuditAction } from "@/lib/audit";
import { AppError, isUniqueViolation, toActionError } from "@/lib/errors";
import { departmentSchema } from "./department.schema";
import { createDepartment, deleteDepartment } from "./department.service";

type DepartmentActionState = { success?: boolean; error?: string } | null;

export async function createDepartmentAction(
  _prev: DepartmentActionState,
  formData: FormData,
): Promise<DepartmentActionState> {
  try {
    const user = await requireUser(["admin"]);

    const parsed = departmentSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
    }

    const department = await createDepartment(parsed.data.name, parsed.data.description);

    await logAuditAction({
      userId: user.id,
      action: "CREATE_DEPARTMENT",
      resource: "departments",
      resourceId: department.id,
      details: department.name,
    });

    revalidatePath("/admin", "layout");
    return { success: true };
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { error: "A department with this name already exists" };
    }
    return toActionError(error);
  }
}

export async function deleteDepartmentAction(id: string): Promise<DepartmentActionState> {
  try {
    const user = await requireUser(["admin"]);

    if (!z.uuid().safeParse(id).success) throw new AppError("Invalid department");

    const deleted = await deleteDepartment(id);
    if (deleted.length === 0) throw new AppError("Department not found");

    await logAuditAction({
      userId: user.id,
      action: "DELETE_DEPARTMENT",
      resource: "departments",
      resourceId: id,
    });

    revalidatePath("/admin", "layout");
    return { success: true };
  } catch (error) {
    return toActionError(error);
  }
}
