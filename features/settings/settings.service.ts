import "server-only";

import { eq } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import { clinicSettings } from "@/lib/db/schema";
import { AppError } from "@/lib/errors";

export type ClinicSettingsInput = {
  displayName: string;
  addressLine?: string;
  city?: string;
  phone?: string;
  email?: string;
  website?: string;
  timezone: string;
  letterheadText?: string;
  footerText?: string;
  slotMinutes: number;
  currency: string;
  /** Only sent when the clinic has the Analytics module. */
  analyticsMinCell?: number;
};

export async function getClinicSettings(tx: Tx, clinicId: string) {
  const [row] = await tx.select().from(clinicSettings).where(eq(clinicSettings.clinicId, clinicId)).limit(1);
  if (!row) throw new AppError("Clinic settings are missing.");
  return row;
}

export async function updateClinicSettings(tx: Tx, clinicId: string, input: ClinicSettingsInput, actorId: string) {
  await tx
    .update(clinicSettings)
    .set({
      displayName: input.displayName,
      addressLine: input.addressLine ?? null,
      city: input.city ?? null,
      phone: input.phone ?? null,
      email: input.email ?? null,
      website: input.website ?? null,
      timezone: input.timezone,
      letterheadText: input.letterheadText ?? null,
      footerText: input.footerText ?? null,
      slotMinutes: input.slotMinutes,
      currency: input.currency,
      ...(input.analyticsMinCell !== undefined ? { analyticsMinCell: input.analyticsMinCell } : {}),
      updatedBy: actorId,
      updatedAt: new Date(),
    })
    .where(eq(clinicSettings.clinicId, clinicId));
}
