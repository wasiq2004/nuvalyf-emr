import Link from "next/link";
import { forbidden, notFound } from "next/navigation";
import { z } from "zod";
import { ArrowLeft, FileDown, Undo2 } from "lucide-react";
import { buttonClass } from "@/components/app/buttons";
import { DetailList, PageHeader, PageShell, Panel } from "@/components/app/page";
import { DataTable } from "@/components/app/data-table";
import { StatusBadge } from "@/components/app/status-badge";
import { MONEY_METHOD_LABELS } from "@/components/pharmacy/status";
import { can, recordDenied, requireClinic } from "@/lib/auth/clinic-session";
import { withClinic } from "@/lib/db";
import { formatDate, formatDateTime } from "@/lib/format";
import { formatMoney, fromMinor, toMinor } from "@/lib/money";
import { getClinicSettings } from "@/features/settings/settings.service";
import { getSaleReturn } from "@/features/pharmacy/returns.service";
import { unitWord } from "@/features/pharmacy/selling-rules";

export const metadata = { title: "Credit note" };

export default async function CreditNotePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireClinic({ module: "pharmacy" });
  if (!can(ctx, "pharmacy:sell") && !can(ctx, "pharmacy:dispense") && !can(ctx, "pharmacy:return")) {
    await recordDenied(ctx, "PAGE_ACCESS_DENIED", { required: ["pharmacy:sell", "pharmacy:dispense", "pharmacy:return"], path: "/pharmacy/returns/[id]" });
    forbidden();
  }
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const data = await withClinic({ clinicId: ctx.clinicId, userId: ctx.userId }, async (tx) => {
    const note = await getSaleReturn(tx, id);
    return note ? { note, currency: (await getClinicSettings(tx, ctx.clinicId)).currency } : null;
  });
  if (!data) notFound();
  const { note } = data;
  const money = (v: string) => formatMoney(v, data.currency);
  const sum = (pick: (i: (typeof note.items)[number]) => string) => fromMinor(note.items.reduce((s, i) => s + toMinor(pick(i)), 0));
  const taxInvoice = note.sale.documentType === "tax_invoice";
  const igst = toMinor(sum((i) => i.igst)) > 0;

  return (
    <PageShell width="wide">
      <Link href={note.saleId ? `/pharmacy/sales/${note.saleId}` : "/pharmacy"} className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-white">
        <ArrowLeft className="h-4 w-4" /> {note.saleId ? `Sale ${note.sale.number}` : "Pharmacy"}
      </Link>
      <PageHeader
        icon={Undo2}
        eyebrow={<span className="font-mono normal-case tracking-normal">{note.number} · Credit note</span>}
        title={money(note.total)}
        description={`${note.sale.customer} · ${note.refundMethod === "account" ? "credited to the account" : `refunded by ${MONEY_METHOD_LABELS[note.refundMethod] ?? note.refundMethod}`} · ${formatDateTime(note.createdAt, ctx.timezone)} · ${note.createdByName}`}
        actions={
          <>
            <StatusBadge tone={note.kind === "cancellation" ? "danger" : "warning"}>{note.kind === "cancellation" ? "Sale cancelled" : "Return"}</StatusBadge>
            <a href={`/pharmacy/returns/${note.id}/pdf`} target="_blank" rel="noopener" className={buttonClass("secondary", "md")}>
              <FileDown className="h-4 w-4" /> Credit note PDF
            </a>
          </>
        }
      />

      <Panel flush title="Taken back" description={note.saleId ? "These units went back into the same batches they were sold from." : "On a bill from the old software. Units fit to resell are back in stock; the rest were written off."}>
        <DataTable
          rows={note.items}
          rowKey={(i) => i.id}
          columns={[
            {
              key: "item",
              header: "Medicine",
              cell: (i) => (
                <div>
                  <p className="font-medium text-zinc-900 dark:text-zinc-100">{i.description}</p>
                  <p className="text-xs text-zinc-500">
                    Batch {i.batchNo} · exp {formatDate(i.expiryDate, "UTC")}
                    {i.hsn ? ` · HSN ${i.hsn}` : ""}
                  </p>
                </div>
              ),
            },
            { key: "qty", header: "Qty", align: "right", cell: (i) => `${i.quantity} ${unitWord(i.form, i.quantity)}` },
            ...(taxInvoice
              ? [
                  { key: "taxable", header: "Taxable", align: "right" as const, hideOnMobile: true, cell: (i: (typeof note.items)[number]) => money(i.taxable) },
                  {
                    key: "tax",
                    header: "GST",
                    align: "right" as const,
                    hideOnMobile: true,
                    cell: (i: (typeof note.items)[number]) => `${money(fromMinor(toMinor(i.cgst) + toMinor(i.sgst) + toMinor(i.igst)))} (${Number(i.gstRate ?? 0)} %)`,
                  },
                ]
              : []),
            { key: "net", header: "Refund", align: "right", cell: (i) => <span className="font-medium tabular-nums">{money(i.net)}</span> },
          ]}
        />
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Totals">
          <DetailList
            items={[
              { label: "Goods returned", value: money(sum((i) => i.net)) },
              ...(taxInvoice
                ? [
                    { label: "Taxable value", value: money(sum((i) => i.taxable)) },
                    ...(igst ? [{ label: "IGST reversed", value: money(sum((i) => i.igst)) }] : [{ label: "CGST reversed", value: money(sum((i) => i.cgst)) }, { label: "SGST reversed", value: money(sum((i) => i.sgst)) }]),
                  ]
                : []),
              ...(toMinor(note.roundOff) !== 0 ? [{ label: "Round-off given back", value: money(note.roundOff) }] : []),
              { label: note.refundMethod === "account" ? "Credited" : "Refunded", value: <span className="text-lg font-bold">{money(note.total)}</span> },
            ]}
          />
        </Panel>
        <Panel title="Details">
          <DetailList
            items={[
              { label: "Reason", value: note.reason },
              {
                label: note.kind === "cancellation" ? "Cancels" : "Against",
                value: note.saleId ? (
                  <Link href={`/pharmacy/sales/${note.saleId}`} className="font-mono font-semibold text-(--accent-text) hover:underline">
                    {note.sale.number}
                  </Link>
                ) : (
                  <span className="font-mono font-semibold">{note.oldBillNo}</span>
                ),
              },
              { label: "Sale date", value: note.oldBillDate ? formatDate(note.oldBillDate, "UTC") : formatDateTime(note.sale.soldAt, ctx.timezone) },
              ...(note.sale.customerGstin ? [{ label: "Buyer GSTIN", value: <span className="font-mono">{note.sale.customerGstin}</span> }] : []),
            ]}
          />
        </Panel>
      </div>
    </PageShell>
  );
}
