import "server-only";

// Two-step sign-in for clinic staff: their own setup, and an administrator's
// reset when a phone is lost.
import { eq, sql } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { AppError } from "@/lib/errors";
import { MFA_OFF, confirmEnrollment, disableOwn, regenerateRecoveryCodes, startEnrollment, type MfaRow } from "./mfa";

async function row(tx: Tx, userId: string): Promise<MfaRow & { email: string }> {
  const [user] = await tx
    .select({ email: users.email, mfaSecret: users.mfaSecret, mfaPendingSecret: users.mfaPendingSecret, mfaEnabledAt: users.mfaEnabledAt, mfaLastStep: users.mfaLastStep, mfaRecoveryHashes: users.mfaRecoveryHashes })
    .from(users)
    .where(eq(users.id, userId))
    .for("update")
    .limit(1);
  if (!user) throw new AppError("Account not found.");
  return user;
}

export async function mfaStatus(tx: Tx, userId: string) {
  const r = await row(tx, userId);
  return { enabled: Boolean(r.mfaEnabledAt), enabledAt: r.mfaEnabledAt, recoveryLeft: r.mfaRecoveryHashes.length, pending: Boolean(r.mfaPendingSecret) };
}

export async function beginMfaSetup(tx: Tx, userId: string) {
  const r = await row(tx, userId);
  if (r.mfaEnabledAt) throw new AppError("Two-step sign-in is already on.");
  const { secret, uri, update } = startEnrollment(r.email);
  await tx.update(users).set({ ...update, updatedAt: new Date() }).where(eq(users.id, userId));
  return { secret, uri };
}

export async function finishMfaSetup(tx: Tx, userId: string, code: string, now = new Date()) {
  const r = await row(tx, userId);
  if (r.mfaEnabledAt) throw new AppError("Two-step sign-in is already on.");
  const { recoveryCodes, update } = confirmEnrollment(r, code, now);
  await tx.update(users).set({ ...update, updatedAt: now }).where(eq(users.id, userId));
  return { recoveryCodes };
}

export async function newMfaRecoveryCodes(tx: Tx, userId: string, code: string, now = new Date()) {
  const { recoveryCodes, update } = regenerateRecoveryCodes(await row(tx, userId), code, now);
  await tx.update(users).set({ ...update, updatedAt: now }).where(eq(users.id, userId));
  return { recoveryCodes };
}

export async function turnOffMfa(tx: Tx, userId: string, code: string, required: boolean, now = new Date()) {
  const update = disableOwn(await row(tx, userId), code, now, required);
  await tx.update(users).set({ ...update, updatedAt: now }).where(eq(users.id, userId));
}

/**
 * A lost phone: an administrator clears it. Every session ends, and anyone
 * for whom it is required sets it up again at their next sign-in.
 */
export async function resetStaffMfa(tx: Tx, userId: string, actorId: string) {
  if (userId === actorId) throw new AppError("You cannot reset your own two-step sign-in. Ask another administrator.");
  const [updated] = await tx
    .update(users)
    .set({ ...MFA_OFF, sessionVersion: sql`${users.sessionVersion} + 1`, updatedAt: new Date() })
    .where(eq(users.id, userId))
    .returning({ email: users.email });
  if (!updated) throw new AppError("Staff member not found.");
  return updated;
}
