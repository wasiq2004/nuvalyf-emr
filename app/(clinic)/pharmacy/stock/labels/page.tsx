import Link from "next/link";
import { ArrowLeft, Barcode } from "lucide-react";
import { PageHeader, PageShell } from "@/components/app/page";
import { can, requireClinic } from "@/lib/auth/clinic-session";
import { withClinic } from "@/lib/db";
import { todayInTimeZone } from "@/lib/time";
import { listStock } from "@/features/pharmacy/stock.service";
import { LabelPicker } from "./LabelPicker";

export const metadata = { title: "Shelf labels" };

export default async function LabelsPage() {
  const ctx = await requireClinic({ permission: "stock:manage", module: "pharmacy" });
  const stock = await withClinic({ clinicId: ctx.clinicId, userId: ctx.userId }, (tx) => listStock(tx, todayInTimeZone(ctx.timezone)));
  return (
    <PageShell>
      <Link href="/pharmacy/stock" className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-white">
        <ArrowLeft className="h-4 w-4" /> Stock
      </Link>
      <PageHeader
        icon={Barcode}
        title="Shelf labels"
        description="Name, MRP, rack, nearest batch and a barcode the counter can scan. Prints on A4 sheets of 24 labels (about 65 × 34 mm)."
      />
      <LabelPicker
        canAssign={can(ctx, "medicine:manage")}
        rows={stock
          .filter((s) => s.isActive)
          .map((s) => ({
            id: s.drugId,
            name: s.name,
            detail: [s.strength, s.form].filter(Boolean).join(" · "),
            rack: s.rack,
            barcode: s.barcode,
            onHand: s.onHand,
          }))}
      />
    </PageShell>
  );
}
