// The permission matrix: every server action, called as every role.
//
// 1. Every function exported from a features/**/*.actions.ts file must be built
//    with clinicAction()/platformAction() (except the explicit public list), so
//    no action can skip the session/permission check.
// 2. Each clinic action refuses - and audits - every role that lacks its
//    permission, and lets roles that hold it through to input validation.
// 3. Module-gated actions refuse clinics without the module.
// 4. Platform-Admin-only actions refuse plain operators.
import fs from "fs";
import path from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolvePermissions, type Permission } from "@/lib/access/permissions";
import { MODULE_KEYS, type ModuleKey } from "@/lib/access/modules";
import { SYSTEM_ROLES, SYSTEM_ROLE_KEYS } from "@/lib/access/roles";
import type { ActionMeta } from "@/lib/auth/actions";

const state = vi.hoisted(() => ({
  clinic: null as unknown,
  operator: null as unknown,
  denied: [] as unknown[],
}));

vi.mock("@/lib/auth/clinic-session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/clinic-session")>();
  return {
    ...actual,
    getClinicSession: vi.fn(async () => state.clinic),
    recordDenied: vi.fn(async (_ctx: unknown, action: string, details: unknown) => {
      state.denied.push({ action, details });
    }),
  };
});
vi.mock("@/lib/auth/platform-session", () => ({ getOperatorSession: vi.fn(async () => state.operator) }));
vi.mock("@/lib/auth/clinic-auth", () => ({
  clinicSignIn: vi.fn(),
  clinicSignOut: vi.fn(),
  updateClinicSession: vi.fn(),
}));
vi.mock("@/lib/auth/platform-auth", () => ({
  platformSignIn: vi.fn(),
  platformSignOut: vi.fn(),
  updatePlatformSession: vi.fn(),
}));
vi.mock("@/lib/request", () => ({ getRequestMeta: vi.fn(async () => ({ ipAddress: null, userAgent: null })) }));
vi.mock("next-auth", () => ({
  AuthError: class AuthError extends Error {},
  CredentialsSignin: class CredentialsSignin extends Error {
    code = "credentials";
  },
}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
  forbidden: vi.fn(),
  notFound: vi.fn(),
}));
vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  return {
    ...actual,
    withPlatform: vi.fn(async (fn: (db: unknown) => unknown) => fn({})),
    withClinic: vi.fn(async () => {
      throw new Error("handler reached the database");
    }),
  };
});
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn(), recordPlatformAudit: vi.fn() }));

/** Actions that must be callable without a session (sign-in / sign-out). */
const PUBLIC_ACTIONS = new Set(["clinicSignInAction", "clinicSignOutAction", "operatorSignInAction", "operatorSignOutAction"]);

type Action = ((input?: unknown) => Promise<{ ok: boolean; error?: string }>) & { meta?: ActionMeta };

function findActionFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return findActionFiles(full);
    return entry.name.endsWith(".actions.ts") ? [full] : [];
  });
}

const root = path.resolve(__dirname, "../..");
const files = findActionFiles(path.join(root, "features"));

async function loadActions() {
  const actions: { file: string; name: string; fn: Action }[] = [];
  for (const file of files) {
    const mod = (await import(file)) as Record<string, unknown>;
    for (const [name, value] of Object.entries(mod)) {
      if (typeof value === "function") actions.push({ file: path.relative(root, file), name, fn: value as Action });
    }
  }
  return actions;
}

function clinicSession(permissions: Iterable<string>, modules: Iterable<ModuleKey> = MODULE_KEYS) {
  const moduleSet = new Set(modules);
  return {
    status: "ok",
    ctx: {
      clinicId: "00000000-0000-4000-8000-000000000001",
      userId: "00000000-0000-4000-8000-000000000002",
      mustChangePassword: false,
      permissions: resolvePermissions(permissions, moduleSet),
      modules: moduleSet,
      roleKeys: [],
    },
  };
}

const PERMISSION_DENIED = "You don't have permission to do that.";
const MODULE_DENIED = "This feature is not included in your clinic's plan.";

beforeEach(() => {
  state.denied = [];
  state.clinic = null;
  state.operator = null;
});

describe("server action registry", () => {
  it("finds the action files", () => {
    expect(files.length).toBeGreaterThan(3);
  });

  it("every exported action is wrapped with a permission check", async () => {
    const unwrapped = (await loadActions())
      .filter(({ name, fn }) => !fn.meta && !PUBLIC_ACTIONS.has(name))
      .map(({ file, name }) => `${file}: ${name}`);
    expect(unwrapped).toEqual([]);
  });
});

