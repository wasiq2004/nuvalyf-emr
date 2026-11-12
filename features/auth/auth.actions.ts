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
import { beginMfaSetup, finishMfaSetup, newMfaRecoveryCodes, turnOffMfa } from "./mfa.service";
import { clinicMfaRequired } from "./mfa";

const signInSchema = z.object({
  clinicCode: z.string().trim().min(1, "Enter your clinic code"),
  email: z.string().trim().min(1, "Enter your email"),
  password: z.string().min(1, "Enter your password"),
  code: z.string().trim().max(20).optional(),
});

const REFUSALS: Record<string, string> = {
  rate_limited: "Too many sign-in attempts. Wait 15 minutes and try again.",
  clinic_suspended: "This clinic's account is suspended. Contact your clinic administrator.",
  account_disabled: "Your account is disabled. Contact your clinic administrator.",
};

/** The form shows the code box when it sees a "code" field error. */
const MFA_PROMPTS: Record<string, string> = {
  mfa_required: "Enter the 6-digit code from your authenticator app.",
  mfa_invalid: "That code is not right. Enter the newest code, or one of your recovery codes.",
};

export async function clinicSignInAction(formData: FormData): Promise<ActionResult> {
  const parsed = signInSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Enter your sign-in details.");

  try {
    await clinicSignIn("clinic", { ...parsed.data, redirect: false });
  } catch (error) {
    if (error instanceof CredentialsSignin) {
      if (MFA_PROMPTS[error.code]) return fail(MFA_PROMPTS[error.code], { code: MFA_PROMPTS[error.code] });
      return fail(REFUSALS[error.code] ?? "Incorrect clinic code, email or password.");
    }
    if (error instanceof AuthError) return fail("Incorrect clinic code, email or password.");
    throw error;
  }
  return ok();
}

const codeField = z.object({ code: z.string({ message: "Enter the code" }).trim().min(6, "Enter the 6-digit code").max(20) });

export const beginMfaSetupAction = clinicAction(
  { name: "account.beginTwoStep", permission: null, schema: z.object({}), allowPendingMfa: true },
  async ({ session, db }) => db((tx) => beginMfaSetup(tx, session.userId)),
);

export const finishMfaSetupAction = clinicAction(
  { name: "account.finishTwoStep", permission: null, schema: codeField, allowPendingMfa: true },
  async ({ session, db, audit }, input) =>
    db(async (tx) => {
      const result = await finishMfaSetup(tx, session.userId, input.code);
      await audit(tx, { action: "MFA_ENABLED", targetType: "user", targetId: session.userId });
      return result;
    }),
);

export const newMfaRecoveryCodesAction = clinicAction(
  { name: "account.newRecoveryCodes", permission: null, schema: codeField },
  async ({ session, db, audit }, input) =>
    db(async (tx) => {
      const result = await newMfaRecoveryCodes(tx, session.userId, input.code);
      await audit(tx, { action: "MFA_RECOVERY_CODES_RENEWED", targetType: "user", targetId: session.userId });
      return result;
    }),
);

export const turnOffMfaAction = clinicAction(
  { name: "account.turnOffTwoStep", permission: null, schema: codeField },
  async ({ session, db, audit }, input) =>
    db(async (tx) => {
      await turnOffMfa(tx, session.userId, input.code, clinicMfaRequired(session.roleKeys));
      await audit(tx, { action: "MFA_DISABLED", targetType: "user", targetId: session.userId, severity: "warning" });
    }),
);

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
