// Two-step sign-in, end to end through the real login and session code.
import { randomUUID } from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestClinic, META } from "./fixtures";
import { ownerSql } from "./test-db";
import { withClinic, withPlatform } from "@/lib/db";
import { verifyClinicLogin } from "@/features/auth/clinic-login.service";
import { loadClinicContext } from "@/features/auth/clinic-context.service";
import { beginMfaSetup, finishMfaSetup, mfaStatus, newMfaRecoveryCodes, resetStaffMfa, turnOffMfa } from "@/features/auth/mfa.service";
import { createStaff } from "@/features/staff/staff.service";
import { verifyOperatorLogin } from "@/features/platform/operator-login.service";
import { createOperator } from "@/features/platform/operators.service";
import { beginOperatorMfaSetup, finishOperatorMfaSetup, resetOperatorMfa } from "@/features/platform/operator-mfa.service";
import { totpCode } from "@/lib/auth/totp";
import { hashPassword } from "@/lib/auth/passwords";

const owner = ownerSql();
let clinic: Awaited<ReturnType<typeof createTestClinic>>;
let adminId: string;
const PASSWORD = "Teal-Harbour-2026";

// Set-up happens now, as for a real person. Later steps use codes from moments
// further ahead, each past the last one accepted (the replay rule).
let clock = Date.now();
const nextMoment = () => (clock += 60_000);

beforeAll(async () => {
  clinic = await createTestClinic("twostep");
  const [admin] = await owner`select id from app.users where clinic_id = ${clinic.clinicId}`;
  adminId = admin.id;
  await owner`update app.users set password_hash = ${await hashPassword(PASSWORD)}, must_change_password = false where id = ${adminId}`;
});
afterAll(async () => {
  await owner.end();
});

const asAdmin = <T,>(fn: Parameters<typeof withClinic<T>>[1]) => withClinic({ clinicId: clinic.clinicId, userId: adminId }, fn);
const login = (code?: string) => verifyClinicLogin({ clinicCode: clinic.code, email: clinic.adminEmail, password: PASSWORD, code, meta: META });
const sessionVersion = async (id: string) => (await owner`select session_version from app.users where id = ${id}`)[0].session_version as number;

async function enrol(userId: string, at = Date.now()) {
  const run = <T,>(fn: Parameters<typeof withClinic<T>>[1]) => withClinic({ clinicId: clinic.clinicId, userId }, fn);
  const { secret } = await run((tx) => beginMfaSetup(tx, userId));
  const { recoveryCodes } = await run((tx) => finishMfaSetup(tx, userId, totpCode(secret, at), new Date(at)));
  return { secret, recoveryCodes };
}

