// Shared fixtures: real onboarding through the provisioner role.
import { withProvisioner } from "@/lib/db";
import { onboardClinic } from "@/features/platform/onboarding.service";

export const META = { ipAddress: "203.0.113.9", userAgent: "vitest" };
export const OPERATOR_ID = "00000000-0000-4000-8000-0000000000aa";

let counter = 0;

export async function createTestClinic(label = "clinic") {
  counter += 1;
  const code = `${label}-${Date.now().toString(36)}-${counter}`.toLowerCase().slice(0, 40);
  const adminEmail = `admin@${code}.test`;
  const result = await withProvisioner((tx) =>
    onboardClinic(
      tx,
      { name: `Test ${label}`, code, planId: null, timezone: "Asia/Kolkata", admin: { firstName: "Ada", lastName: "Admin", email: adminEmail } },
      OPERATOR_ID,
      META,
    ),
  );
  return { clinicId: result.clinicId, code, adminEmail, adminPassword: result.oneTimePassword };
}
