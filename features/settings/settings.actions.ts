"use server";

import { z } from "zod";
import { clinicAction } from "@/lib/auth/actions";
import { optionalEmail, optionalPhone, optionalText, requiredText, timezoneField } from "@/lib/validation";
import { updateClinicSettings } from "./settings.service";

const settingsSchema = z.object({
  displayName: requiredText(200, "Clinic name"),
  addressLine: optionalText(500),
  city: optionalText(100),
  phone: optionalPhone,
  email: optionalEmail,
  website: optionalText(255),
  timezone: timezoneField,
  letterheadText: optionalText(1000),
  footerText: optionalText(1000),
  slotMinutes: z.coerce.number({ message: "Choose a slot length" }).int().refine((v) => [5, 10, 15, 20, 30].includes(v), {
    message: "Choose 5, 10, 15, 20 or 30 minutes",
  }),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "Use a 3-letter currency code, e.g. INR"),
  // Platform minimum 3 (features/analytics/analytics-rules.ts), also a DB CHECK.
  analyticsMinCell: z.coerce.number({ message: "Enter a number" }).int().min(3, "The minimum is 3").max(50).optional(),
});

export const updateClinicSettingsAction = clinicAction(
  { name: "settings.updateClinic", permission: "settings:manage", schema: settingsSchema },
  async ({ session, db, audit }, input) =>
    db(async (tx) => {
      await updateClinicSettings(tx, session.clinicId, input, session.userId);
      await audit(tx, { action: "CLINIC_SETTINGS_UPDATED", targetType: "clinic", targetId: session.clinicId });
    }),
);
