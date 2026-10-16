import Link from "next/link";
import { BarChart3, Banknote, Eye, ShieldAlert, Stethoscope, UserPlus, Wallet } from "lucide-react";
import { EmptyState, PageHeader, PageShell, Panel, StatCard } from "@/components/app/page";
import { DataTable } from "@/components/app/data-table";
import { TabNav } from "@/components/app/tabs";
import { BarChartPanel } from "@/components/app/charts";
import { can, requireClinic } from "@/lib/auth/clinic-session";
import { withClinic } from "@/lib/db";
import { formatMoney, fromMinor, toMinor } from "@/lib/money";
import { addDaysToDateString, todayInTimeZone, zonedTimeToUtc } from "@/lib/time";
import { getClinicSettings } from "@/features/settings/settings.service";
import { collectionsByDay, collectionsByMethod, newPatients, outstandingAging, visitsByDay, visitsByDoctor } from "@/features/reports/reports.service";
import { auditSummary } from "@/features/audit/audit.service";
import { PAYMENT_METHOD_LABELS, type PaymentMethod } from "@/features/billing/billing-rules";

export const metadata = { title: "Reports" };

const RANGES = [
  { key: "7", label: "7 days" },
  { key: "30", label: "30 days" },
  { key: "90", label: "90 days" },
];

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const ctx = await requireClinic({ permission: "reports:read", module: "reports" });
  const { range: rawRange } = await searchParams;
  const days = Number(RANGES.find((r) => r.key === rawRange)?.key ?? "30");
  const today = todayInTimeZone(ctx.timezone);
  const fromDate = addDaysToDateString(today, -(days - 1));
  const range = {
    from: zonedTimeToUtc(fromDate, "00:00", ctx.timezone),
    to: zonedTimeToUtc(addDaysToDateString(today, 1), "00:00", ctx.timezone),
    fromDate,
    toDate: today,
    timeZone: ctx.timezone,
  };
  const showAudit = can(ctx, "audit:read");

  const data = await withClinic({ clinicId: ctx.clinicId, userId: ctx.userId }, async (tx) => ({
    currency: (await getClinicSettings(tx, ctx.clinicId)).currency,
    byDay: await collectionsByDay(tx, range),
    byMethod: await collectionsByMethod(tx, range),
    aging: await outstandingAging(tx, new Date()),
    visits: await visitsByDay(tx, range),
    doctors: await visitsByDoctor(tx, range),
    newPatients: await newPatients(tx, range),
    audit: showAudit ? await auditSummary(tx, range, ctx.timezone) : null,
  }));
  const money = (v: string) => formatMoney(v, data.currency);
  const billingTotal = fromMinor(data.byDay.reduce((s, d) => s + toMinor(d.billing), 0));
  const pharmacyTotal = fromMinor(data.byDay.reduce((s, d) => s + toMinor(d.pharmacy), 0));
  const owed = fromMinor(data.aging.reduce((s, a) => s + toMinor(a.amount), 0));
  const seen = data.visits.reduce((s, v) => s + v.seen, 0);

  const allDays = Array.from({ length: days }, (_, i) => addDaysToDateString(fromDate, i));
  const moneyChart = allDays.map((day) => {
    const row = data.byDay.find((d) => d.day === day);
    return { day: day.slice(5), Billing: row ? toMinor(row.billing) / 100 : 0, Pharmacy: row ? toMinor(row.pharmacy) / 100 : 0 };
  });
  const visitChart = allDays.map((day) => {
    const row = data.visits.find((v) => v.day === day);
    return { day: day.slice(5), Seen: row?.seen ?? 0, "Left / cancelled": row?.left ?? 0 };
  });

  return (
    <PageShell>
      <PageHeader icon={BarChart3} eyebrow={ctx.clinicName} title="Reports" description="Money in, money owed and how busy the clinic has been. Aggregates only: no patient-level detail." />
      <TabNav label="Period" active={String(days)} tabs={RANGES.map((r) => ({ key: r.key, label: r.label, href: `/reports?range=${r.key}` }))} />

      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Collected" value={money(fromMinor(toMinor(billingTotal) + toMinor(pharmacyTotal)))} icon={Banknote} hint={`Clinic ${money(billingTotal)} · Pharmacy ${money(pharmacyTotal)}`} />
        <StatCard label="Outstanding now" value={money(owed)} icon={Wallet} hint={`${data.aging.reduce((s, a) => s + a.invoices, 0)} invoices`} />
        <StatCard label="Patients seen" value={seen} icon={Stethoscope} hint={`${data.visits.reduce((s, v) => s + v.total, 0)} visits in total`} />
        <StatCard label="New patients" value={data.newPatients} icon={UserPlus} />
      </div>

      <Panel title="Collections per day">
        <BarChartPanel data={moneyChart} xKey="day" stacked bars={[{ key: "Billing", label: "Clinic billing" }, { key: "Pharmacy", label: "Pharmacy" }]} />
      </Panel>

      <div className="grid gap-6 xl:grid-cols-2">
        <Panel flush title="By payment method">
          <DataTable
            rows={data.byMethod}
            rowKey={(m) => m.method}
            empty={<EmptyState icon={Banknote} title="No money received in this period" />}
            columns={[
              { key: "method", header: "Method", cell: (m) => PAYMENT_METHOD_LABELS[m.method as PaymentMethod] ?? m.method },
              { key: "billing", header: "Clinic", align: "right", cell: (m) => money(m.billing) },
              { key: "pharmacy", header: "Pharmacy", align: "right", cell: (m) => money(m.pharmacy) },
              { key: "total", header: "Total", align: "right", cell: (m) => <span className="font-semibold">{money(m.total)}</span> },
            ]}
          />
        </Panel>
        <Panel flush title="Outstanding by age" description="Issued invoices with a balance, by days since issue.">
          <DataTable
            rows={data.aging}
            rowKey={(a) => a.bucket}
            columns={[
              { key: "bucket", header: "Age", cell: (a) => `${a.bucket} days` },
              { key: "invoices", header: "Invoices", align: "right", cell: (a) => a.invoices },
              { key: "amount", header: "Owed", align: "right", cell: (a) => <span className={a.bucket === "90+" && toMinor(a.amount) > 0 ? "font-semibold text-red-600" : "font-semibold"}>{money(a.amount)}</span> },
            ]}
          />
          <div className="border-t border-zinc-100 px-6 py-3 text-right lg:px-8 dark:border-zinc-800">
            <Link href="/billing?show=outstanding" className="text-sm font-medium text-(--accent-text) hover:underline">
              See outstanding invoices
            </Link>
          </div>
        </Panel>
      </div>

      <Panel title="Visits per day">
        <BarChartPanel data={visitChart} xKey="day" stacked bars={[{ key: "Seen", label: "Seen" }, { key: "Left / cancelled", label: "Left / cancelled" }]} />
      </Panel>

      <Panel flush title="By doctor">
        <DataTable
          rows={data.doctors}
          rowKey={(d) => d.doctor}
          empty={<EmptyState icon={Stethoscope} title="No visits in this period" />}
          columns={[
            { key: "doctor", header: "Doctor", cell: (d) => d.doctor },
            { key: "seen", header: "Seen", align: "right", cell: (d) => d.seen },
            { key: "emergencies", header: "Emergencies", align: "right", cell: (d) => d.emergencies },
            { key: "wait", header: "Average wait", align: "right", cell: (d) => (d.avg_wait === null ? "—" : `${d.avg_wait} min`) },
          ]}
        />
      </Panel>

      {data.audit && (
        <Panel
          title="Audit trail"
          description="A summary; the full trail is in the compliance panel."
          actions={
            <Link href="/audit/summary" className="text-sm font-medium text-(--accent-text) hover:underline">
              Open compliance panel
            </Link>
          }
        >
          <div className="grid gap-5 sm:grid-cols-3">
            <StatCard label="Records opened" value={data.audit.totals.recordViews.toLocaleString()} icon={Eye} />
            <StatCard label="Refused attempts" value={data.audit.totals.denied} icon={ShieldAlert} />
            <StatCard label="Failed sign-ins" value={data.audit.totals.failedSignIns} icon={ShieldAlert} />
          </div>
        </Panel>
      )}
    </PageShell>
  );
}
