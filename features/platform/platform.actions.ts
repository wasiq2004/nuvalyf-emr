"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { AuthError, CredentialsSignin } from "next-auth";
import { platformSignIn, platformSignOut, updatePlatformSession } from "@/lib/auth/platform-auth";
import { sessionProof } from "@/lib/auth/session-proof";
import { rateLimit } from "@/lib/rate-limit";
import { platformAction } from "@/lib/auth/actions";
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { isProvisionerConfigured, withPlatform, withProvisioner } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { OPERATOR_PASSWORD_MIN } from "@/lib/auth/passwords";
import {
  checkbox,
  clinicCodeField,
  emailField,
  idField,
  nameField,
  optionalEmail,
  optionalId,
  optionalPhone,
  optionalText,
  passwordChangeSchema,
  requiredText,
  stringList,
  timezoneField,
} from "@/lib/validation";
import { onboardClinic, rescueClinicAdmin } from "./onboarding.service";
import { setClinicPlan, setClinicStatus, updateClinicContact } from "./clinics.service";
import { createPlan, updatePlan } from "./plans.service";
import {
  changeOperatorPassword,
  createOperator,
  resetOperatorPassword,
  updateOperator,
} from "./operators.service";

const PROVISIONER_OFF =
  "Clinic onboarding and admin rescue are switched off: PROVISIONER_DATABASE_URL is not configured on this server.";

// ---------------------------------------------------------------------------
// Sign in / out
// ---------------------------------------------------------------------------

const signInSchema = z.object({
  email: z.string().trim().min(1, "Enter your email"),
  password: z.string().min(1, "Enter your password"),
});

export async function operatorSignInAction(formData: FormData): Promise<ActionResult> {
  const parsed = signInSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("Enter your email and password.");

  try {
    await platformSignIn("operator", { ...parsed.data, redirect: false });
  } catch (error) {
    if (error instanceof CredentialsSignin) {
      if (error.code === "rate_limited") return fail("Too many attempts. Wait 15 minutes and try again.");
      if (error.code === "account_disabled") return fail("This operator account is disabled.");
      return fail("Incorrect email or password.");
    }
    if (error instanceof AuthError) return fail("Incorrect email or password.");
    throw error;
  }
  return ok();
}

export async function operatorSignOutAction() {
  await platformSignOut({ redirect: false });
  redirect("/platform/login");
}

export const changeOperatorPasswordAction = platformAction(
  {
    name: "platform.changeOwnPassword",
    schema: passwordChangeSchema(OPERATOR_PASSWORD_MIN),
    allowPendingPasswordChange: true,
  },
  async ({ operator, db, audit }, input) => {
    // Counted outside the transaction: a wrong password rolls that back.
    const { allowed } = await withPlatform((conn) => rateLimit(conn, `password-change:operator:${operator.id}`, { limit: 5, windowMs: 15 * 60_000 }));
    if (!allowed) throw new AppError("Too many attempts. Wait 15 minutes and try again.");
    const sessionVersion = await db((d) =>
      changeOperatorPassword(d, { id: operator.id, currentPassword: input.currentPassword, newPassword: input.newPassword }),
    );
    await db((d) => audit(d, { action: "OPERATOR_PASSWORD_CHANGED", targetType: "operator", targetId: operator.id }));
    // Other sessions end; this one continues on the new version.
    await updatePlatformSession({ sv: sessionVersion, proof: sessionProof(process.env.PLATFORM_AUTH_SECRET, operator.id, sessionVersion) });
  },
);

// ---------------------------------------------------------------------------
// Clinics
// ---------------------------------------------------------------------------

const onboardSchema = z.object({
  name: requiredText(200, "Clinic name"),
  code: clinicCodeField,
  planId: optionalId,
  timezone: timezoneField,
  contactName: optionalText(200),
  contactEmail: optionalEmail,
  contactPhone: optionalPhone,
  adminFirstName: nameField,
  adminLastName: nameField,
  adminEmail: emailField,
});

export const onboardClinicAction = platformAction(
  { name: "platform.onboardClinic", schema: onboardSchema },
  async ({ operator, meta }, input) => {
    if (!isProvisionerConfigured()) throw new AppError(PROVISIONER_OFF);
    return withProvisioner((tx) =>
      onboardClinic(
        tx,
        {
          name: input.name,
          code: input.code,
          planId: input.planId,
          timezone: input.timezone,
          contactName: input.contactName,
          contactEmail: input.contactEmail,
          contactPhone: input.contactPhone,
          admin: { firstName: input.adminFirstName, lastName: input.adminLastName, email: input.adminEmail },
        },
        operator.id,
        meta,
      ),
    );
  },
);

