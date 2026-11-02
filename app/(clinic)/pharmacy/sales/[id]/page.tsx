import Link from "next/link";
import { forbidden, notFound } from "next/navigation";
import { z } from "zod";
import { ArrowLeft, FileDown, Receipt, ShoppingCart } from "lucide-react";
import { ButtonLink, buttonClass } from "@/components/app/buttons";
import { DetailList, EmptyState, PageHeader, PageShell, Panel } from "@/components/app/page";
import { DataTable } from "@/components/app/data-table";
import { SaleReturnBadge, ScheduleBadge } from "@/components/pharmacy/badges";
import { DOCUMENT_TYPE_LABELS, MONEY_METHOD_LABELS } from "@/components/pharmacy/status";
import { can, recordDenied, requireClinic } from "@/lib/auth/clinic-session";
import { withClinic } from "@/lib/db";
import { formatDate, formatDateTime } from "@/lib/format";
import { formatMoney, fromMinor, toMinor } from "@/lib/money";
import { toZonedDateTime, todayInTimeZone } from "@/lib/time";
import { getClinicSettings } from "@/features/settings/settings.service";
import { getSale } from "@/features/pharmacy/sales.service";
import { listSaleReturns, returnStateOf, returnableLines } from "@/features/pharmacy/returns.service";
import { describeQuantity, packWord, unitWord } from "@/features/pharmacy/selling-rules";
import { CancelSaleDialog, ReturnItemsDialog } from "./SaleActions";

export const metadata = { title: "Pharmacy sale" };

