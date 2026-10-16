import "server-only";

import { and, asc, eq, sql } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import { rolePermissions, roles, userRoles } from "@/lib/db/schema";
import { AppError } from "@/lib/errors";
import { PERMISSIONS, isPermission } from "@/lib/access/permissions";
import { SYSTEM_ROLES, isSystemRoleKey } from "@/lib/access/roles";

export type RoleWithPermissions = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  permissions: string[];
  memberCount: number;
};

export async function listRoles(tx: Tx): Promise<RoleWithPermissions[]> {
  const rows = await tx
    .select({
      id: roles.id,
      key: roles.key,
      name: roles.name,
      description: roles.description,
      memberCount: sql<number>`(select count(*)::int from ${userRoles} where ${userRoles.roleId} = ${roles.id})`,
    })
    .from(roles)
    .orderBy(asc(roles.name));
  const grants = await tx.select().from(rolePermissions);

  return rows.map((r) => ({
    ...r,
    memberCount: Number(r.memberCount),
    permissions: grants.filter((g) => g.roleId === r.id).map((g) => g.permission),
  }));
}

/**
 * Grants or revokes an adjustable permission on a role. Non-adjustable
 * permissions (e.g. signing prescriptions, managing staff) stay exactly as
 * the system role defines them.
 */
export async function setRolePermission(
  tx: Tx,
  clinicId: string,
  input: { roleId: string; permission: string; granted: boolean },
): Promise<{ roleKey: string; changed: boolean }> {
  if (!isPermission(input.permission)) throw new AppError("Unknown permission.");
  if (!PERMISSIONS[input.permission].adjustable) {
    throw new AppError(`"${PERMISSIONS[input.permission].label}" is a safety rule and cannot be changed.`);
  }

  const [role] = await tx.select().from(roles).where(eq(roles.id, input.roleId)).limit(1);
  if (!role) throw new AppError("Role not found.");
  if (isSystemRoleKey(role.key) && role.key === "auditor" && input.granted) {
    // The auditor sees who did what, never what was recorded.
    throw new AppError("The Auditor role cannot be given operational permissions.");
  }
  if (isSystemRoleKey(role.key) && role.key === "analyst" && input.granted && !input.permission.startsWith("analytics:")) {
    // Queue, appointment, billing and similar views all show patient names.
    throw new AppError("The Analyst role works only with de-identified analytics.");
  }

  const [existing] = await tx
    .select()
    .from(rolePermissions)
    .where(and(eq(rolePermissions.roleId, role.id), eq(rolePermissions.permission, input.permission)))
    .limit(1);

  if (input.granted && !existing) {
    await tx.insert(rolePermissions).values({ clinicId, roleId: role.id, permission: input.permission });
    return { roleKey: role.key, changed: true };
  }
  if (!input.granted && existing) {
    await tx
      .delete(rolePermissions)
      .where(and(eq(rolePermissions.roleId, role.id), eq(rolePermissions.permission, input.permission)));
    return { roleKey: role.key, changed: true };
  }
  return { roleKey: role.key, changed: false };
}

/** Restores a system role's permissions to the shipped defaults. */
export async function resetRoleToDefaults(tx: Tx, clinicId: string, roleId: string): Promise<string> {
  const [role] = await tx.select().from(roles).where(eq(roles.id, roleId)).limit(1);
  if (!role || !isSystemRoleKey(role.key)) throw new AppError("Role not found.");

  await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, role.id));
  const defaults = SYSTEM_ROLES[role.key].permissions;
  if (defaults.length > 0) {
    await tx.insert(rolePermissions).values(defaults.map((permission) => ({ clinicId, roleId: role.id, permission })));
  }
  return role.key;
}