describe("clinic staff", () => {
  it("makes a Clinic Admin set it up before anything else opens", async () => {
    const state = await loadClinicContext(clinic.clinicId, adminId, await sessionVersion(adminId));
    expect(state.status === "ok" && state.ctx.mustEnrollMfa).toBe(true);
  });

  it("does not require it of other roles", async () => {
    const nurse = await asAdmin((tx) => createStaff(tx, clinic.clinicId, { firstName: "Nia", lastName: "Nurse", email: `nurse-${randomUUID().slice(0, 6)}@twostep.test`, roleKeys: ["nurse"] }, adminId));
    const state = await loadClinicContext(clinic.clinicId, nurse.id, await sessionVersion(nurse.id));
    expect(state.status === "ok" && state.ctx.mustEnrollMfa).toBe(false);
  });

  it("refuses setup with a wrong code, and stores the secret encrypted", async () => {
    await asAdmin((tx) => beginMfaSetup(tx, adminId));
    await expect(asAdmin((tx) => finishMfaSetup(tx, adminId, "000000"))).rejects.toThrow(/does not match/);
    const [row] = await owner`select mfa_pending_secret, mfa_enabled_at from app.users where id = ${adminId}`;
    expect(row.mfa_pending_secret).toMatch(/^v2:[0-9a-f]{8}:/);
    expect(row.mfa_enabled_at).toBeNull();
  });

  let secret: string;
  let recovery: string[];

  it("turns on with a code from the app, and clears the requirement", async () => {
    ({ secret, recoveryCodes: recovery } = await enrol(adminId));
    expect(recovery).toHaveLength(10);
    const [row] = await owner`select mfa_secret, mfa_pending_secret, mfa_recovery_hashes from app.users where id = ${adminId}`;
    expect(row.mfa_secret).toMatch(/^v2:/);
    expect(row.mfa_secret).not.toContain(secret);
    expect(row.mfa_pending_secret).toBeNull();
    expect(JSON.stringify(row.mfa_recovery_hashes)).not.toContain(recovery[0].replace("-", ""));
    const state = await loadClinicContext(clinic.clinicId, adminId, await sessionVersion(adminId));
    expect(state.status === "ok" && !state.ctx.mustEnrollMfa && state.ctx.mfaEnabled).toBe(true);
  });

  it("asks for the code after the right password, and only then", async () => {
    expect(await verifyClinicLogin({ clinicCode: clinic.code, email: clinic.adminEmail, password: "wrong-password", meta: META })).toEqual({ ok: false, reason: "invalid" });
    expect(await login()).toEqual({ ok: false, reason: "mfa_required" });
  });

  it("refuses a wrong code, and records it", async () => {
    expect(await login("123456")).toEqual({ ok: false, reason: "mfa_invalid" });
    const [failed] = await owner`select details from app.audit_events where clinic_id = ${clinic.clinicId} and action = 'LOGIN_FAILED' order by created_at desc limit 1`;
    expect(failed.details).toMatchObject({ step: "two-step code" });
  });

  it("signs in with a fresh code, once: the same code cannot be replayed", async () => {
    // The code used for set-up is spent; the next one (30 seconds on) is accepted within the drift window.
    const code = totpCode(secret, Date.now() + 30_000);
    expect(await login(totpCode(secret, Date.now()))).toEqual({ ok: false, reason: "mfa_invalid" });
    expect((await login(code)).ok).toBe(true);
    expect(await login(code)).toEqual({ ok: false, reason: "mfa_invalid" });
  });

  it("accepts each recovery code once, and records its use", async () => {
    expect((await login(recovery[0])).ok).toBe(true);
    expect(await login(recovery[0])).toEqual({ ok: false, reason: "mfa_invalid" });
    expect((await asAdmin((tx) => mfaStatus(tx, adminId))).recoveryLeft).toBe(9);
    const [used] = await owner`select details from app.audit_events where clinic_id = ${clinic.clinicId} and action = 'MFA_RECOVERY_CODE_USED' order by created_at desc limit 1`;
    expect(used.details).toMatchObject({ left: 9 });
  });

  it("issues new recovery codes only with a valid code, replacing the old ones", async () => {
    await expect(asAdmin((tx) => newMfaRecoveryCodes(tx, adminId, "000000"))).rejects.toThrow(/does not match/);
    const at = nextMoment();
    const { recoveryCodes } = await asAdmin((tx) => newMfaRecoveryCodes(tx, adminId, totpCode(secret, at), new Date(at)));
    expect(recoveryCodes).toHaveLength(10);
    expect(await login(recovery[1])).toEqual({ ok: false, reason: "mfa_invalid" });
  });

  it("will not let a Clinic Admin switch it off", async () => {
    const at = nextMoment();
    await expect(asAdmin((tx) => turnOffMfa(tx, adminId, totpCode(secret, at), true, new Date(at)))).rejects.toThrow(/required for your role/);
  });

  it("lets another administrator reset it for a lost phone, ending every session", async () => {
    const other = await asAdmin((tx) => createStaff(tx, clinic.clinicId, { firstName: "Ola", lastName: "Other", email: `other-${randomUUID().slice(0, 6)}@twostep.test`, roleKeys: ["clinic_admin"] }, adminId));
    await expect(asAdmin((tx) => resetStaffMfa(tx, adminId, adminId))).rejects.toThrow(/cannot reset your own/);
    const before = await sessionVersion(adminId);
    await withClinic({ clinicId: clinic.clinicId, userId: other.id }, (tx) => resetStaffMfa(tx, adminId, other.id));
    expect(await sessionVersion(adminId)).toBe(before + 1);
    const [row] = await owner`select mfa_secret, mfa_enabled_at, mfa_recovery_hashes from app.users where id = ${adminId}`;
    expect(row).toMatchObject({ mfa_secret: null, mfa_enabled_at: null, mfa_recovery_hashes: [] });
    // The password alone signs in again, straight into setup.
    expect((await login()).ok).toBe(true);
    const state = await loadClinicContext(clinic.clinicId, adminId, await sessionVersion(adminId));
    expect(state.status === "ok" && state.ctx.mustEnrollMfa).toBe(true);
  });

  it("lets staff whose role does not require it switch it off with a code", async () => {
    const doc = await asAdmin((tx) => createStaff(tx, clinic.clinicId, { firstName: "Dev", lastName: "Doc", email: `doc-${randomUUID().slice(0, 6)}@twostep.test`, roleKeys: ["doctor"], registrationNumber: "KMC-1" }, adminId));
    const { secret: docSecret } = await enrol(doc.id);
    const run = <T,>(fn: Parameters<typeof withClinic<T>>[1]) => withClinic({ clinicId: clinic.clinicId, userId: doc.id }, fn);
    await expect(run((tx) => turnOffMfa(tx, doc.id, "000000", false))).rejects.toThrow(/does not match/);
    const at = nextMoment();
    await run((tx) => turnOffMfa(tx, doc.id, totpCode(docSecret, at), false, new Date(at)));
    expect((await run((tx) => mfaStatus(tx, doc.id))).enabled).toBe(false);
  });
});

describe("console operators", () => {
  it("require it, sign in only with a code, and can be reset by another Platform Admin", async () => {
    const email = `op-${randomUUID().slice(0, 8)}@twostep.test`;
    const created = await withPlatform((db) => createOperator(db, { email, name: "Opal Operator", role: "operator", createdBy: null as unknown as string }));
    const opId = (created as { id: string }).id;
    await owner`update platform.operators set password_hash = ${await hashPassword(PASSWORD)}, must_change_password = false where id = ${opId}`;
    const signIn = (code?: string) => verifyOperatorLogin({ email, password: PASSWORD, code, meta: META });

    expect((await signIn()).ok).toBe(true); // not set up yet: the session then forces setup
    const { secret } = await withPlatform((db) => beginOperatorMfaSetup(db, opId));
    await withPlatform((db) => finishOperatorMfaSetup(db, opId, totpCode(secret, Date.now())));
    const [row] = await owner`select mfa_secret from platform.operators where id = ${opId}`;
    expect(row.mfa_secret).toMatch(/^v2:/);

    expect(await signIn()).toEqual({ ok: false, reason: "mfa_required" });
    expect(await signIn("000000")).toEqual({ ok: false, reason: "mfa_invalid" });
    expect((await signIn(totpCode(secret, Date.now() + 30_000))).ok).toBe(true);

    await expect(withPlatform((db) => resetOperatorMfa(db, opId, opId))).rejects.toThrow(/cannot reset your own/);
    await withPlatform((db) => resetOperatorMfa(db, opId, randomUUID()));
    expect((await signIn()).ok).toBe(true);
  });
});