export default async function SalePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireClinic({ module: "pharmacy" });
  if (!can(ctx, "pharmacy:sell") && !can(ctx, "pharmacy:dispense")) {
    await recordDenied(ctx, "PAGE_ACCESS_DENIED", { required: ["pharmacy:sell", "pharmacy:dispense"], path: "/pharmacy/sales/[id]" });
    forbidden();
  }
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const data = await withClinic({ clinicId: ctx.clinicId, userId: ctx.userId }, async (tx) => {
    const sale = await getSale(tx, id);
    if (!sale) return null;
    return {
      sale,
      currency: (await getClinicSettings(tx, ctx.clinicId)).currency,
      state: await returnStateOf(tx, id),
      returnable: await returnableLines(tx, id),
      notes: await listSaleReturns(tx, id),
    };
  });
  if (!data) notFound();
  const { sale } = data;
  const money = (v: string) => formatMoney(v, data.currency);
  const gross = sale.items.reduce((s, i) => s + toMinor(i.amount), 0);
  const taxable = sale.items.reduce((s, i) => s + toMinor(i.taxable ?? i.net ?? i.amount), 0);
  const cgst = sale.items.reduce((s, i) => s + toMinor(i.cgst), 0);
  const sgst = sale.items.reduce((s, i) => s + toMinor(i.sgst), 0);
  const igst = sale.items.reduce((s, i) => s + toMinor(i.igst), 0);
  const gstSale = sale.fiscalYear !== null;
  const anyReturnable = data.returnable.some((l) => l.returnable > 0);
  const cancellable = data.state === "none" && toZonedDateTime(sale.soldAt, ctx.timezone).date === todayInTimeZone(ctx.timezone);
  const scheduled = sale.items.some((i) => i.schedule !== "none");

  return (
    <PageShell width="wide">
      <Link href="/pharmacy" className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-white">
        <ArrowLeft className="h-4 w-4" /> Pharmacy
      </Link>
      <PageHeader
        icon={Receipt}
        eyebrow={
          <span className="normal-case tracking-normal">
            <span className="font-mono">{sale.number}</span> · {DOCUMENT_TYPE_LABELS[sale.documentType] ?? sale.documentType}
          </span>
        }
        title={money(sale.total)}
        description={`${sale.customer} · ${MONEY_METHOD_LABELS[sale.method] ?? sale.method}${sale.reference ? ` (${sale.reference})` : ""} · ${formatDateTime(sale.soldAt, ctx.timezone)} · ${sale.soldByName}`}
        actions={
          <>
            <SaleReturnBadge state={data.state} />
            <a href={`/pharmacy/sales/${sale.id}/pdf`} target="_blank" rel="noopener" className={buttonClass("secondary", "md")}>
              <FileDown className="h-4 w-4" /> {gstSale ? "Invoice PDF" : "Receipt PDF"}
            </a>
            {can(ctx, "pharmacy:return") && data.state !== "cancelled" && anyReturnable && (
              <ReturnItemsDialog
                saleId={sale.id}
                lines={data.returnable.map((l) => ({
                  id: l.id,
                  description: l.description,
                  batchNo: l.batchNo,
                  quantity: l.quantity,
                  returnable: l.returnable,
                  unitLabel: unitWord(sale.items.find((i) => i.id === l.id)?.form ?? "other", l.quantity),
                }))}
              />
            )}
            {can(ctx, "pharmacy:cancel") && cancellable && <CancelSaleDialog saleId={sale.id} number={sale.number} />}
            {can(ctx, "pharmacy:sell") && (
              <ButtonLink href="/pharmacy/sale">
                <ShoppingCart className="h-4 w-4" /> New sale
              </ButtonLink>
            )}
          </>
        }
      />

      <Panel flush title={sale.prescriptionId ? "Dispensed against a prescription" : "Counter sale"}>
        <DataTable
          rows={sale.items}
          rowKey={(i) => i.id}
          columns={[
            {
              key: "item",
              header: "Medicine",
              cell: (i) => (
                <div>
                  <p className="flex flex-wrap items-center gap-2 font-medium text-zinc-900 dark:text-zinc-100">
                    {i.description} <ScheduleBadge schedule={i.schedule} />
                  </p>
                  <p className="text-xs text-zinc-500">
                    Batch {i.batchNo} · exp {formatDate(i.expiryDate, "UTC")}
                    {i.hsn ? ` · HSN ${i.hsn}` : ""}
                  </p>
                </div>
              ),
            },
            { key: "qty", header: "Qty", align: "right", cell: (i) => describeQuantity(i, i.form) },
            {
              key: "price",
              header: "Price",
              align: "right",
              hideOnMobile: true,
              cell: (i) => `${money(i.unitPrice)} / ${i.soldAs === "pack" ? packWord(i.form) : unitWord(i.form)}`,
            },
            ...(gstSale ? [{ key: "gst", header: "GST", align: "right" as const, hideOnMobile: true, cell: (i: (typeof sale.items)[number]) => `${Number(i.gstRate)} %` }] : []),
            {
              key: "amount",
              header: "Amount",
              align: "right",
              cell: (i) => (
                <span className="tabular-nums">
                  <span className="font-medium">{money(i.net ?? i.amount)}</span>
                  {toMinor(i.discount) > 0 && <span className="block text-xs text-zinc-500">after {money(i.discount)} off</span>}
                </span>
              ),
            },
          ]}
        />
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Totals">
          <DetailList
            items={[
              { label: "Items", value: money(fromMinor(gross)) },
              ...(toMinor(sale.discount) > 0 ? [{ label: "Discount", value: `− ${money(sale.discount)}` }] : []),
              ...(gstSale && sale.documentType === "tax_invoice"
                ? [
                    { label: "Taxable value", value: money(fromMinor(taxable)) },
                    ...(igst > 0 ? [{ label: "IGST", value: money(fromMinor(igst)) }] : [{ label: "CGST", value: money(fromMinor(cgst)) }, { label: "SGST", value: money(fromMinor(sgst)) }]),
                  ]
                : []),
              ...(toMinor(sale.roundOff) !== 0 ? [{ label: "Round-off", value: money(sale.roundOff) }] : []),
              { label: "Total", value: <span className="text-lg font-bold">{money(sale.total)}</span> },
            ]}
          />
        </Panel>
        <Panel title="Buyer">
          <DetailList
            items={[
              { label: "Customer", value: sale.customer },
              ...(sale.customerGstin ? [{ label: "GSTIN", value: <span className="font-mono">{sale.customerGstin}</span> }] : []),
              ...(scheduled || sale.prescriberName
                ? [
                    { label: "Prescriber", value: [sale.prescriberName, sale.prescriberRegNo ? `Reg. ${sale.prescriberRegNo}` : null].filter(Boolean).join(" · ") || "—" },
                    { label: "Patient address", value: sale.patientAddress ?? "—" },
                  ]
                : []),
            ]}
          />
        </Panel>
      </div>

      <Panel flush title="Credit notes" description="Returns and cancellations of this sale. Each one is a separate, permanent document.">
        <DataTable
          rows={data.notes}
          rowKey={(n) => n.id}
          empty={<EmptyState icon={Receipt} title="Nothing returned" />}
          columns={[
            {
              key: "number",
              header: "Credit note",
              cell: (n) => (
                <Link href={`/pharmacy/returns/${n.id}`} className="font-mono text-sm font-semibold text-(--accent-text) hover:underline">
                  {n.number}
                </Link>
              ),
            },
            { key: "kind", header: "", cell: (n) => (n.kind === "cancellation" ? "Cancellation" : "Return") },
            { key: "reason", header: "Reason", hideOnMobile: true, cell: (n) => n.reason },
            { key: "when", header: "When", hideOnMobile: true, cell: (n) => `${formatDateTime(n.createdAt, ctx.timezone)} · ${n.createdByName}` },
            { key: "refund", header: "Refund", align: "right", cell: (n) => <span className="font-semibold tabular-nums">{money(n.total)}</span> },
          ]}
        />
      </Panel>
    </PageShell>
  );
}
