import "server-only";

// Every server action is built with clinicAction() or platformAction().
// The wrapper, not each action, guarantees:
//   1. a live, re-validated session (suspension / deactivation apply instantly)
//   2. the required permission and module, with refusals audited as critical
//   3. validated input (zod), and errors that never leak internals
// Next.js documents that proxy-level checks do not cover Server Functions,
// so this is the authoritative check.
import type { z } from "zod";
import { fail, formDataToObject, fromZodError, ok, type ActionResult } from "@/lib/action-result";
import { errorToResult } from "@/lib/errors";
import { withClinic, withPlatform, type Tx } from "@/lib/db";
import { recordAudit, recordPlatformAudit, type ClinicAuditEvent, type PlatformAuditEvent } from "@/lib/audit";
import { getRequestMeta, type RequestMeta } from "@/lib/request";
import type { ModuleKey } from "@/lib/access/modules";
import type { Permission } from "@/lib/access/permissions";
import { can, getClinicSession, recordDenied, type ClinicContext } from "@/lib/auth/clinic-session";
import { getOperatorSession, type OperatorContext, type OperatorRole } from "@/lib/auth/platform-session";

type RawInput = FormData | Record<string, unknown> | undefined;

function parseInput<S extends z.ZodType>(schema: S, raw: RawInput) {
  const value = raw instanceof FormData ? formDataToObject(raw) : (raw ?? {});
  return schema.safeParse(value);
}

// ---------------------------------------------------------------------------
// Clinic actions
// ---------------------------------------------------------------------------

export type ClinicActionContext = {
  session: ClinicContext;
  meta: RequestMeta;
  /** Runs `fn` in a transaction scoped (RLS) to the session's clinic. */
  db: <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>;
  /** Records an audit event for this user inside `tx`. */
  audit: (tx: Tx, event: Omit<ClinicAuditEvent, "clinicId" | "actorUserId" | "meta">) => Promise<void>;
};

type ClinicActionConfig<S extends z.ZodType> = {
  /** Stable name used in audit records and the permission matrix. */
  name: string;
  /** All listed permissions are required. `null` = any signed-in user. */
  permission: Permission | readonly Permission[] | null;
  module?: ModuleKey;
  schema: S;
  allowPendingPasswordChange?: boolean;
};

export type ActionMeta = {
  kind: "clinic" | "platform";
  name: string;
  permission?: Permission | readonly Permission[] | null;
  module?: ModuleKey;
  role?: OperatorRole;
};

export function clinicAction<S extends z.ZodType, R>(
  config: ClinicActionConfig<S>,
  handler: (ctx: ClinicActionContext, input: z.output<S>) => Promise<R>,
) {
  const action = async (raw?: RawInput): Promise<ActionResult<R>> => {
    const state = await getClinicSession();
    if (state.status !== "ok") return fail("Your session has ended. Please sign in again.");
    const session = state.ctx;

    if (session.mustChangePassword && !config.allowPendingPasswordChange) {
      return fail("Please change your password before continuing.");
    }
    if (config.module && !session.modules.has(config.module)) {
      return fail("This feature is not included in your clinic's plan.");
    }
    if (config.permission && !can(session, config.permission)) {
      await recordDenied(session, "ACTION_DENIED", { action: config.name, required: config.permission });
      return fail("You don't have permission to do that.");
    }

    const parsed = parseInput(config.schema, raw);
    if (!parsed.success) return fromZodError(parsed.error);

    const meta = await getRequestMeta();
    const scope = { clinicId: session.clinicId, userId: session.userId };

    try {
      const data = await handler(
        {
          session,
          meta,
          db: (fn) => withClinic(scope, fn),
          audit: (tx, event) =>
            recordAudit(tx, { ...event, clinicId: session.clinicId, actorUserId: session.userId, meta }),
        },
        parsed.data,
      );
      return ok(data);
    } catch (error) {
      return errorToResult(error);
    }
  };

  const meta: ActionMeta = { kind: "clinic", name: config.name, permission: config.permission, module: config.module };
  return Object.assign(action, { meta });
}

// ---------------------------------------------------------------------------
// Platform (operations console) actions
// ---------------------------------------------------------------------------

export type PlatformActionContext = {
  operator: OperatorContext;
  meta: RequestMeta;
  /** Runs `fn` in a platform-role transaction. */
  db: <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>;
  audit: (tx: Tx, event: Omit<PlatformAuditEvent, "operatorId" | "meta">) => Promise<void>;
};

type PlatformActionConfig<S extends z.ZodType> = {
  name: string;
  /** Restrict to Platform Admins; default allows any active operator. */
  role?: OperatorRole;
  schema: S;
  allowPendingPasswordChange?: boolean;
};

export function platformAction<S extends z.ZodType, R>(
  config: PlatformActionConfig<S>,
  handler: (ctx: PlatformActionContext, input: z.output<S>) => Promise<R>,
) {
  const action = async (raw?: RawInput): Promise<ActionResult<R>> => {
    const state = await getOperatorSession();
    if (state.status !== "ok") return fail("Your console session has ended. Please sign in again.");
    const operator = state.ctx;
    const meta = await getRequestMeta();

    if (operator.mustChangePassword && !config.allowPendingPasswordChange) {
      return fail("Please change your password before continuing.");
    }
    if (config.role === "platform_admin" && operator.role !== "platform_admin") {
      await withPlatform((db) =>
        recordPlatformAudit(db, {
          operatorId: operator.id,
          action: "ACTION_DENIED",
          outcome: "denied",
          details: { action: config.name },
          meta,
        }),
      );
      return fail("Only a Platform Admin can do that.");
    }

    const parsed = parseInput(config.schema, raw);
    if (!parsed.success) return fromZodError(parsed.error);

    try {
      const data = await handler(
        {
          operator,
          meta,
          db: (fn) => withPlatform((pool) => pool.transaction(fn)),
          audit: (db, event) => recordPlatformAudit(db, { ...event, operatorId: operator.id, meta }),
        },
        parsed.data,
      );
      return ok(data);
    } catch (error) {
      return errorToResult(error);
    }
  };

  const meta: ActionMeta = { kind: "platform", name: config.name, role: config.role };
  return Object.assign(action, { meta });
}
