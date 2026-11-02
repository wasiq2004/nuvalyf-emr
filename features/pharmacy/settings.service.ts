import "server-only";

// Pharmacy settings (GST registration, drug licences, round-off, discount
// limit, defaults, reorder). One row per clinic, created on first save; until
// then the defaults apply.
import { and, eq, isNull, sql } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import { drugs, pharmacySettings } from "@/lib/db/schema";

export type PharmacySettings = {
  gstin: string | null;
  stateCode: string | null;
  gstScheme: "regular" | "composition" | "unregistered";
  drugLicence20b: string | null;
  drugLicence21b: string | null;
  roundOff: boolean;
  maxDiscountPercent: number;
  defaultHsn: string;
  defaultGstRate: number;
  reorderLeadDays: number;
  reorderCoverDays: number;
  /** False until the Clinic Admin has saved the settings once. */
  configured: boolean;
};

export const DEFAULT_PHARMACY_SETTINGS: PharmacySettings = {
  gstin: null,
  stateCode: null,
  gstScheme: "regular",
  drugLicence20b: null,
  drugLicence21b: null,
  roundOff: true,
  maxDiscountPercent: 10,
  defaultHsn: "3004",
  defaultGstRate: 5,
  reorderLeadDays: 7,
  reorderCoverDays: 15,
  configured: false,
};

export async function getPharmacySettings(tx: Tx, clinicId: string): Promise<PharmacySettings> {
  const [row] = await tx.select().from(pharmacySettings).where(eq(pharmacySettings.clinicId, clinicId)).limit(1);
  if (!row) return { ...DEFAULT_PHARMACY_SETTINGS };
  return {
    gstin: row.gstin,
    stateCode: row.stateCode,
    gstScheme: row.gstScheme as PharmacySettings["gstScheme"],
    drugLicence20b: row.drugLicence20b,
    drugLicence21b: row.drugLicence21b,
    roundOff: row.roundOff,
    maxDiscountPercent: Number(row.maxDiscountPercent),
    defaultHsn: row.defaultHsn,
    defaultGstRate: Number(row.defaultGstRate),
    reorderLeadDays: row.reorderLeadDays,
    reorderCoverDays: row.reorderCoverDays,
    configured: true,
  };
}

export type PharmacySettingsInput = Omit<PharmacySettings, "configured"> & { applyDefaultsToMedicines: boolean };

export async function savePharmacySettings(tx: Tx, clinicId: string, input: PharmacySettingsInput, actorId: string) {
  const values = {
    gstin: input.gstin,
    stateCode: input.stateCode,
    gstScheme: input.gstScheme,
    drugLicence20b: input.drugLicence20b,
    drugLicence21b: input.drugLicence21b,
    roundOff: input.roundOff,
    maxDiscountPercent: String(input.maxDiscountPercent),
    defaultHsn: input.defaultHsn,
    defaultGstRate: String(input.defaultGstRate),
    reorderLeadDays: input.reorderLeadDays,
    reorderCoverDays: input.reorderCoverDays,
    updatedBy: actorId,
    updatedAt: new Date(),
  };
  await tx.insert(pharmacySettings).values({ clinicId, ...values }).onConflictDoUpdate({ target: pharmacySettings.clinicId, set: values });

  let updated = 0;
  if (input.applyDefaultsToMedicines) {
    // Fill gaps only: an item's own HSN and rate always win.
    const rows = await tx
      .update(drugs)
      .set({
        hsn: sql`coalesce(${drugs.hsn}, ${input.defaultHsn})`,
        gstRate: sql`coalesce(${drugs.gstRate}, ${String(input.defaultGstRate)})`,
        updatedAt: new Date(),
      })
      .where(and(eq(drugs.itemType, "medicine"), isNull(drugs.hsn)))
      .returning({ id: drugs.id });
    updated = rows.length;
  }
  return { medicinesUpdated: updated };
}

/** The GST an item is sold at: its own, else the pharmacy's default. */
export function effectiveGst(item: { hsn: string | null; gstRate: string | null; itemType: string }, settings: PharmacySettings) {
  return {
    hsn: item.hsn ?? (item.itemType === "medicine" ? settings.defaultHsn : null),
    gstRate: item.gstRate !== null ? Number(item.gstRate) : settings.defaultGstRate,
  };
}
