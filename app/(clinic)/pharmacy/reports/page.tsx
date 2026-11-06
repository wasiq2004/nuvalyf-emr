import { BarChart3, Download, FileSpreadsheet } from "lucide-react";
import { buttonClass } from "@/components/app/buttons";
import { EmptyState, PageHeader, PageShell, Panel } from "@/components/app/page";
import { DataTable } from "@/components/app/data-table";
import { TabNav } from "@/components/app/tabs";
import { inputClass } from "@/components/app/styles";
import { requireClinic } from "@/lib/auth/clinic-session";
import { withClinic } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { todayInTimeZone } from "@/lib/time";
import { cn } from "@/lib/utils";
import { getClinicSettings } from "@/features/settings/settings.service";
import { getPharmacySettings } from "@/features/pharmacy/settings.service";
import { REPORT_VIEWS, buildReport, parseReportParams, type Cell, type Column, type ReportParams } from "@/features/pharmacy/report-views";

export const metadata = { title: "Pharmacy reports" };

function query(p: ReportParams, extra: Record<string, string> = {}) {
  const view = REPORT_VIEWS.find((v) => v.key === p.view)!;
  const base: Record<string, string> = view.period === "month" ? { view: p.view, month: p.month } : view.period === "asOn" ? { view: p.view, to: p.toDate } : { view: p.view, from: p.fromDate, to: p.toDate };
  if (p.view === "register" && p.withH) base.h = "1";
  return new URLSearchParams({ ...base, ...extra }).toString();
}

export default async function PharmacyReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requireClinic({ permission: "pharmacy:reports", module: "pharmacy" });
  const today = todayInTimeZone(ctx.timezone);
  const p = parseReportParams(await searchParams, today);
  const view = REPORT_VIEWS.find((v) => v.key === p.view)!;
  const data = await withClinic({ clinicId: ctx.clinicId, userId: ctx.userId }, async (tx) => {
    const settings = await getPharmacySettings(tx, ctx.clinicId);
    return { settings, currency: (await getClinicSettings(tx, ctx.clinicId)).currency, sections: await buildReport(tx, p, ctx.timezone, settings) };
  });
  const show = (c: Column, v: Cell) => {
    if (v === null || v === undefined || v === "") return "—";
    if (c.kind === "money") return formatMoney(String(v), data.currency);
    if (c.kind === "percent") return `${v} %`;
    return String(v);
  };

  return (
    <PageShell width="wide">
      <PageHeader
        icon={BarChart3}
        title="Pharmacy reports"
        description="Sales, margins, GST returns, the Schedule H1 register and stock, all added up from bills, credit notes, supplier bills and the stock ledger. Every export is recorded in the audit log."
      />
      <TabNav label="Report" active={p.view} tabs={REPORT_VIEWS.map((v) => ({ key: v.key, label: v.label, href: `/pharmacy/reports?${query({ ...p, view: v.key })}` }))} />

      {!data.settings.gstin && (p.view === "gstr1" || p.view === "gstr3b") && (
        <p className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">
          The pharmacy&apos;s GSTIN is not set in Pharmacy settings. These figures are still correct, but a GST return needs it.
        </p>
      )}

      <form action="/pharmacy/reports" className="flex flex-wrap items-end gap-3 rounded-2xl border border-zinc-200/70 bg-white/80 px-5 py-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/70">
        <input type="hidden" name="view" value={p.view} />
        {view.period === "month" ? (
          <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Month
            <input type="month" name="month" defaultValue={p.month} max={today.slice(0, 7)} className={cn(inputClass, "mt-1.5 h-10")} />
          </label>
        ) : view.period === "asOn" ? (
          <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            At the end of
            <input type="date" name="to" defaultValue={p.toDate} max={today} className={cn(inputClass, "mt-1.5 h-10")} />
          </label>
        ) : (
          <>
            <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              From
              <input type="date" name="from" defaultValue={p.fromDate} max={today} className={cn(inputClass, "mt-1.5 h-10")} />
            </label>
            <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              To
              <input type="date" name="to" defaultValue={p.toDate} max={today} className={cn(inputClass, "mt-1.5 h-10")} />
            </label>
          </>
        )}
        {p.view === "register" && (
          <label className="flex h-10 items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
            <input type="checkbox" name="h" value="1" defaultChecked={p.withH} className="h-4 w-4 accent-(--accent)" /> Include Schedule H
          </label>
        )}
        <button type="submit" className={buttonClass("secondary", "md")}>
          Show
        </button>
        <p className="ml-auto text-xs text-zinc-500">{view.period === "range" ? "Up to a year at a time. " : ""}Dates are in {ctx.timezone}.</p>
      </form>

      {data.sections.map((s) => {
        const rows = s.totals ? [...s.rows.map((r, i) => ({ r, i, total: false })), { r: s.totals, i: -1, total: true }] : s.rows.map((r, i) => ({ r, i, total: false }));
        return (
          <Panel
            key={s.key}
            flush
            title={s.title}
            description={s.description}
            actions={
              s.rows.length > 0 ? (
                <a href={`/pharmacy/reports/export?${query(p, { section: s.key })}`} className={buttonClass("secondary", "sm")}>
                  <Download className="h-4 w-4" /> CSV
                </a>
              ) : undefined
            }
          >
            <DataTable
              rows={rows}
              rowKey={(x) => String(x.i)}
              empty={rows.length === 0 ? <EmptyState icon={FileSpreadsheet} title="Nothing in this period" /> : undefined}
              columns={s.columns.map((c, ci) => ({
                key: c.key,
                header: c.label,
                align: c.kind === "money" || c.kind === "number" || c.kind === "percent" ? ("right" as const) : undefined,
                hideOnMobile: ci > 3,
                cell: (x: { r: Record<string, Cell>; total: boolean }) => (
                  <span className={cn("whitespace-nowrap", c.kind !== "text" && "tabular-nums", x.total && "font-semibold text-zinc-900 dark:text-zinc-100")}>
                    {x.total && x.r[c.key] === undefined ? "" : show(c, x.r[c.key] ?? null)}
                  </span>
                ),
              }))}
            />
          </Panel>
        );
      })}
    </PageShell>
  );
}