export const setClinicStatusAction = platformAction(
  {
    name: "platform.setClinicStatus",
    schema: z.object({
      clinicId: idField,
      status: z.enum(["active", "suspended"]),
      reason: optionalText(500),
    }),
  },
  async ({ db, audit }, input) => {
    if (input.status === "suspended" && !input.reason) {
      throw new AppError("Give a reason for the suspension; it is recorded in the audit trail.");
    }
    await db(async (d) => {
      const clinic = await setClinicStatus(d, input);
      await audit(d, {
        action: input.status === "suspended" ? "CLINIC_SUSPENDED" : "CLINIC_RESTORED",
        targetType: "clinic",
        targetId: clinic.id,
        details: { code: clinic.code, reason: input.reason },
      });
    });
  },
);

export const setClinicPlanAction = platformAction(
  { name: "platform.setClinicPlan", schema: z.object({ clinicId: idField, planId: optionalId }) },
  async ({ db, audit }, input) => {
    await db(async (d) => {
      await setClinicPlan(d, input);
      await audit(d, {
        action: "CLINIC_PLAN_CHANGED",
        targetType: "clinic",
        targetId: input.clinicId,
        details: { planId: input.planId },
      });
    });
  },
);

export const updateClinicContactAction = platformAction(
  {
    name: "platform.updateClinicContact",
    schema: z.object({
      clinicId: idField,
      name: requiredText(200, "Clinic name"),
      contactName: optionalText(200),
      contactEmail: optionalEmail,
      contactPhone: optionalPhone,
    }),
  },
  async ({ db, audit }, input) => {
    await db(async (d) => {
      await updateClinicContact(d, input);
      await audit(d, { action: "CLINIC_UPDATED", targetType: "clinic", targetId: input.clinicId });
    });
  },
);

export const rescueClinicAdminAction = platformAction(
  {
    name: "platform.rescueClinicAdmin",
    role: "platform_admin",
    schema: z.object({ clinicId: idField, userId: idField }),
  },
  async ({ operator, meta }, input) => {
    if (!isProvisionerConfigured()) throw new AppError(PROVISIONER_OFF);
    return withProvisioner((tx) => rescueClinicAdmin(tx, input, operator.id, meta));
  },
);

// ---------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------

const planSchema = z.object({
  name: requiredText(100, "Plan name"),
  description: optionalText(500),
  modules: stringList,
});

export const createPlanAction = platformAction(
  { name: "platform.createPlan", role: "platform_admin", schema: planSchema },
  async ({ db, audit }, input) => {
    await db(async (d) => {
      const plan = await createPlan(d, input);
      await audit(d, { action: "PLAN_CREATED", targetType: "plan", targetId: plan.id, details: { modules: input.modules } });
    });
  },
);

export const updatePlanAction = platformAction(
  {
    name: "platform.updatePlan",
    role: "platform_admin",
    schema: planSchema.extend({ id: idField, isActive: checkbox }),
  },
  async ({ db, audit }, input) => {
    await db(async (d) => {
      await updatePlan(d, input);
      await audit(d, {
        action: "PLAN_UPDATED",
        targetType: "plan",
        targetId: input.id,
        details: { modules: input.modules, isActive: input.isActive },
      });
    });
  },
);

// ---------------------------------------------------------------------------
// Operators (Platform Admin only)
// ---------------------------------------------------------------------------

export const createOperatorAction = platformAction(
  {
    name: "platform.createOperator",
    role: "platform_admin",
    schema: z.object({
      name: requiredText(200, "Name"),
      email: emailField,
      role: z.enum(["platform_admin", "operator"]),
    }),
  },
  async ({ operator, db, audit }, input) => {
    return db(async (d) => {
      const created = await createOperator(d, { ...input, createdBy: operator.id });
      await audit(d, {
        action: "OPERATOR_CREATED",
        targetType: "operator",
        targetId: created.id,
        details: { email: input.email, role: input.role },
      });
      return { email: input.email, oneTimePassword: created.oneTimePassword };
    });
  },
);

export const updateOperatorAction = platformAction(
  {
    name: "platform.updateOperator",
    role: "platform_admin",
    schema: z.object({
      id: idField,
      role: z.enum(["platform_admin", "operator"]),
      status: z.enum(["active", "disabled"]),
    }),
  },
  async ({ operator, db, audit }, input) => {
    await db(async (d) => {
      await updateOperator(d, { ...input, actorId: operator.id });
      await audit(d, { action: "OPERATOR_UPDATED", targetType: "operator", targetId: input.id, details: input });
    });
  },
);

export const resetOperatorPasswordAction = platformAction(
  { name: "platform.resetOperatorPassword", role: "platform_admin", schema: z.object({ id: idField }) },
  async ({ operator, db, audit }, input) => {
    if (input.id === operator.id) throw new AppError("Use 'Change password' for your own account.");
    return db(async (d) => {
      const result = await resetOperatorPassword(d, input.id);
      await audit(d, { action: "OPERATOR_PASSWORD_RESET", targetType: "operator", targetId: input.id });
      return result;
    });
  },
);
