"use server";

import { z } from "zod";
import { clinicAction } from "@/lib/auth/actions";
import { checkbox, optionalText } from "@/lib/validation";
import { GSTIN_PATTERN } from "./gst-rules";
import { savePharmacySettings } from "./settings.service";

const whole = (min: number, max: number, label: string) =>
  z.coerce.number({ message: `${label} must be a number` }).int(`${label} must be a whole number`).min(min, `${label} must be at least ${min}`).max(max, `${label} must be at most ${max}`);

export const savePharmacySettingsAction = clinicAction(
  {
    name: "pharmacy.saveSettings",
    permission: "settings:manage",
    module: "pharmacy",
    schema: z
      .object({
        gstin: z
          .union([z.literal(""), z.string().trim().toUpperCase().regex(GSTIN_PATTERN, "Enter a valid 15-character GSTIN")])
          .optional()
          .transform((v) => v || null),
        stateCode: z
          .union([z.literal(""), z.string().trim().regex(/^\d{2}$/, "Two digits, e.g. 33")])
          .optional()
          .transform((v) => v || null),
        gstScheme: z.enum(["regular", "composition", "unregistered"]),
        drugLicence20b: optionalText(60).transform((v) => v ?? null),
        drugLicence21b: optionalText(60).transform((v) => v ?? null),
        roundOff: checkbox,
        maxDiscountPercent: z.coerce.number({ message: "Enter a number" }).min(0).max(100),
        defaultHsn: z.string().trim().regex(/^\d{4,8}$/, "HSN is 4 to 8 digits"),
        defaultGstRate: z.coerce.number({ message: "Enter a number" }).min(0).max(40),
        reorderLeadDays: whole(0, 120, "Lead time"),
        reorderCoverDays: whole(1, 180, "Cover"),
        applyDefaultsToMedicines: checkbox,
      })
      .superRefine((v, ctx) => {
        if (v.gstScheme !== "unregistered" && !v.gstin) ctx.addIssue({ code: "custom", path: ["gstin"], message: "A registered pharmacy needs its GSTIN" });
        if (v.gstin && v.stateCode && v.gstin.slice(0, 2) !== v.stateCode) {
          ctx.addIssue({ code: "custom", path: ["stateCode"], message: `The GSTIN is registered in state ${v.gstin.slice(0, 2)}` });
        }
      })
      .transform((v) => ({ ...v, stateCode: v.stateCode ?? (v.gstin ? v.gstin.slice(0, 2) : null) })),
  },
  async ({ session, db, audit }, input) =>
    db(async (tx) => {
      const result = await savePharmacySettings(tx, session.clinicId, input, session.userId);
      await audit(tx, {
        action: "PHARMACY_SETTINGS_UPDATED",
        targetType: "clinic",
        targetId: session.clinicId,
        details: { gstin: input.gstin, scheme: input.gstScheme, roundOff: input.roundOff, maxDiscount: input.maxDiscountPercent, medicinesUpdated: result.medicinesUpdated },
      });
      return result;
    }),
);
