// Phase 1: onboarding, clinic login, live session re-validation, plans and
// modules, suspension, admin rescue, operator safety rules.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { connect, ownerSql, testUrls } from "./test-db";
import { withPlatform, withProvisioner, withClinic } from "@/lib/db";
import { onboardClinic, rescueClinicAdmin } from "@/features/platform/onboarding.service";
import { setClinicPlan, setClinicStatus } from "@/features/platform/clinics.service";
import { createPlan } from "@/features/platform/plans.service";
import { createOperator, updateOperator } from "@/features/platform/operators.service";
import { verifyClinicLogin } from "@/features/auth/clinic-login.service";
import { loadClinicContext } from "@/features/auth/clinic-context.service";
import { changeOwnPassword } from "@/features/auth/account.service";
import { SYSTEM_ROLE_KEYS } from "@/lib/access/roles";

const owner = ownerSql();
const meta = { ipAddress: "203.0.113.7", userAgent: "vitest" };
const operatorId = "00000000-0000-4000-8000-000000000001";
const suffix = Date.now().toString(36);

let clinicId: string;
let adminId: string;
let otp: string;
const code = `onboard-${suffix}`;
const adminEmail = `admin-${suffix}@clinic.test`;

beforeAll(async () => {
  const result = await withProvisioner((tx) =>
    onboardClinic(
      tx,
      {
        name: "Onboarding Test Clinic",
        code,
        planId: null,
        timezone: "Asia/Kolkata",
        admin: { firstName: "Asha", lastName: "Admin", email: adminEmail },
      },
      operatorId,
      meta,
    ),
  );
  clinicId = result.clinicId;
  otp = result.oneTimePassword;
  const [admin] = await owner`select id from app.users where clinic_id = ${clinicId}`;
  adminId = admin.id;
});

afterAll(async () => {
  await owner.end();
});

describe("onboarding", () => {
  it("creates the clinic, settings, every system role and the first admin", async () => {
    const roles = await owner`select key from app.roles where clinic_id = ${clinicId} order by key`;
    expect(roles.map((r) => r.key).sort()).toEqual([...SYSTEM_ROLE_KEYS].sort());

    const [settings] = await owner`select timezone, display_name from app.clinic_settings where clinic_id = ${clinicId}`;
    expect(settings).toMatchObject({ timezone: "Asia/Kolkata", display_name: "Onboarding Test Clinic" });

    const [admin] = await owner`
      select u.must_change_password, r.key from app.users u
      join app.user_roles ur on ur.user_id = u.id join app.roles r on r.id = ur.role_id
      where u.id = ${adminId}`;
    expect(admin).toMatchObject({ must_change_password: true, key: "clinic_admin" });
  });

  it("stores only a hash of the one-time password", async () => {
    expect(otp).toMatch(/^[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}$/);
    const [row] = await owner`select password_hash from app.users where id = ${adminId}`;
    expect(row.password_hash).not.toContain(otp);
    expect(row.password_hash).toMatch(/^\$argon2id\$/);
  });

  it("audits onboarding on both sides", async () => {
    const [clinicSide] = await owner`select count(*)::int as n from app.audit_events where clinic_id = ${clinicId} and action = 'CLINIC_ONBOARDED'`;
    const [platformSide] = await owner`select count(*)::int as n from platform.audit_events where target_id = ${clinicId} and action = 'CLINIC_ONBOARDED'`;
    expect(clinicSide.n).toBe(1);
    expect(platformSide.n).toBe(1);
  });

  it("rejects a duplicate clinic code", async () => {
    await expect(
      withProvisioner((tx) =>
        onboardClinic(
          tx,
          { name: "Dup", code, planId: null, timezone: "UTC", admin: { firstName: "A", lastName: "B", email: "x@y.test" } },
          operatorId,
          meta,
        ),
      ),
    ).rejects.toThrow(/already in use/);
  });

  it("provisioner cannot read clinical audit history", async () => {
    const provisioner = connect(testUrls().provisioner);
    try {
      await expect(provisioner`select * from app.audit_events`).rejects.toMatchObject({ code: "42501" });
    } finally {
      await provisioner.end();
    }
  });
});

