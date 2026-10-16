import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ArrowLeft, FileDown, Receipt } from "lucide-react";
import { buttonClass } from "@/components/app/buttons";
import { EmptyState, PageHeader, PageShell, Panel } from "@/components/app/page";
import { DataTable } from "@/components/app/data-table";
import { StatusBadge } from "@/components/app/status-badge";
import { InvoiceBadge } from "@/components/billing/status";
import { can, requireClinic } from "@/lib/auth/clinic-session";
import { recordAudit } from "@/lib/audit";
import { withClinic } from "@/lib/db";
import { getRequestMeta } from "@/lib/request";
import { formatDateTime } from "@/lib/format";
import { formatMoney, toMinor } from "@/lib/money";
import { getClinicSettings } from "@/features/settings/settings.service";
import { listServices } from "@/features/scheduling/services.service";
import { getInvoice } from "@/features/billing/billing.service";
import { PAYMENT_METHOD_LABELS, type PaymentMethod } from "@/features/billing/billing-rules";
import { AddLineForm, DiscardButton, DiscountForm, IssueButton, PaymentDialog, RefundDialog, RemoveLineButton, VoidButton } from "./BillingForms";

export const metadata = { title: "Invoice" };

const KIND_LABEL: Record<string, string> = { service: "Service", lab: "Lab", medicine: "Medicine", other: "Other" };

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireClinic({ permission: "billing:read" });
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const meta = await getRequestMeta();

  const data = await withClinic({ clinicId: ctx.clinicId, userId: ctx.userId }, async (tx) => {
    const invoice = await getInvoice(tx, id);
    if (!invoice) return null;
    await recordAudit(tx, {
      clinicId: ctx.clinicId,
      actorUserId: ctx.userId,
      action: "INVOICE_VIEWED",
      targetType: "invoice",
      targetId: id,
      patientId: invoice.patientId,
      meta,
    });
    const [settings, services] = await Promise.all([getClinicSettings(tx, ctx.clinicId), listServices(tx, { activeOnly: true })]);
    return { invoice, currency: settings.currency, services };
  });
  if (!data) notFound();

  const { invoice } = data;
  const money = (v: string) => formatMoney(v, data.currency);
  const canManage = can(ctx, "billing:manage");
  const draft = invoice.status === "draft";
  const issued = invoice.status === "issued";
  const hasBalance = toMinor(invoice.balance) > 0;

  return (
    <PageShell width="default">
      <Link href="/billing" className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-white">
        <ArrowLeft className="h-4 w-4" /> Billing
      </Link>

      <PageHeader
        icon={Receipt}
        eyebrow={<span className="font-mono normal-case tracking-normal">{invoice.number}</span>}
        title={invoice.patient.name}
        description={
          <>
            <Link href={`/patients/${invoice.patient.id}`} className="hover:underline">
              {invoice.patient.mrn}
            </Link>{" "}
            · created {formatDateTime(invoice.createdAt, ctx.timezone)}
          </>
        }
        actions={
          <>
            <InvoiceBadge status={invoice.status} paymentState={invoice.paymentState} />
            {canManage && draft && <DiscardButton invoiceId={invoice.id} number={invoice.number} />}
            {canManage && draft && invoice.items.length > 0 && <IssueButton invoiceId={invoice.id} />}
            {canManage && issued && toMinor(invoice.amountPaid) === 0 && <VoidButton invoiceId={invoice.id} number={invoice.number} />}
            {canManage && issued && toMinor(invoice.amountPaid) > 0 && <RefundDialog invoiceId={invoice.id} paid={invoice.amountPaid} paidLabel={money(invoice.amountPaid)} />}
            {canManage && (draft || issued) && hasBalance && invoice.items.length > 0 && (
              <PaymentDialog invoiceId={invoice.id} balance={invoice.balance} balanceLabel={money(invoice.balance)} />
            )}
            {!draft && (
              <a href={`/billing/${invoice.id}/pdf`} target="_blank" rel="noopener" className={buttonClass("secondary", "md")}>
                <FileDown className="h-4 w-4" /> PDF
              </a>
            )}
          </>
        }
      />

      {invoice.status === "void" && (
        <div className="rounded-2xl border border-zinc-200 bg-white/80 p-4 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-400">
          Voided {formatDateTime(invoice.voidedAt, ctx.timezone)}: &ldquo;{invoice.voidReason}&rdquo;
        </div>
      )}

      <Panel flush title="Lines" description={draft ? "Lines can be changed until the invoice is issued or paid." : undefined}>
        <DataTable
          rows={invoice.items}
          rowKey={(i) => i.id}
          empty={<EmptyState icon={Receipt} title="No lines yet" description="Add a service or another item below." />}
          columns={[
            {
              key: "description",
              header: "Item",
              cell: (i) => (
                <div>
                  <p className="font-medium text-zinc-900 dark:text-zinc-100">{i.description}</p>
                  <p className="text-xs text-zinc-500">{KIND_LABEL[i.kind]}</p>
                </div>
              ),
            },
            { key: "qty", header: "Qty", align: "right", cell: (i) => i.quantity },
            { key: "price", header: "Price", align: "right", hideOnMobile: true, cell: (i) => money(i.unitPrice) },
            { key: "amount", header: "Amount", align: "right", cell: (i) => <span className="font-medium">{money(i.amount)}</span> },
            ...(draft && canManage
              ? [{ key: "remove", header: "", align: "right" as const, cell: (i: (typeof invoice.items)[number]) => <RemoveLineButton id={i.id} description={i.description} /> }]
              : []),
          ]}
        />
        {draft && canManage && (
          <div className="border-t border-zinc-100 px-6 py-5 lg:px-8 dark:border-zinc-800">
            <AddLineForm invoiceId={invoice.id} services={data.services.map((s) => ({ id: s.id, name: s.name, price: s.price }))} />
          </div>
        )}
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Totals">
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-zinc-500">Subtotal</dt>
              <dd className="tabular-nums">{money(invoice.subtotal)}</dd>
            </div>
            {toMinor(invoice.discount) > 0 && (
              <div className="flex justify-between">
                <dt className="text-zinc-500">Discount{invoice.discountReason ? ` (${invoice.discountReason})` : ""}</dt>
                <dd className="tabular-nums">− {money(invoice.discount)}</dd>
              </div>
            )}
            <div className="flex justify-between border-t border-zinc-100 pt-2 text-base font-semibold dark:border-zinc-800">
              <dt>Total</dt>
              <dd className="tabular-nums">{money(invoice.total)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-zinc-500">Paid</dt>
              <dd className="tabular-nums">{money(invoice.amountPaid)}</dd>
            </div>
            <div className="flex justify-between text-base font-semibold">
              <dt>Balance due</dt>
              <dd className={hasBalance && issued ? "tabular-nums text-red-600 dark:text-red-400" : "tabular-nums"}>{money(invoice.balance)}</dd>
            </div>
          </dl>
          {draft && canManage && invoice.items.length > 0 && (
            <div className="mt-6 border-t border-zinc-100 pt-5 dark:border-zinc-800">
              <DiscountForm invoiceId={invoice.id} discount={invoice.discount} reason={invoice.discountReason ?? ""} />
            </div>
          )}
        </Panel>

        <Panel flush title="Payments" description="Recorded by staff. A correction is a refund; nothing is deleted.">
          {invoice.payments.length === 0 ? (
            <div className="p-6 lg:p-8">
              <EmptyState icon={Receipt} title="No payments yet" />
            </div>
          ) : (
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {invoice.payments.map((p) => (
                <li key={p.id} className="flex items-start justify-between gap-3 px-6 py-3 lg:px-8">
                  <div className="min-w-0 text-sm">
                    <p className="font-medium text-zinc-900 dark:text-zinc-100">
                      {PAYMENT_METHOD_LABELS[p.method as PaymentMethod] ?? p.method}
                      {p.reference ? <span className="font-normal text-zinc-500"> · {p.reference}</span> : null}
                    </p>
                    <p className="text-xs text-zinc-500">
                      {p.receivedByName} · {formatDateTime(p.receivedAt, ctx.timezone)}
                      {p.reason ? ` · ${p.reason}` : ""}
                    </p>
                  </div>
                  <span className="flex items-center gap-2">
                    {p.kind === "refund" && <StatusBadge tone="warning">Refund</StatusBadge>}
                    <span className="font-semibold tabular-nums">
                      {p.kind === "refund" ? "− " : ""}
                      {money(p.amount)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </PageShell>
  );
}
