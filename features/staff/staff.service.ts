import "server-only";

import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import { roles, userRoles, users } from "@/lib/db/schema";
import { AppError, isUniqueViolation } from "@/lib/errors";
import { generateOneTimePassword, hashPassword } from "@/lib/auth/passwords";

export type StaffInput = {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  title?: string;
  specialty?: string;
  registrationNumber?: string;
  registrationCouncil?: string;
  roleKeys: string[];
};

export type StaffListItem = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  title: string | null;
  phone: string | null;
  specialty: string | null;
  registrationNumber: string | null;
  registrationCouncil: string | null;
  status: string;
  mustChangePassword: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
  roles: { key: string; name: string }[];
};

export async function listStaff(tx: Tx): Promise<StaffListItem[]> {
  const rows = await tx.select().from(users).orderBy(asc(users.firstName), asc(users.lastName));
  const grants = await tx
    .select({ userId: userRoles.userId, key: roles.key, name: roles.name })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId));

  return rows.map((u) => ({
    id: u.id,
    email: u.email,
    firstName: u.firstName,
    lastName: u.lastName,
    title: u.title,
    phone: u.phone,
    specialty: u.specialty,
    registrationNumber: u.registrationNumber,
    registrationCouncil: u.registrationCouncil,
    status: u.status,
    mustChangePassword: u.mustChangePassword,
    lastLoginAt: u.lastLoginAt,
    createdAt: u.createdAt,
    roles: grants.filter((g) => g.userId === u.id).map(({ key, name }) => ({ key, name })),
  }));
}

export async function getStaff(tx: Tx, id: string): Promise<StaffListItem | null> {
  const all = await listStaff(tx);
  return all.find((s) => s.id === id) ?? null;
}

async function resolveRoleIds(tx: Tx, roleKeys: string[]): Promise<Map<string, string>> {
  if (roleKeys.length === 0) throw new AppError("Give the account at least one role.");
  const rows = await tx.select({ id: roles.id, key: roles.key }).from(roles).where(inArray(roles.key, roleKeys));
  const map = new Map(rows.map((r) => [r.key, r.id]));
  for (const key of roleKeys) {
    if (!map.has(key)) throw new AppError(`Unknown role "${key}".`);
  }
  return map;
}

/** Number of active Clinic Admins other than `exceptUserId`. */
async function otherActiveAdmins(tx: Tx, exceptUserId: string): Promise<number> {
  const [row] = await tx
    .select({ n: sql<number>`count(distinct ${users.id})::int` })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.userId, users.id))
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(and(eq(roles.key, "clinic_admin"), eq(users.status, "active"), ne(users.id, exceptUserId)));
  return Number(row?.n ?? 0);
}

async function assertKeepsAnAdmin(tx: Tx, userId: string) {
  if ((await otherActiveAdmins(tx, userId)) === 0) {
    throw new AppError("The clinic must keep at least one active Clinic Admin.");
  }
}

function profileValues(input: StaffInput) {
  return {
    firstName: input.firstName,
    lastName: input.lastName,
    email: input.email,
    phone: input.phone ?? null,
    title: input.title ?? null,
    specialty: input.specialty ?? null,
    registrationNumber: input.registrationNumber ?? null,
    registrationCouncil: input.registrationCouncil ?? null,
  };
}

export async function createStaff(
  tx: Tx,
  clinicId: string,
  input: StaffInput,
  actorId: string,
): Promise<{ id: string; oneTimePassword: string }> {
  const roleIds = await resolveRoleIds(tx, input.roleKeys);
  const oneTimePassword = generateOneTimePassword();

  let userId: string;
  try {
    const [row] = await tx
      .insert(users)
      .values({
        clinicId,
        ...profileValues(input),
        passwordHash: await hashPassword(oneTimePassword),
        mustChangePassword: true,
        createdBy: actorId,
      })
      .returning({ id: users.id });
    userId = row.id;
  } catch (error) {
    if (isUniqueViolation(error)) throw new AppError("A staff account with this email already exists in this clinic.");
    throw error;
  }

  await tx.insert(userRoles).values([...roleIds.values()].map((roleId) => ({ clinicId, userId, roleId })));
  return { id: userId, oneTimePassword };
}

export async function updateStaff(
  tx: Tx,
  clinicId: string,
  userId: string,
  input: StaffInput,
  actorId: string,
): Promise<{ rolesChanged: boolean }> {
  const current = await getStaff(tx, userId);
  if (!current) throw new AppError("Staff member not found.");

  const roleIds = await resolveRoleIds(tx, input.roleKeys);
  const wasAdmin = current.roles.some((r) => r.key === "clinic_admin");
  const willBeAdmin = input.roleKeys.includes("clinic_admin");

  if (wasAdmin && !willBeAdmin) {
    if (userId === actorId) throw new AppError("You cannot remove your own Clinic Admin role.");
    if (current.status === "active") await assertKeepsAnAdmin(tx, userId);
  }

  try {
    await tx
      .update(users)
      .set({ ...profileValues(input), updatedAt: new Date() })
      .where(eq(users.id, userId));
  } catch (error) {
    if (isUniqueViolation(error)) throw new AppError("A staff account with this email already exists in this clinic.");
    throw error;
  }

  const before = current.roles.map((r) => r.key).sort().join(",");
  const after = [...input.roleKeys].sort().join(",");
  if (before !== after) {
    await tx.delete(userRoles).where(eq(userRoles.userId, userId));
    await tx.insert(userRoles).values([...roleIds.values()].map((roleId) => ({ clinicId, userId, roleId })));
  }
  return { rolesChanged: before !== after };
}

export async function setStaffStatus(
  tx: Tx,
  userId: string,
  status: "active" | "disabled",
  actorId: string,
): Promise<void> {
  if (userId === actorId) throw new AppError("You cannot disable your own account.");
  const current = await getStaff(tx, userId);
  if (!current) throw new AppError("Staff member not found.");

  if (status === "disabled" && current.roles.some((r) => r.key === "clinic_admin")) {
    await assertKeepsAnAdmin(tx, userId);
  }

  await tx
    .update(users)
    .set({
      status,
      // Disabling ends every session immediately.
      sessionVersion: sql`${users.sessionVersion} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));
}

/** Issues a new one-time password; the old password and all sessions stop working. */
export async function reissuePassword(tx: Tx, userId: string, actorId: string): Promise<{ oneTimePassword: string; email: string }> {
  if (userId === actorId) throw new AppError("Use 'Change password' for your own account.");
  const oneTimePassword = generateOneTimePassword();
  const [row] = await tx
    .update(users)
    .set({
      passwordHash: await hashPassword(oneTimePassword),
      mustChangePassword: true,
      sessionVersion: sql`${users.sessionVersion} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId))
    .returning({ email: users.email });
  if (!row) throw new AppError("Staff member not found.");
  return { oneTimePassword, email: row.email };
}