describe("clinic sign-in", () => {
  it("accepts the one-time password with the clinic code (case-insensitive)", async () => {
    const result = await verifyClinicLogin({ clinicCode: code.toUpperCase(), email: adminEmail.toUpperCase(), password: otp, meta });
    expect(result).toMatchObject({ ok: true, user: { id: adminId, clinicId } });
  });

  it("refuses a wrong password, an unknown clinic and an unknown email the same way", async () => {
    expect(await verifyClinicLogin({ clinicCode: code, email: adminEmail, password: "wrong-password", meta })).toEqual({ ok: false, reason: "invalid" });
    expect(await verifyClinicLogin({ clinicCode: "no-such-clinic", email: adminEmail, password: otp, meta })).toEqual({ ok: false, reason: "invalid" });
    expect(await verifyClinicLogin({ clinicCode: code, email: "nobody@clinic.test", password: otp, meta })).toEqual({ ok: false, reason: "invalid" });
  });

  it("records failed sign-ins in the clinic's audit trail", async () => {
    const [row] = await owner`select count(*)::int as n from app.audit_events where clinic_id = ${clinicId} and action = 'LOGIN_FAILED'`;
    expect(row.n).toBeGreaterThanOrEqual(2);
  });

  it("rate limits repeated attempts on one account", async () => {
    const email = `ratelimit-${suffix}@clinic.test`;
    const results = [];
    for (let i = 0; i < 11; i++) {
      results.push(await verifyClinicLogin({ clinicCode: code, email, password: "x", meta: { ...meta, ipAddress: `198.51.100.${i}` } }));
    }
    expect(results.at(-1)).toEqual({ ok: false, reason: "rate_limited" });
  });
});

describe("session context and modules", () => {
  it("loads the admin's permissions and pending password change", async () => {
    const state = await loadClinicContext(clinicId, adminId, 1);
    expect(state.status).toBe("ok");
    if (state.status !== "ok") return;
    expect(state.ctx.mustChangePassword).toBe(true);
    expect(state.ctx.permissions.has("staff:manage")).toBe(true);
    expect(state.ctx.permissions.has("encounter:write")).toBe(false); // administering is not practising
    // Module-gated permission is dropped while the clinic has no plan.
    expect(state.ctx.permissions.has("purchase:approve")).toBe(false);
    expect(state.ctx.modules.size).toBe(0);
  });

  it("switches module permissions on when the plan includes the module", async () => {
    const plan = await withPlatform((db) => createPlan(db, { name: `Pharmacy plan ${suffix}`, modules: ["pharmacy"] }));
    await withPlatform((db) => setClinicPlan(db, { clinicId, planId: plan.id }));

    const state = await loadClinicContext(clinicId, adminId, 1);
    expect(state.status).toBe("ok");
    if (state.status !== "ok") return;
    expect(state.ctx.modules.has("pharmacy")).toBe(true);
    expect(state.ctx.permissions.has("purchase:approve")).toBe(true);
  });

  it("never enables the hidden patient portal, even if forced into a plan", async () => {
    await expect(withPlatform((db) => createPlan(db, { name: `Portal ${suffix}`, modules: ["patient_portal"] }))).rejects.toThrow(
      /not available/,
    );

    // Bypass the service and force it in directly: still ignored.
    const [clinic] = await owner`select plan_id from platform.clinics where id = ${clinicId}`;
    await owner`insert into platform.plan_modules (plan_id, module) values (${clinic.plan_id}, 'patient_portal')`;
    const state = await loadClinicContext(clinicId, adminId, 1);
    expect(state.status === "ok" && state.ctx.modules.has("patient_portal")).toBe(false);
    await owner`delete from platform.plan_modules where plan_id = ${clinic.plan_id} and module = 'patient_portal'`;
  });

  it("enforces module dependencies (analytics needs reports)", async () => {
    await expect(withPlatform((db) => createPlan(db, { name: `Analytics only ${suffix}`, modules: ["analytics"] }))).rejects.toThrow(
      /requires Reports/,
    );
  });
});

