import Link from "next/link";
import { forbidden, notFound } from "next/navigation";
import { z } from "zod";
import { ArrowLeft, FileDown, PackageMinus } from "lucide-react";
import { buttonClass } from "@/components/app/buttons";
import { DetailList, PageHeader, PageShell, Panel } from "@/components/app/page";
import { DataTable } from "@/components/app/data-table";
import { can, recordDenied, requireClinic } from "@/lib/auth/clinic-session";
import { withClinic } from "@/lib/db";
import { formatDate, formatDateTime } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { getClinicSettings } from "@/features/settings/settings.service";
import { getPurchaseReturn } from "@/features/pharmacy/supplier-accounts.service";

export const metadata = { title: "Debit note" };

export default async function DebitNotePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireClinic({ module: "pharmacy" });
  if (!can(ctx, "stock:manage") && !can(ctx, "purchase:create") && !can(ctx, "accounts:manage")) {
    await recordDenied(ctx, "PAGE_ACCESS_DENIED", { required: ["stock:manage", "purchase:create", "accounts:manage"], path: "/pharmacy/purchases/returns/[id]" });
    forbidden();
  }
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const data = await withClinic({ clinicId: ctx.clinicId, userId: ctx.userId }, async (tx) => {
    const note = await getPurchaseReturn(tx, id);
    return note ? { note, currency: (await getClinicSettings(tx, ctx.clinicId)).currency } : null;
  });
  if (!data) notFound();
  const { note } = data;
  const money = (v: string) => formatMoney(v, data.currency);

  return (
    <PageShell width="wide">
      <Link href="/pharmacy/purchases" className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-white">
        <ArrowLeft className="h-4 w-4" /> Purchases
      </Link>
      <PageHeader
        icon={PackageMinus}
        eyebrow={<span className="font-mono normal-case tracking-normal">{note.number} · Debit note</span>}
        title={note.supplier.name}
        description={`${money(note.total)} · ${formatDateTime(note.createdAt, ctx.timezone)} · ${note.createdByName}`}
        actions={
          <a href={`/pharmacy/purchases/returns/${note.id}/pdf`} target="_blank" rel="noopener" className={buttonClass("secondary", "md")}>
            <FileDown className="h-4 w-4" /> Debit note PDF
          </a>
        }
      />
      <Panel flush title="Sent back" description="These units left stock when the note was issued.">
        <DataTable
          rows={note.items}
          rowKey={(i) => i.id}
          columns={[
            {
              key: "item",
              header: "Medicine",
              cell: (i) => (
                <div>
                  <p className="font-medium text-zinc-900 dark:text-zinc-100">{i.drugName}</p>
                  <p className="text-xs text-zinc-500">
                    Batch {i.batchNo} · exp {formatDate(i.expiryDate, "UTC")}
                  </p>
                </div>
              ),
            },
            { key: "qty", header: "Units", align: "right", cell: (i) => i.quantity },
            { key: "cost", header: "Cost each", align: "right", hideOnMobile: true, cell: (i) => money(i.unitCost) },
            { key: "gst", header: "GST", align: "right", hideOnMobile: true, cell: (i) => `${money(i.tax)} (${Number(i.gstRate)} %)` },
            { key: "taxable", header: "Taxable", align: "right", cell: (i) => <span className="font-medium tabular-nums">{money(i.taxable)}</span> },
          ]}
        />
      </Panel>
      <Panel title="Totals">
        <DetailList
          items={[
            { label: "Reason", value: note.reason },
            { label: "Supplier GSTIN", value: note.supplier.taxId ? <span className="font-mono">{note.supplier.taxId}</span> : "—" },
            { label: "Taxable value", value: money(note.taxable) },
            { label: "GST", value: money(note.taxTotal) },
            { label: "Total", value: <span className="text-lg font-bold">{money(note.total)}</span> },
          ]}
        />
      </Panel>
    </PageShell>
  );
}
