import "server-only";

// Two-step sign-in rules shared by clinic staff and console operators. Both
// tables carry the same columns (mfa_secret, mfa_pending_secret,
// mfa_enabled_at, mfa_last_step, mfa_recovery_hashes).
import { BRAND } from "@/lib/brand";
import { AppError } from "@/lib/errors";
import { hashRecoveryCode, newRecoveryCodes, newTotpSecret, otpauthUri, consumeRecoveryCode, verifyTotp } from "@/lib/auth/totp";

export type MfaRow = {
  mfaSecret: string | null;
  mfaPendingSecret: string | null;
  mfaEnabledAt: Date | null;
  mfaLastStep: number | null;
  mfaRecoveryHashes: string[];
};

export type MfaUpdate = Partial<{ mfaSecret: string | null; mfaPendingSecret: string | null; mfaEnabledAt: Date | null; mfaLastStep: number | null; mfaRecoveryHashes: string[] }>;

export const MFA_OFF: MfaUpdate = { mfaSecret: null, mfaPendingSecret: null, mfaEnabledAt: null, mfaLastStep: null, mfaRecoveryHashes: [] };

/** Clinic Admins and every console operator must use two-step sign-in. */
export function clinicMfaRequired(roleKeys: readonly string[]): boolean {
  return roleKeys.includes("clinic_admin");
}

export type SecondFactor = { ok: true; update: MfaUpdate; method: "totp" | "recovery"; recoveryLeft: number } | { ok: false };

/** Checks an authenticator code, or a recovery code (used up on success). */
export function checkSecondFactor(row: MfaRow, code: string, now: Date): SecondFactor {
  if (!row.mfaEnabledAt || !row.mfaSecret) return { ok: false };
  const step = verifyTotp(row.mfaSecret, code, now.getTime(), row.mfaLastStep);
  if (step !== null) return { ok: true, update: { mfaLastStep: step }, method: "totp", recoveryLeft: row.mfaRecoveryHashes.length };
  const left = consumeRecoveryCode(row.mfaRecoveryHashes, code);
  if (left) return { ok: true, update: { mfaRecoveryHashes: left }, method: "recovery", recoveryLeft: left.length };
  return { ok: false };
}

/** Step one: a new secret, kept as pending until a code from it is entered. */
export function startEnrollment(account: string) {
  const secret = newTotpSecret();
  return { secret, uri: otpauthUri(BRAND.name, account, secret), update: { mfaPendingSecret: secret } satisfies MfaUpdate };
}

/** Step two: a code from the app proves it holds the secret. Returns the recovery codes, shown once. */
export function confirmEnrollment(row: MfaRow, code: string, now: Date) {
  if (!row.mfaPendingSecret) throw new AppError("Start again: no setup is in progress.");
  const step = verifyTotp(row.mfaPendingSecret, code, now.getTime(), null);
  if (step === null) throw new AppError("That code does not match. Check the time on your phone is set automatically, and enter the newest code.");
  const recoveryCodes = newRecoveryCodes();
  const update: MfaUpdate = {
    mfaSecret: row.mfaPendingSecret,
    mfaPendingSecret: null,
    mfaEnabledAt: now,
    mfaLastStep: step,
    mfaRecoveryHashes: recoveryCodes.map(hashRecoveryCode),
  };
  return { recoveryCodes, update };
}

/** New recovery codes, after proving possession of the phone. */
export function regenerateRecoveryCodes(row: MfaRow, code: string, now: Date) {
  const check = checkSecondFactor(row, code, now);
  if (!check.ok) throw new AppError("That code does not match.");
  const recoveryCodes = newRecoveryCodes();
  return { recoveryCodes, update: { ...check.update, mfaRecoveryHashes: recoveryCodes.map(hashRecoveryCode) } satisfies MfaUpdate };
}

/** Switching it off needs a current code, and is refused where it is required. */
export function disableOwn(row: MfaRow, code: string, now: Date, required: boolean): MfaUpdate {
  if (required) throw new AppError("Two-step sign-in is required for your role and cannot be switched off.");
  if (!checkSecondFactor(row, code, now).ok) throw new AppError("That code does not match.");
  return MFA_OFF;
}
