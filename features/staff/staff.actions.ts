"use server";

import { z } from "zod";
import { clinicAction } from "@/lib/auth/actions";
import { checkbox, emailField, idField, nameField, optionalPhone, optionalText, stringList } from "@/lib/validation";
import { createStaff, reissuePassword, setStaffStatus, updateStaff } from "./staff.service";
import { resetRoleToDefaults, setRolePermission } from "./roles.service";

const staffSchema = z.object({
  firstName: nameField,
  lastName: nameField,
  email: emailField,
  phone: optionalPhone,
  title: optionalText(20),
  specialty: optionalText(150),
  registrationNumber: optionalText(100),
  registrationCouncil: optionalText(150),
  roles: stringList.refine((r) => r.length > 0, "Choose at least one role"),
});

function toInput(input: z.output<typeof staffSchema>) {
  const { roles, ...profile } = input;
  return { ...profile, roleKeys: roles };
}

export const createStaffAction = clinicAction(
  { name: "staff.create", permission: "staff:manage", schema: staffSchema },
  async ({ session, db, audit }, input) =>
    db(async (tx) => {
      const created = await createStaff(tx, session.clinicId, toInput(input), session.userId);
      await audit(tx, {
        action: "STAFF_CREATED",
        targetType: "user",
        targetId: created.id,
        details: { email: input.email, roles: input.roles },
      });
      return { email: input.email, oneTimePassword: created.oneTimePassword };
    }),
);

export const updateStaffAction = clinicAction(
  { name: "staff.update", permission: "staff:manage", schema: staffSchema.extend({ id: idField }) },
  async ({ session, db, audit }, { id, ...input }) =>
    db(async (tx) => {
      const { rolesChanged } = await updateStaff(tx, session.clinicId, id, toInput(input), session.userId);
      await audit(tx, {
        action: rolesChanged ? "STAFF_ROLES_CHANGED" : "STAFF_UPDATED",
        targetType: "user",
        targetId: id,
        severity: rolesChanged ? "warning" : "info",
        details: rolesChanged ? { roles: input.roles } : undefined,
      });
    }),
);

export const setStaffStatusAction = clinicAction(
  {
    name: "staff.setStatus",
    permission: "staff:manage",
    schema: z.object({ id: idField, status: z.enum(["active", "disabled"]) }),
  },
  async ({ session, db, audit }, input) =>
    db(async (tx) => {
      await setStaffStatus(tx, input.id, input.status, session.userId);
      await audit(tx, {
        action: input.status === "disabled" ? "STAFF_DISABLED" : "STAFF_ENABLED",
        targetType: "user",
        targetId: input.id,
        severity: "warning",
      });
    }),
);

export const reissuePasswordAction = clinicAction(
  { name: "staff.reissuePassword", permission: "staff:manage", schema: z.object({ id: idField }) },
  async ({ session, db, audit }, input) =>
    db(async (tx) => {
      const result = await reissuePassword(tx, input.id, session.userId);
      // Losing a password means issuing another, which is audited (Clinic Admin flow).
      await audit(tx, { action: "PASSWORD_REISSUED", targetType: "user", targetId: input.id, severity: "warning" });
      return result;
    }),
);

export const setRolePermissionAction = clinicAction(
  {
    name: "roles.setPermission",
    permission: "staff:manage",
    schema: z.object({ roleId: idField, permission: z.string().min(1).max(60), granted: checkbox }),
  },
  async ({ session, db, audit }, input) =>
    db(async (tx) => {
      const result = await setRolePermission(tx, session.clinicId, input);
      if (result.changed) {
        await audit(tx, {
          action: input.granted ? "ROLE_PERMISSION_GRANTED" : "ROLE_PERMISSION_REVOKED",
          targetType: "role",
          targetId: input.roleId,
          severity: "warning",
          details: { role: result.roleKey, permission: input.permission },
        });
      }
    }),
);

export const resetRoleAction = clinicAction(
  { name: "roles.reset", permission: "staff:manage", schema: z.object({ roleId: idField }) },
  async ({ session, db, audit }, input) =>
    db(async (tx) => {
      const key = await resetRoleToDefaults(tx, session.clinicId, input.roleId);
      await audit(tx, { action: "ROLE_RESET", targetType: "role", targetId: input.roleId, severity: "warning", details: { role: key } });
    }),
);
