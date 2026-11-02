import Link from "next/link";
import { ArrowLeft, PackageMinus } from "lucide-react";
import { PageHeader, PageShell } from "@/components/app/page";
import { requireClinic } from "@/lib/auth/clinic-session";
import { withClinic } from "@/lib/db";
import { todayInTimeZone } from "@/lib/time";
import { getClinicSettings } from "@/features/settings/settings.service";
import { listSuppliers } from "@/features/pharmacy/purchasing.service";
import { returnableBatches } from "@/features/pharmacy/supplier-accounts.service";
import { ReturnToSupplier } from "./ReturnToSupplier";

export const metadata = { title: "Return to supplier" };

export default async function ReturnToSupplierPage() {
  const ctx = await requireClinic({ permission: "stock:manage", module: "pharmacy" });
  const data = await withClinic({ clinicId: ctx.clinicId, userId: ctx.userId }, async (tx) => ({
    suppliers: (await listSuppliers(tx)).filter((s) => s.isActive).map((s) => ({ id: s.id, name: s.name })),
    batches: await returnableBatches(tx, todayInTimeZone(ctx.timezone)),
    currency: (await getClinicSettings(tx, ctx.clinicId)).currency,
  }));
  return (
    <PageShell width="wide">
      <Link href="/pharmacy/purchases" className="inline-flex items-center gap-1.5 text-sm font-medium text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
        <ArrowLeft className="h-4 w-4" /> Purchases
      </Link>
      <PageHeader icon={PackageMinus} title="Return to supplier" description="Expired, damaged or excess stock going back. A debit note is issued for the supplier." />
      <ReturnToSupplier
        suppliers={data.suppliers}
        currency={data.currency}
        batches={data.batches.map((b) => ({
          batchId: b.batchId,
          drugName: b.drugName,
          batchNo: b.batchNo,
          expiryDate: b.expiryDate,
          expired: b.expired,
          onHand: b.onHand,
          unitCost: b.unitCost,
          gstRate: String(b.gstRate),
          supplierId: b.supplierId,
        }))}
      />
    </PageShell>
  );
}
