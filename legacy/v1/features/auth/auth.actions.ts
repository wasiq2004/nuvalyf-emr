"use server";

import { AuthError, CredentialsSignin } from "next-auth";
import { registerSchema, loginSchema } from "./auth.schema";
import { createUser, getUserByEmail } from "./auth.service";
import { signIn, signOut } from "@/lib/auth";
import { createPatientProfile } from "@/features/patients/patient.service";
import { db } from "@/lib/db";
import { logAuditAction } from "@/lib/audit";
import { isUniqueViolation, toActionError } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/request";
import type { UserRole } from "@/types";

type AuthActionResult =
  | { success: true; role?: UserRole }
  | { success?: false; error: string };

export async function registerAction(formData: FormData): Promise<AuthActionResult> {
  const ip = await getClientIp();
  if (!rateLimit(`register:ip:${ip ?? "unknown"}`, { limit: 10, windowMs: 60 * 60 * 1000 }).allowed) {
    return { error: "Too many sign-up attempts. Please try again later." };
  }

  const parsed = registerSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const { email, password, firstName, lastName } = parsed.data;

  try {
    // Self-registration always creates a patient. Doctors are provisioned by
    // an admin; admins are created with `npm run db:create-admin`.
    const user = await db.transaction(async (tx) => {
      const newUser = await createUser(
        { email, password, role: "patient", firstName, lastName },
        tx,
      );
      await createPatientProfile(newUser.id, { firstName, lastName }, tx);
      return newUser;
    });

    await logAuditAction({
      userId: user.id,
      action: "USER_REGISTERED",
      resource: "users",
      resourceId: user.id,
      details: "Patient self-registration",
      ipAddress: ip,
    });

    return { success: true };
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { error: "An account with this email already exists" };
    }
    return toActionError(error);
  }
}

export async function loginAction(formData: FormData): Promise<AuthActionResult> {
  const parsed = loginSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: "Invalid email or password" };
  }

  const { email, password } = parsed.data;

  try {
    await signIn("credentials", { email, password, redirect: false });
  } catch (error: unknown) {
    if (error instanceof CredentialsSignin && error.code === "rate_limited") {
      return { error: "Too many sign-in attempts. Please wait a few minutes and try again." };
    }
    if (error instanceof AuthError) {
      return { error: "Invalid email or password" };
    }
    return toActionError(error);
  }

  const user = await getUserByEmail(email);
  if (!user) {
    return { error: "Invalid email or password" };
  }

  await logAuditAction({
    userId: user.id,
    action: "USER_LOGIN",
    resource: "users",
    resourceId: user.id,
  });

  return { success: true, role: user.role as UserRole };
}

export async function logoutAction() {
  await signOut({ redirectTo: "/login" });
}
