import "server-only";

// What every pharmacy PDF needs: the letterhead, the pharmacy's GST and drug
// licence registration, currency and time zone.
import type { Tx } from "@/lib/db";
import type { Letterhead } from "@/lib/pdf/letter";
import type { PharmacyIdentity } from "@/lib/pdf/sale-pdf";
import { getClinicSettings } from "@/features/settings/settings.service";
import { getPharmacySettings } from "./settings.service";

export async function pharmacyPdfContext(tx: Tx, clinicId: string) {
  const settings = await getClinicSettings(tx, clinicId);
  const pharmacy = await getPharmacySettings(tx, clinicId);
  const letterhead: Letterhead = {
    name: settings.displayName,
    addressLine: settings.addressLine,
    city: settings.city,
    phone: settings.phone,
    email: settings.email,
    letterheadText: settings.letterheadText,
    footerText: settings.footerText,
  };
  const identity: PharmacyIdentity = {
    gstin: pharmacy.gstin,
    gstScheme: pharmacy.gstScheme,
    drugLicence20b: pharmacy.drugLicence20b,
    drugLicence21b: pharmacy.drugLicence21b,
  };
  return { letterhead, identity, currency: settings.currency, timezone: settings.timezone };
}

export function pdfResponse(pdf: Uint8Array, number: string) {
  return new Response(Buffer.from(pdf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${number.replace(/[^A-Za-z0-9-]/g, "-")}.pdf"`, "Cache-Control": "private, no-store" },
  });
}
