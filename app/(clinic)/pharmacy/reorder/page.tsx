import Link from "next/link";
import { ArrowLeft, Repeat } from "lucide-react";
import { EmptyState, PageHeader, PageShell } from "@/components/app/page";
import { requireClinic } from "@/lib/auth/clinic-session";
import { withClinic } from "@/lib/db";
import { todayInTimeZone } from "@/lib/time";
import { getClinicSettings } from "@/features/settings/settings.service";
import { getPharmacySettings } from "@/features/pharmacy/settings.service";
import { listSuppliers } from "@/features/pharmacy/purchasing.service";
import { itemsOnOpenOrders, reorderSuggestions } from "@/features/pharmacy/reorder.service";
import { ReorderPlanner } from "./ReorderPlanner";

export const metadata = { title: "Reorder" };

export default async function ReorderPage() {
  const ctx = await requireClinic({ permission: "purchase:create", module: "pharmacy" });
  const data = await withClinic({ clinicId: ctx.clinicId, userId: ctx.userId }, async (tx) => {
    const settings = await getPharmacySettings(tx, ctx.clinicId);
    return {
      settings,
      lines: await reorderSuggestions(tx, todayInTimeZone(ctx.timezone), ctx.timezone, settings),
      onOrder: await itemsOnOpenOrders(tx),
      suppliers: (await listSuppliers(tx)).filter((s) => s.isActive).map((s) => ({ id: s.id, name: s.name })),
      currency: (await getClinicSettings(tx, ctx.clinicId)).currency,
    };
  });
  const { settings } = data;

  return (
    <PageShell width="wide">
      <Link href="/pharmacy/purchases" className="inline-flex items-center gap-1.5 text-sm font-medium text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
        <ArrowLeft className="h-4 w-4" /> Purchases
      </Link>
      <PageHeader
        icon={Repeat}
        title="Reorder"
        description={`Items at or below their reorder level, or that will run out within the ${settings.reorderLeadDays}-day lead time at the last 30 days' rate. Quantities cover lead time plus ${settings.reorderCoverDays} days, in whole packs.`}
      />
      {data.lines.length === 0 ? (
        <EmptyState icon={Repeat} title="Nothing needs ordering" description="Set reorder levels on items in the catalogue to be warned earlier." />
      ) : (
        <ReorderPlanner
          currency={data.currency}
          suppliers={data.suppliers}
          rows={data.lines.map((l) => ({
            drugId: l.drugId,
            name: l.name,
            form: l.form,
            packSize: l.packSize,
            onHand: l.onHand,
            reorderLevel: l.reorderLevel,
            daily: l.daily,
            packs: l.packs,
            reason: l.reason,
            supplierId: l.supplierId,
            lastUnitCost: l.lastUnitCost,
            onOrder: data.onOrder.has(l.drugId),
          }))}
        />
      )}
    </PageShell>
  );
}
