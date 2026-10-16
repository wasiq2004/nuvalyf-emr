import Link from "next/link";
import { Banknote, FileText, Receipt, Wallet } from "lucide-react";
import { EmptyState, PageHeader, PageShell, Panel, StatCard } from "@/components/app/page";
import { DataTable } from "@/components/app/data-table";
import { TabNav } from "@/components/app/tabs";
import { InvoiceBadge } from "@/components/billing/status";
import { BillVisitButton } from "@/components/billing/billing-buttons";
import { can, requireClinic } from "@/lib/auth/clinic-session";
import { withClinic } from "@/lib/db";
import { formatDate, formatTime } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { addDaysToDateString, todayInTimeZone, zonedTimeToUtc } from "@/lib/time";
import { getClinicSettings } from "@/features/settings/settings.service";
import { collections, listInvoices, outstandingSummary, visitsToBill, type InvoiceFilter } from "@/features/billing/billing.service";
import { PAYMENT_METHOD_LABELS, PAYMENT_METHODS } from "@/features/billing/billing-rules";

export const metadata = { title: "Billing" };

const FILTERS: { key: InvoiceFilter; label: string }[] = [
  { key: "outstanding", label: "Outstanding" },
  { key: "drafts", label: "Drafts" },
  { key: "today", label: "Today" },
  { key: "all", label: "All" },
];

export default async function BillingPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const ctx = await requireClinic({ permission: "billing:read" });
  const { show } = await searchParams;
  const filter = (FILTERS.find((f) => f.key === show)?.key ?? "outstanding") as InvoiceFilter;
  const today = todayInTimeZone(ctx.timezone);
  const dayStart = zonedTimeToUtc(today, "00:00", ctx.timezone);
  const dayEnd = zonedTimeToUtc(addDaysToDateString(today, 1), "00:00", ctx.timezone);
  const canManage = can(ctx, "billing:manage");

  const data = await withClinic({ clinicId: ctx.clinicId, userId: ctx.userId }, async (tx) => ({
    currency: (await getClinicSettings(tx, ctx.clinicId)).currency,
    invoices: await listInvoices(tx, filter, dayStart, dayEnd),
    outstanding: await outstandingSummary(tx),
    collected: await collections(tx, dayStart, dayEnd),
    toBill: canManage ? await visitsToBill(tx, today) : [],
  }));
  const money = (v: string) => formatMoney(v, data.currency);
  const methodSplit = PAYMENT_METHODS.filter((m) => data.collected.byMethod[m])
    .map((m) => `${PAYMENT_METHOD_LABELS[m]} ${money(data.collected.byMethod[m]!)}`)
    .join(" · ");

  return (
    <PageShell>
      <PageHeader icon={Receipt} title="Billing" description="Invoices for visits and services. Payments are recorded here; no card or UPI processing happens in NuvaLyf." />

      <div className="grid gap-5 sm:grid-cols-3">
        <StatCard label="Collected today" value={money(data.collected.total)} icon={Banknote} hint={methodSplit || "Nothing yet"} />
        <StatCard label="Outstanding" value={money(data.outstanding.amount)} icon={Wallet} hint={`${data.outstanding.count} ${data.outstanding.count === 1 ? "invoice" : "invoices"}`} />
        <StatCard label="To bill today" value={data.toBill.length} icon={FileText} hint="Finished visits without an invoice" />
      </div>

      {data.toBill.length > 0 && (
        <Panel flush title="To bill" description="Today's finished visits. The invoice starts with the visit's service and any lab tests ordered.">
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {data.toBill.map((v) => (
              <li key={v.visitId} className="flex flex-wrap items-center justify-between gap-3 px-6 py-3 lg:px-8">
                <div>
                  <Link href={`/patients/${v.patientId}`} className="font-medium text-zinc-900 hover:underline dark:text-zinc-100">
                    {v.patientName}
                  </Link>
                  <p className="text-xs text-zinc-500">
                    {v.patientMrn}
                    {v.serviceName ? ` · ${v.serviceName}` : ""}
                    {v.completedAt ? ` · seen ${formatTime(v.completedAt, ctx.timezone)}` : ""}
                  </p>
                </div>
                <BillVisitButton visitId={v.visitId} patientName={v.patientName} />
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <TabNav label="Invoice filter" active={filter} tabs={FILTERS.map((f) => ({ key: f.key, label: f.label, href: `/billing?show=${f.key}` }))} />

      <Panel flush>
        <DataTable
          rows={data.invoices}
          rowKey={(i) => i.id}
          empty={<EmptyState icon={Receipt} title={filter === "outstanding" ? "Nothing outstanding" : "No invoices"} />}
          columns={[
            {
              key: "number",
              header: "Invoice",
              cell: (i) => (
                <Link href={`/billing/${i.id}`} className="font-mono text-sm font-semibold text-(--accent-text) hover:underline">
                  {i.number}
                </Link>
              ),
            },
            {
              key: "patient",
              header: "Patient",
              cell: (i) => (
                <div>
                  <p className="font-medium text-zinc-900 dark:text-zinc-100">{i.patientName}</p>
                  <p className="text-xs text-zinc-500">{i.patientMrn}</p>
                </div>
              ),
            },
            { key: "date", header: "Date", hideOnMobile: true, cell: (i) => formatDate(i.createdAt, ctx.timezone) },
            { key: "total", header: "Total", align: "right", cell: (i) => money(i.total) },
            { key: "balance", header: "Balance", align: "right", hideOnMobile: true, cell: (i) => (i.status === "issued" ? money(i.balance) : "—") },
            { key: "status", header: "", align: "right", cell: (i) => <InvoiceBadge status={i.status} paymentState={i.paymentState} /> },
          ]}
        />
      </Panel>
    </PageShell>
  );
}
