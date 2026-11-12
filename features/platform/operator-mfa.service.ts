import "server-only";

// Two-step sign-in for console operators. Required for every operator.
import { eq, sql } from "drizzle-orm";
import type { Queryable } from "@/lib/db";
import { operators } from "@/lib/db/schema";
import { AppError } from "@/lib/errors";
import { MFA_OFF, confirmEnrollment, regenerateRecoveryCodes, startEnrollment, type MfaRow } from "@/features/auth/mfa";

async function row(db: Queryable, id: string): Promise<MfaRow & { email: string }> {
  const [operator] = await db
    .select({ email: operators.email, mfaSecret: operators.mfaSecret, mfaPendingSecret: operators.mfaPendingSecret, mfaEnabledAt: operators.mfaEnabledAt, mfaLastStep: operators.mfaLastStep, mfaRecoveryHashes: operators.mfaRecoveryHashes })
    .from(operators)
    .where(eq(operators.id, id))
    .limit(1);
  if (!operator) throw new AppError("Operator not found.");
  return operator;
}

export async function operatorMfaStatus(db: Queryable, id: string) {
  const r = await row(db, id);
  return { enabled: Boolean(r.mfaEnabledAt), enabledAt: r.mfaEnabledAt, recoveryLeft: r.mfaRecoveryHashes.length, pending: Boolean(r.mfaPendingSecret) };
}

export async function beginOperatorMfaSetup(db: Queryable, id: string) {
  const r = await row(db, id);
  if (r.mfaEnabledAt) throw new AppError("Two-step sign-in is already on.");
  const { secret, uri, update } = startEnrollment(r.email);
  await db.update(operators).set({ ...update, updatedAt: new Date() }).where(eq(operators.id, id));
  return { secret, uri };
}

export async function finishOperatorMfaSetup(db: Queryable, id: string, code: string, now = new Date()) {
  const r = await row(db, id);
  if (r.mfaEnabledAt) throw new AppError("Two-step sign-in is already on.");
  const { recoveryCodes, update } = confirmEnrollment(r, code, now);
  await db.update(operators).set({ ...update, updatedAt: now }).where(eq(operators.id, id));
  return { recoveryCodes };
}

export async function newOperatorRecoveryCodes(db: Queryable, id: string, code: string, now = new Date()) {
  const { recoveryCodes, update } = regenerateRecoveryCodes(await row(db, id), code, now);
  await db.update(operators).set({ ...update, updatedAt: now }).where(eq(operators.id, id));
  return { recoveryCodes };
}

/** A Platform Admin clears another operator's two-step sign-in (lost phone). */
export async function resetOperatorMfa(db: Queryable, id: string, actorId: string) {
  if (id === actorId) throw new AppError("You cannot reset your own two-step sign-in. Ask another Platform Admin.");
  const [updated] = await db
    .update(operators)
    .set({ ...MFA_OFF, sessionVersion: sql`${operators.sessionVersion} + 1`, updatedAt: new Date() })
    .where(eq(operators.id, id))
    .returning({ email: operators.email });
  if (!updated) throw new AppError("Operator not found.");
  return updated;
}
