import Link from "next/link";
import { forbidden, notFound } from "next/navigation";
import { z } from "zod";
import { ArrowLeft, ReceiptText } from "lucide-react";
import { DetailList, EmptyState, PageHeader, PageShell, Panel } from "@/components/app/page";
import { DataTable } from "@/components/app/data-table";
import { can, recordDenied, requireClinic } from "@/lib/auth/clinic-session";
import { withClinic } from "@/lib/db";
import { formatDate, formatDateTime } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { getClinicSettings } from "@/features/settings/settings.service";
import { getBill } from "@/features/pharmacy/bills.service";
import { ItemTypeBadge } from "@/components/pharmacy/item-picker";

export const metadata = { title: "Supplier bill" };

export default async function BillPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireClinic({ module: "pharmacy" });
  if (!can(ctx, "purchase:create") && !can(ctx, "purchase:approve") && !can(ctx, "stock:manage")) {
    await recordDenied(ctx, "PAGE_ACCESS_DENIED", { required: ["purchase:create", "purchase:approve", "stock:manage"], path: "/pharmacy/purchases/bills/[id]" });
    forbidden();
  }
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const data = await withClinic({ clinicId: ctx.clinicId, userId: ctx.userId }, async (tx) => {
    const bill = await getBill(tx, id);
    return bill ? { bill, currency: (await getClinicSettings(tx, ctx.clinicId)).currency } : null;
  });
  if (!data) notFound();
  const { bill } = data;
  const money = (v: string) => formatMoney(v, data.currency);
  const units = bill.items.reduce((n, i) => n + i.units, 0);

  return (
    <PageShell width="wide">
      <Link href="/pharmacy/purchases" className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-white">
        <ArrowLeft className="h-4 w-4" /> Purchases
      </Link>
      <PageHeader
        icon={ReceiptText}
        eyebrow={<span className="font-mono normal-case tracking-normal">{bill.number}</span>}
        title={`${bill.supplier.name} · ${bill.billNo}`}
        description={`Bill dated ${formatDate(bill.billDate, "UTC")}. Saved bills cannot be edited; correct stock from the item's stock page.`}
      />

      <Panel flush title="Lines" description={`${bill.items.length} ${bill.items.length === 1 ? "line" : "lines"} · ${units} units added to stock`}>
        <DataTable
          rows={bill.items}
          rowKey={(i) => i.id}
          empty={<EmptyState icon={ReceiptText} title="No lines" />}
          columns={[
            {
              key: "item",
              header: "Item",
              cell: (i) => (
                <Link href={`/pharmacy/stock/${i.drugId}`} className="group block">
                  <p className="flex flex-wrap items-center gap-2 font-medium text-zinc-900 group-hover:underline dark:text-zinc-100">
                    {i.itemName} <ItemTypeBadge type={i.itemType} />
                  </p>
                  {i.description.toLowerCase() !== i.itemName.toLowerCase() && <p className="text-xs text-zinc-500">On the bill: “{i.description}”</p>}
                </Link>
              ),
            },
            {
              key: "batch",
              header: "Batch",
              hideOnMobile: true,
              cell: (i) => (
                <span className="text-sm">
                  <span className="font-mono">{i.batchNo}</span>
                  <span className="block text-xs text-zinc-500">exp {formatDate(i.expiryDate, "UTC")}</span>
                </span>
              ),
            },
            {
              key: "qty",
              header: "Packs",
              align: "right",
              cell: (i) => (
                <span className="tabular-nums">
                  {i.quantity}
                  {i.freeQuantity > 0 ? ` + ${i.freeQuantity} free` : ""}
                  <span className="block text-xs text-zinc-500">× {i.packSize} = {i.units} units</span>
                </span>
              ),
            },
            { key: "rate", header: "Rate", align: "right", hideOnMobile: true, cell: (i) => money(i.rate) },
            { key: "mrp", header: "MRP", align: "right", hideOnMobile: true, cell: (i) => (i.mrp ? money(i.mrp) : "—") },
            { key: "gst", header: "GST", align: "right", hideOnMobile: true, cell: (i) => `${Number(i.gstRate)}%` },
            { key: "amount", header: "Amount", align: "right", cell: (i) => <span className="font-semibold tabular-nums">{money(i.amount)}</span> },
          ]}
        />
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Totals">
          <DetailList
            items={[
              { label: "Before tax", value: money(bill.subtotal) },
              { label: "GST", value: money(bill.taxTotal) },
              { label: "Bill total", value: <span className="text-lg font-bold">{money(bill.total)}</span> },
            ]}
          />
        </Panel>
        <Panel title="Record">
          <DetailList
            items={[
              { label: "Entered", value: `${bill.enteredByName} · ${formatDateTime(bill.createdAt, ctx.timezone)}` },
              { label: "Supplier", value: [bill.supplier.name, bill.supplier.taxId ? `GSTIN ${bill.supplier.taxId}` : null].filter(Boolean).join(" · ") },
              { label: "Notes", value: bill.notes ?? "—" },
            ]}
          />
        </Panel>
      </div>
    </PageShell>
  );
}
