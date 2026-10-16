"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { AuthError, CredentialsSignin } from "next-auth";
import { clinicSignIn, clinicSignOut, updateClinicSession } from "@/lib/auth/clinic-auth";
import { sessionProof } from "@/lib/auth/session-proof";
import { withAppConnection } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { AppError } from "@/lib/errors";
import { clinicAction } from "@/lib/auth/actions";
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { STAFF_PASSWORD_MIN } from "@/lib/auth/passwords";
import { passwordChangeSchema } from "@/lib/validation";
import { changeOwnPassword } from "./account.service";

const signInSchema = z.object({
  clinicCode: z.string().trim().min(1, "Enter your clinic code"),
  email: z.string().trim().min(1, "Enter your email"),
  password: z.string().min(1, "Enter your password"),
});

const REFUSALS: Record<string, string> = {
  rate_limited: "Too many sign-in attempts. Wait 15 minutes and try again.",
  clinic_suspended: "This clinic's account is suspended. Contact your clinic administrator.",
  account_disabled: "Your account is disabled. Contact your clinic administrator.",
};

export async function clinicSignInAction(formData: FormData): Promise<ActionResult> {
  const parsed = signInSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Enter your sign-in details.");

  try {
    await clinicSignIn("clinic", { ...parsed.data, redirect: false });
  } catch (error) {
    if (error instanceof CredentialsSignin) {
      return fail(REFUSALS[error.code] ?? "Incorrect clinic code, email or password.");
    }
    if (error instanceof AuthError) return fail("Incorrect clinic code, email or password.");
    throw error;
  }
  return ok();
}

export async function clinicSignOutAction() {
  await clinicSignOut({ redirect: false });
  redirect("/login");
}

export const changeOwnPasswordAction = clinicAction(
  {
    name: "account.changePassword",
    permission: null,
    schema: passwordChangeSchema(STAFF_PASSWORD_MIN),
    allowPendingPasswordChange: true,
  },
  async ({ session, db, audit }, input) => {
    // Counted outside the transaction: a wrong password rolls that back.
    const { allowed } = await withAppConnection((conn) => rateLimit(conn, `password-change:clinic:${session.userId}`, { limit: 5, windowMs: 15 * 60_000 }));
    if (!allowed) throw new AppError("Too many attempts. Wait 15 minutes and try again.");
    const sessionVersion = await db(async (tx) => {
      const sv = await changeOwnPassword(tx, {
        userId: session.userId,
        currentPassword: input.currentPassword,
        newPassword: input.newPassword,
      });
      await audit(tx, { action: "PASSWORD_CHANGED", targetType: "user", targetId: session.userId });
      return sv;
    });
    // Other sessions end; this one continues on the new version.
    await updateClinicSession({ sv: sessionVersion, proof: sessionProof(process.env.AUTH_SECRET, session.userId, sessionVersion) });
    return { home: session.home };
  },
);
