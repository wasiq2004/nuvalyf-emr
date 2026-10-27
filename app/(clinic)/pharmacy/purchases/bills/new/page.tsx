import Link from "next/link";
import { ArrowLeft, ReceiptText } from "lucide-react";
import { PageHeader, PageShell } from "@/components/app/page";
import { can, requireClinic } from "@/lib/auth/clinic-session";
import { withClinic } from "@/lib/db";
import { DEFAULT_LOCALE } from "@/lib/format";
import { todayInTimeZone } from "@/lib/time";
import { getClinicSettings } from "@/features/settings/settings.service";
import { listSuppliers } from "@/features/pharmacy/purchasing.service";
import { BillEntry } from "./BillEntry";

export const metadata = { title: "Enter a supplier bill" };

export default async function NewBillPage() {
  const ctx = await requireClinic({ permission: "stock:manage", module: "pharmacy" });
  const data = await withClinic({ clinicId: ctx.clinicId, userId: ctx.userId }, async (tx) => ({
    suppliers: (await listSuppliers(tx)).filter((s) => s.isActive).map((s) => ({ id: s.id, name: s.name })),
    currency: (await getClinicSettings(tx, ctx.clinicId)).currency,
  }));

  return (
    <PageShell width="wide">
      <Link href="/pharmacy/purchases" className="inline-flex items-center gap-1.5 text-sm font-medium text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
        <ArrowLeft className="h-4 w-4" /> Purchases
      </Link>
      <PageHeader
        icon={ReceiptText}
        title="Enter a supplier bill"
        description="Copy the bill line by line. Saving adds everything to stock at once. Items are matched by any name they are known by, and new spellings can be remembered for next time."
      />
      <BillEntry
        suppliers={data.suppliers}
        today={todayInTimeZone(ctx.timezone)}
        locale={DEFAULT_LOCALE}
        currency={data.currency}
        canAddItems={can(ctx, "medicine:manage")}
        canAddSuppliers={can(ctx, "purchase:create")}
      />
    </PageShell>
  );
}
