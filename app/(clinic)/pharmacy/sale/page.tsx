import Link from "next/link";
import { ArrowLeft, ShoppingCart } from "lucide-react";
import { PageHeader, PageShell } from "@/components/app/page";
import { can, hasModule, requireClinic } from "@/lib/auth/clinic-session";
import { todayInTimeZone } from "@/lib/time";
import { admissionsForCharging } from "@/features/inpatient/inpatient.service";
import { withClinic } from "@/lib/db";
import { DEFAULT_LOCALE } from "@/lib/format";
import { getClinicSettings } from "@/features/settings/settings.service";
import { getPharmacySettings } from "@/features/pharmacy/settings.service";
import { CounterSale } from "./CounterSale";

export const metadata = { title: "New sale" };

export default async function CounterSalePage() {
  const ctx = await requireClinic({ permission: "pharmacy:sell", module: "pharmacy" });
  const data = await withClinic({ clinicId: ctx.clinicId, userId: ctx.userId }, async (tx) => ({
    clinic: await getClinicSettings(tx, ctx.clinicId),
    pharmacy: await getPharmacySettings(tx, ctx.clinicId),
    admissions: hasModule(ctx, "inpatient") ? await admissionsForCharging(tx, todayInTimeZone(ctx.timezone)) : [],
  }));
  return (
    <PageShell>
      <Link href="/pharmacy" className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-white">
        <ArrowLeft className="h-4 w-4" /> Pharmacy
      </Link>
      <PageHeader
        icon={ShoppingCart}
        title="New sale"
        description={
          data.pharmacy.gstScheme === "regular"
            ? "Over the counter, as a GST tax invoice. Only stock that has not expired can be sold."
            : "Over the counter, as a bill of supply. Only stock that has not expired can be sold."
        }
      />
      <CounterSale
        locale={DEFAULT_LOCALE}
        currency={data.clinic.currency}
        settings={{
          roundOff: data.pharmacy.roundOff,
          gstScheme: data.pharmacy.gstScheme,
          stateCode: data.pharmacy.stateCode,
          defaultGstRate: data.pharmacy.defaultGstRate,
          maxDiscountPercent: data.pharmacy.maxDiscountPercent,
        }}
        canOverrideDiscount={can(ctx, "pharmacy:cancel")}
        canSetCredit={can(ctx, "accounts:manage")}
        admissions={data.admissions}
      />
    </PageShell>
  );
}
