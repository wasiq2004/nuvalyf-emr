import { and, count, eq, isNull } from "drizzle-orm";
import { Landmark } from "lucide-react";
import { PageHeader, PageShell, Panel } from "@/components/app/page";
import { requireClinic } from "@/lib/auth/clinic-session";
import { withClinic } from "@/lib/db";
import { drugs } from "@/lib/db/schema";
import { getPharmacySettings } from "@/features/pharmacy/settings.service";
import PharmacySettingsForm from "./PharmacySettingsForm";

export const metadata = { title: "Pharmacy settings" };

export default async function PharmacySettingsPage() {
  const ctx = await requireClinic({ permission: "settings:manage", module: "pharmacy" });
  const data = await withClinic({ clinicId: ctx.clinicId, userId: ctx.userId }, async (tx) => ({
    settings: await getPharmacySettings(tx, ctx.clinicId),
    withoutHsn: (await tx.select({ n: count() }).from(drugs).where(and(eq(drugs.itemType, "medicine"), isNull(drugs.hsn))))[0].n,
  }));

  return (
    <PageShell width="default">
      <PageHeader
        icon={Landmark}
        eyebrow="Administration"
        title="Pharmacy settings"
        description="GST registration, drug licences and how the counter totals bills. Sales are tax invoices once these are saved."
      />
      {!data.settings.configured && (
        <p className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          Not set up yet. Until you save, the pharmacy uses the defaults below and invoices carry no GSTIN.
        </p>
      )}
      <Panel>
        <PharmacySettingsForm values={data.settings} medicinesWithoutHsn={data.withoutHsn} />
      </Panel>
    </PageShell>
  );
}
