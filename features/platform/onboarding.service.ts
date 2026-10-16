import "server-only";

// The two operations that need the provisioner role: onboarding a clinic and
// rescuing a locked-out clinic administrator. Both write staff accounts in a
// clinic, which the console's own role cannot touch.
import { and, eq, sql } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import {
  auditEvents,
  clinicSettings,
  clinics,
  platformAuditEvents,
  rolePermissions,
  roles,
  userRoles,
  users,
} from "@/lib/db/schema";
import { SYSTEM_ROLES, SYSTEM_ROLE_KEYS } from "@/lib/access/roles";
import { AppError, isUniqueViolation } from "@/lib/errors";
import { generateOneTimePassword, hashPassword } from "@/lib/auth/passwords";
import type { RequestMeta } from "@/lib/request";
import { importStarterCatalog } from "@/lib/catalog/seed";

export type OnboardClinicInput = {
  name: string;
  code: string;
  planId: string | null;
  timezone: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  admin: { firstName: string; lastName: string; email: string };
};

export type OnboardClinicResult = {
  clinicId: string;
  clinicCode: string;
  adminEmail: string;
  oneTimePassword: string;
};

/**
 * Creates the clinic, its settings, the default roles, its starter catalogue
 * and its first admin in one transaction. Returns the admin's one-time
 * password, which is never stored in plain text.
 */
export async function onboardClinic(
  tx: Tx,
  input: OnboardClinicInput,
  operatorId: string,
  meta: RequestMeta,
): Promise<OnboardClinicResult> {
  let clinicId: string;
  try {
    const [clinic] = await tx
      .insert(clinics)
      .values({
        name: input.name,
        code: input.code,
        planId: input.planId,
        contactName: input.contactName || null,
        contactEmail: input.contactEmail || null,
        contactPhone: input.contactPhone || null,
        createdBy: operatorId,
      })
      .returning({ id: clinics.id });
    clinicId = clinic.id;
  } catch (error) {
    if (isUniqueViolation(error)) throw new AppError(`The clinic code "${input.code}" is already in use.`);
    throw error;
  }

  await tx.insert(clinicSettings).values({
    clinicId,
    displayName: input.name,
    timezone: input.timezone,
    phone: input.contactPhone || null,
    email: input.contactEmail || null,
  });

  const roleIds = new Map<string, string>();
  for (const key of SYSTEM_ROLE_KEYS) {
    const template = SYSTEM_ROLES[key];
    const [role] = await tx
      .insert(roles)
      .values({ clinicId, key, name: template.name, description: template.description, isSystem: true })
      .returning({ id: roles.id });
    roleIds.set(key, role.id);
    if (template.permissions.length > 0) {
      await tx
        .insert(rolePermissions)
        .values(template.permissions.map((permission) => ({ clinicId, roleId: role.id, permission })));
    }
  }

  // The clinic's own editable copy of the starter medicines, codes and ranges.
  await importStarterCatalog(tx, clinicId);

  const oneTimePassword = generateOneTimePassword();
  const [admin] = await tx
    .insert(users)
    .values({
      clinicId,
      email: input.admin.email,
      passwordHash: await hashPassword(oneTimePassword),
      firstName: input.admin.firstName,
      lastName: input.admin.lastName,
      mustChangePassword: true,
    })
    .returning({ id: users.id });

  await tx.insert(userRoles).values({ clinicId, userId: admin.id, roleId: roleIds.get("clinic_admin")! });

  await tx.insert(auditEvents).values({
    clinicId,
    action: "CLINIC_ONBOARDED",
    targetType: "user",
    targetId: admin.id,
    details: { operatorId, adminEmail: input.admin.email },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });
  await tx.insert(platformAuditEvents).values({
    operatorId,
    action: "CLINIC_ONBOARDED",
    targetType: "clinic",
    targetId: clinicId,
    details: { code: input.code, planId: input.planId, adminEmail: input.admin.email },
    ipAddress: meta.ipAddress,
  });

  return { clinicId, clinicCode: input.code, adminEmail: input.admin.email, oneTimePassword };
}

export type ClinicAdminAccount = {
  id: string;
  email: string;
  name: string;
  status: string;
  lastLoginAt: Date | null;
};

/** Clinic administrators of one clinic (staff data only). */
export async function listClinicAdmins(tx: Tx, clinicId: string): Promise<ClinicAdminAccount[]> {
  const rows = await tx
    .select({
      id: users.id,
      email: users.email,
      firstName: users.firstName,
      lastName: users.lastName,
      status: users.status,
      lastLoginAt: users.lastLoginAt,
    })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.userId, users.id))
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(and(eq(users.clinicId, clinicId), eq(roles.key, "clinic_admin")))
    .orderBy(users.createdAt);

  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    name: `${r.firstName} ${r.lastName}`.trim(),
    status: r.status,
    lastLoginAt: r.lastLoginAt,
  }));
}

/**
 * Issues a new one-time password to a clinic administrator, re-activates the
 * account and ends every existing session for it.
 */
export async function rescueClinicAdmin(
  tx: Tx,
  input: { clinicId: string; userId: string },
  operatorId: string,
  meta: RequestMeta,
): Promise<{ email: string; oneTimePassword: string }> {
  const admins = await listClinicAdmins(tx, input.clinicId);
  const target = admins.find((a) => a.id === input.userId);
  if (!target) throw new AppError("That account is not an administrator of this clinic.");

  const oneTimePassword = generateOneTimePassword();
  await tx
    .update(users)
    .set({
      passwordHash: await hashPassword(oneTimePassword),
      mustChangePassword: true,
      status: "active",
      sessionVersion: sql`${users.sessionVersion} + 1`,
      updatedAt: new Date(),
    })
    .where(and(eq(users.id, target.id), eq(users.clinicId, input.clinicId)));

  await tx.insert(auditEvents).values({
    clinicId: input.clinicId,
    action: "ADMIN_RESCUED",
    targetType: "user",
    targetId: target.id,
    severity: "warning",
    details: { operatorId },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });
  await tx.insert(platformAuditEvents).values({
    operatorId,
    action: "ADMIN_RESCUED",
    targetType: "clinic",
    targetId: input.clinicId,
    details: { userId: target.id, email: target.email },
    ipAddress: meta.ipAddress,
  });

  return { email: target.email, oneTimePassword };
}
