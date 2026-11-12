import "server-only";

import { eq } from "drizzle-orm";
import { withClinic } from "@/lib/db";
import { clinicSettings, clinics, planModules, rolePermissions, roles, userRoles, users } from "@/lib/db/schema";
import { MODULES, isModuleKey, type ModuleKey } from "@/lib/access/modules";
import { resolvePermissions, type Permission } from "@/lib/access/permissions";
import { homeForRoles } from "@/lib/access/roles";
import { clinicMfaRequired } from "./mfa";

export type ClinicContext = {
  clinicId: string;
  clinicName: string;
  clinicCode: string;
  timezone: string;
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  displayName: string;
  title: string | null;
  registrationNumber: string | null;
  mustChangePassword: boolean;
  /** Two-step sign-in is on for this account. */
  mfaEnabled: boolean;
  /** Required for the role and not set up yet: nothing else opens until it is. */
  mustEnrollMfa: boolean;
  roleKeys: string[];
  roleNames: string[];
  permissions: ReadonlySet<Permission>;
  modules: ReadonlySet<ModuleKey>;
  home: string;
};

export type ClinicSessionState =
  | { status: "ok"; ctx: ClinicContext }
  | { status: "signed_out" | "suspended" | "disabled" | "expired" };

/**
 * Re-reads everything that can revoke access, on every request: clinic
 * suspension, account status, session version, roles, plan modules.
 */
export async function loadClinicContext(
  clinicId: string,
  userId: string,
  sessionVersion: number,
): Promise<ClinicSessionState> {
  return withClinic({ clinicId, userId }, async (tx) => {
    const [clinic] = await tx
      .select({ id: clinics.id, name: clinics.name, code: clinics.code, status: clinics.status, planId: clinics.planId })
      .from(clinics)
      .where(eq(clinics.id, clinicId))
      .limit(1);
    if (!clinic) return { status: "signed_out" } as const;
    if (clinic.status !== "active") return { status: "suspended" } as const;

    // Named columns: every request reads this, and none of it needs the two-step secret.
    const [user] = await tx
      .select({
        id: users.id,
        email: users.email,
        status: users.status,
        sessionVersion: users.sessionVersion,
        firstName: users.firstName,
        lastName: users.lastName,
        title: users.title,
        registrationNumber: users.registrationNumber,
        mustChangePassword: users.mustChangePassword,
        mfaEnabledAt: users.mfaEnabledAt,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!user) return { status: "signed_out" } as const;
    if (user.status !== "active") return { status: "disabled" } as const;
    if (user.sessionVersion !== sessionVersion) return { status: "expired" } as const;

    const grants = await tx
      .select({ key: roles.key, name: roles.name, permission: rolePermissions.permission })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .leftJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
      .where(eq(userRoles.userId, userId));

    const moduleRows = clinic.planId
      ? await tx.select({ module: planModules.module }).from(planModules).where(eq(planModules.planId, clinic.planId))
      : [];
    // Modules that are not offered (e.g. the hidden patient portal) never switch on.
    const modules = new Set(
      moduleRows.map((m) => m.module).filter((m): m is ModuleKey => isModuleKey(m) && MODULES[m].offered),
    );

    const [settings] = await tx
      .select({ timezone: clinicSettings.timezone, displayName: clinicSettings.displayName })
      .from(clinicSettings)
      .where(eq(clinicSettings.clinicId, clinicId))
      .limit(1);

    const roleKeys = [...new Set(grants.map((g) => g.key))];
    const roleNames = [...new Set(grants.map((g) => g.name))];
    const permissions = resolvePermissions(
      grants.map((g) => g.permission).filter((p): p is string => Boolean(p)),
      modules,
    );

    return {
      status: "ok",
      ctx: {
        clinicId: clinic.id,
        clinicName: settings?.displayName ?? clinic.name,
        clinicCode: clinic.code,
        timezone: settings?.timezone ?? "Asia/Kolkata",
        userId: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        displayName: [user.title, user.firstName, user.lastName].filter(Boolean).join(" "),
        title: user.title,
        registrationNumber: user.registrationNumber,
        mustChangePassword: user.mustChangePassword,
        mfaEnabled: Boolean(user.mfaEnabledAt),
        mustEnrollMfa: clinicMfaRequired(roleKeys) && !user.mfaEnabledAt,
        roleKeys,
        roleNames,
        permissions,
        modules,
        home: homeForRoles(roleKeys, modules),
      },
    } as const;
  });
}