describe("password change and rescue", () => {
  it("changing the password clears the flag and invalidates older sessions", async () => {
    const newVersion = await withClinic({ clinicId, userId: adminId }, (tx) =>
      changeOwnPassword(tx, { userId: adminId, currentPassword: otp, newPassword: "a-much-better-password" }),
    );
    expect(newVersion).toBe(2);

    expect((await loadClinicContext(clinicId, adminId, 1)).status).toBe("expired");
    const current = await loadClinicContext(clinicId, adminId, 2);
    expect(current.status === "ok" && current.ctx.mustChangePassword).toBe(false);
  });

  it("rescue issues a working one-time password and ends sessions", async () => {
    const rescued = await withProvisioner((tx) => rescueClinicAdmin(tx, { clinicId, userId: adminId }, operatorId, meta));
    expect((await loadClinicContext(clinicId, adminId, 2)).status).toBe("expired");
    const login = await verifyClinicLogin({ clinicCode: code, email: adminEmail, password: rescued.oneTimePassword, meta });
    expect(login.ok).toBe(true);
  });

  it("rescue only works on administrators of that clinic", async () => {
    await expect(
      withProvisioner((tx) => rescueClinicAdmin(tx, { clinicId, userId: operatorId }, operatorId, meta)),
    ).rejects.toThrow(/not an administrator/);
  });
});

describe("suspension", () => {
  it("cuts off live sessions and new sign-ins immediately", async () => {
    await withPlatform((db) => setClinicStatus(db, { clinicId, status: "suspended", reason: "test" }));
    const [{ session_version }] = await owner`select session_version from app.users where id = ${adminId}`;

    expect((await loadClinicContext(clinicId, adminId, session_version)).status).toBe("suspended");

    await withProvisioner((tx) => rescueClinicAdmin(tx, { clinicId, userId: adminId }, operatorId, meta)).then(async (r) => {
      const login = await verifyClinicLogin({ clinicCode: code, email: adminEmail, password: r.oneTimePassword, meta });
      expect(login).toEqual({ ok: false, reason: "clinic_suspended" });
    });

    await withPlatform((db) => setClinicStatus(db, { clinicId, status: "active" }));
  });
});

describe("operators", () => {
  it("keeps at least one active Platform Admin", async () => {
    await owner`update platform.operators set status = 'disabled' where role = 'platform_admin'`;
    const admin = await withPlatform((db) =>
      createOperator(db, { email: `pa-${suffix}@medflow.test`, name: "Only Admin", role: "platform_admin", createdBy: operatorId }),
    );
    await expect(
      withPlatform((db) => updateOperator(db, { id: admin.id, role: "operator", status: "active", actorId: operatorId })),
    ).rejects.toThrow(/at least one active Platform Admin/);
    await expect(
      withPlatform((db) => updateOperator(db, { id: admin.id, role: "platform_admin", status: "active", actorId: admin.id })),
    ).resolves.toBeUndefined();
  });

  it("an operator cannot demote or disable themselves", async () => {
    const op = await withPlatform((db) =>
      createOperator(db, { email: `self-${suffix}@medflow.test`, name: "Self", role: "platform_admin", createdBy: operatorId }),
    );
    await expect(
      withPlatform((db) => updateOperator(db, { id: op.id, role: "platform_admin", status: "disabled", actorId: op.id })),
    ).rejects.toThrow(/your own account/);
  });

  it("platform role sees usage counts but no clinic rows", async () => {
    const usage = await withPlatform((db) =>
      db.execute<{ staff_total: number }>(sql`select staff_total from platform.clinic_usage where clinic_id = ${clinicId}`),
    );
    expect(usage[0].staff_total).toBe(1);
    await expect(withPlatform((db) => db.execute(sql`select email from app.users`))).rejects.toThrow();
  });
});
