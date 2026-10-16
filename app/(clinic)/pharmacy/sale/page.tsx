import Link from "next/link";
import { ArrowLeft, ShoppingCart } from "lucide-react";
import { PageHeader, PageShell } from "@/components/app/page";
import { requireClinic } from "@/lib/auth/clinic-session";
import { withClinic } from "@/lib/db";
import { DEFAULT_LOCALE } from "@/lib/format";
import { getClinicSettings } from "@/features/settings/settings.service";
import { CounterSale } from "./CounterSale";

export const metadata = { title: "New sale" };

export default async function CounterSalePage() {
  const ctx = await requireClinic({ permission: "pharmacy:sell", module: "pharmacy" });
  const settings = await withClinic({ clinicId: ctx.clinicId, userId: ctx.userId }, (tx) => getClinicSettings(tx, ctx.clinicId));
  return (
    <PageShell>
      <Link href="/pharmacy" className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-white">
        <ArrowLeft className="h-4 w-4" /> Pharmacy
      </Link>
      <PageHeader icon={ShoppingCart} title="New sale" description="Over the counter. Only stock that has not expired can be sold." />
      <CounterSale locale={DEFAULT_LOCALE} currency={settings.currency} />
    </PageShell>
  );
}