describe("clinic actions × roles", async () => {
  const actions = (await loadActions()).filter(({ fn }) => fn.meta?.kind === "clinic" && fn.meta.permission);

  for (const { name, fn } of actions) {
    const required = ([] as Permission[]).concat(fn.meta!.permission as Permission | Permission[]);

    for (const roleKey of SYSTEM_ROLE_KEYS) {
      const rolePermissions = new Set<string>(SYSTEM_ROLES[roleKey].permissions);
      const allowed = required.every((p) => rolePermissions.has(p));

      it(`${name} ${allowed ? "admits" : "refuses"} ${roleKey}`, async () => {
        state.clinic = clinicSession(rolePermissions);
        const result = await fn({});
        if (allowed) {
          expect(result.error).not.toBe(PERMISSION_DENIED);
          expect(state.denied).toHaveLength(0);
        } else {
          expect(result).toMatchObject({ ok: false, error: PERMISSION_DENIED });
          expect(state.denied).toHaveLength(1);
        }
      });
    }
  }

  it("refuses everything without a session", async () => {
    for (const { fn } of actions) {
      state.clinic = { status: "signed_out" };
      const result = await fn({});
      expect(result.ok).toBe(false);
    }
  });
});

describe("module gating", async () => {
  const gated = (await loadActions()).filter(({ fn }) => fn.meta?.kind === "clinic" && fn.meta.module);

  it("module-gated actions name a real module", () => {
    for (const { fn } of gated) expect(MODULE_KEYS).toContain(fn.meta!.module);
  });

  for (const { name, fn } of gated) {
    it(`${name} needs the ${fn.meta!.module} module`, async () => {
      state.clinic = clinicSession(
        ([] as string[]).concat(fn.meta!.permission as string | string[]),
        MODULE_KEYS.filter((m) => m !== fn.meta!.module),
      );
      expect(await fn({})).toMatchObject({ ok: false, error: MODULE_DENIED });
    });
  }
});

describe("platform actions", async () => {
  const adminOnly = (await loadActions()).filter(({ fn }) => fn.meta?.kind === "platform" && fn.meta.role === "platform_admin");

  it("has Platform-Admin-only actions", () => {
    expect(adminOnly.length).toBeGreaterThan(0);
  });

  for (const { name, fn } of adminOnly) {
    it(`${name} refuses a plain operator`, async () => {
      state.operator = { status: "ok", ctx: { id: "op", role: "operator", mustChangePassword: false } };
      expect(await fn({})).toMatchObject({ ok: false, error: "Only a Platform Admin can do that." });
    });
  }
});

describe("analytics never accepts identifiers", async () => {
  const mod = (await import(path.join(root, "features/analytics/analytics.actions.ts"))) as Record<string, Action>;
  const id = "00000000-0000-4000-8000-0000000000c1";
  const cohort = { name: "Diabetes review", purpose: "Quarterly review of diabetic patients' control", definition: { from: "2026-01-01", to: "2026-06-30" } };
  const valid: Record<string, Record<string, unknown>> = {
    createCohortAction: cohort,
    updateCohortAction: { id, ...cohort },
    runCohortAction: { id },
    archiveCohortAction: { id },
  };
  // "name" is the cohort's own name; these are the fields that would identify a patient.
  const identifiers = { mrn: "P-000001", mobile: "9845012345", patientName: "Asha Rao", patientId: "00000000-0000-4000-8000-0000000000d1" };
  const REACHED_DB = "Something went wrong. Please try again.";

  it("covers every analytics action", () => {
    expect(Object.keys(mod).sort()).toEqual(Object.keys(valid).sort());
  });

  for (const [name, input] of Object.entries(valid)) {
    it(`${name} refuses a patient name, mobile, record number or id`, async () => {
      state.clinic = clinicSession(SYSTEM_ROLES.analyst.permissions);
      for (const [key, value] of Object.entries(identifiers)) {
        const result = await mod[name]({ ...input, [key]: value });
        expect(result.ok, `${name} accepted "${key}"`).toBe(false);
        expect(result.error).not.toBe(REACHED_DB);
      }
      // The same input without identifiers passes validation (and reaches the stubbed database).
      expect((await mod[name](input)).error).toBe(REACHED_DB);
    });
  }

  it("refuses identifiers inside a cohort definition too", async () => {
    state.clinic = clinicSession(SYSTEM_ROLES.analyst.permissions);
    const result = await mod.createCohortAction({ ...cohort, definition: { ...cohort.definition, mrn: "P-000001" } });
    expect(result.ok).toBe(false);
    expect(result.error).not.toBe(REACHED_DB);
  });
});
