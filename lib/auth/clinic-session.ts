import "server-only";

import { cache } from "react";
import { forbidden, redirect } from "next/navigation";
import { clinicAuth } from "@/lib/auth/clinic-auth";
import {
  loadClinicContext,
  type ClinicContext,
  type ClinicSessionState,
} from "@/features/auth/clinic-context.service";
import { recordAudit } from "@/lib/audit";
import { withClinic } from "@/lib/db";
import type { ModuleKey } from "@/lib/access/modules";
import type { Permission } from "@/lib/access/permissions";
import { getRequestMeta } from "@/lib/request";

export type { ClinicContext };

/** The signed-in clinic user for this request, re-validated against the database. */
export const getClinicSession = cache(async (): Promise<ClinicSessionState> => {
  const session = await clinicAuth();
  if (!session?.uid || !session.cid || typeof session.sv !== "number") {
    return { status: "signed_out" };
  }
  return loadClinicContext(session.cid, session.uid, session.sv);
});

export function can(ctx: ClinicContext, permission: Permission | readonly Permission[]): boolean {
  const required = typeof permission === "string" ? [permission] : permission;
  return required.every((p) => ctx.permissions.has(p));
}

export function hasModule(ctx: ClinicContext, module: ModuleKey): boolean {
  return ctx.modules.has(module);
}

/** A refused authorisation is a serious event (Auditor flow). */
export async function recordDenied(ctx: ClinicContext, action: string, details: Record<string, unknown>) {
  const meta = await getRequestMeta();
  await withClinic({ clinicId: ctx.clinicId, userId: ctx.userId }, (tx) =>
    recordAudit(tx, {
      clinicId: ctx.clinicId,
      actorUserId: ctx.userId,
      action,
      outcome: "denied",
      severity: "critical",
      details,
      meta,
    }),
  );
}

type PageRequirement = {
  permission?: Permission | readonly Permission[];
  module?: ModuleKey;
  /** The change-password page must stay reachable while a change is pending. */
  allowPendingPasswordChange?: boolean;
};

/**
 * Page guard for the clinic and compliance panels. Redirects signed-out users,
 * forces a pending password change, and answers 403 when a permission or
 * module is missing.
 */
export async function requireClinic(requirement: PageRequirement = {}): Promise<ClinicContext> {
  const state = await getClinicSession();
  if (state.status !== "ok") {
    redirect(state.status === "signed_out" ? "/login" : `/login?reason=${state.status}`);
  }

  const { ctx } = state;
  if (ctx.mustChangePassword && !requirement.allowPendingPasswordChange) {
    redirect("/change-password");
  }

  if (requirement.module && !hasModule(ctx, requirement.module)) {
    forbidden();
  }
  if (requirement.permission && !can(ctx, requirement.permission)) {
    await recordDenied(ctx, "PAGE_ACCESS_DENIED", { required: requirement.permission });
    forbidden();
  }

  return ctx;
}
