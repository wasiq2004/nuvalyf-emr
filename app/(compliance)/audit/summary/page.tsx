import { Activity, Eye, KeyRound, ShieldAlert, Users } from "lucide-react";
import { EmptyState, PageHeader, PageShell, Panel, StatCard } from "@/components/app/page";
import { DataTable } from "@/components/app/data-table";
import { TabNav } from "@/components/app/tabs";
import { BarChartPanel } from "@/components/app/charts";
import { requireClinic } from "@/lib/auth/clinic-session";
import { recordAudit } from "@/lib/audit";
import { withClinic } from "@/lib/db";
import { getRequestMeta } from "@/lib/request";
import { formatDateTime, humanizeAction } from "@/lib/format";
import { addDaysToDateString, todayInTimeZone, zonedTimeToUtc } from "@/lib/time";
import { auditSummary } from "@/features/audit/audit.service";
import { ActionCell } from "../AuditViews";

export const metadata = { title: "Audit summary" };

const RANGES = [
  { key: "7", label: "7 days" },
  { key: "30", label: "30 days" },
  { key: "90", label: "90 days" },
];

export default async function AuditSummaryPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const ctx = await requireClinic({ permission: "audit:read" });
  const { range: rawRange } = await searchParams;
  const days = Number(RANGES.find((r) => r.key === rawRange)?.key ?? "30");
  const today = todayInTimeZone(ctx.timezone);
  const fromDate = addDaysToDateString(today, -(days - 1));
  const range = { from: zonedTimeToUtc(fromDate, "00:00", ctx.timezone), to: zonedTimeToUtc(addDaysToDateString(today, 1), "00:00", ctx.timezone) };
  const meta = await getRequestMeta();

  const summary = await withClinic({ clinicId: ctx.clinicId, userId: ctx.userId }, async (tx) => {
    const result = await auditSummary(tx, range, ctx.timezone);
    await recordAudit(tx, { clinicId: ctx.clinicId, actorUserId: ctx.userId, action: "AUDIT_SUMMARY_VIEWED", targetType: "audit", details: { days }, meta });
    return result;
  });

  // Every day in the range, including quiet ones.
  const perDay = Array.from({ length: days }, (_, i) => {
    const day = addDaysToDateString(fromDate, i);
    const row = summary.perDay.find((d) => d.day === day);
    return { day: day.slice(5), Events: row?.events ?? 0, Denied: row?.denied ?? 0 };
  });

  return (
    <PageShell>
      <PageHeader icon={Activity} eyebrow={ctx.clinicName} title="Audit summary" description="How the system is being used, and every access that was refused." />
      <TabNav label="Period" active={String(days)} tabs={RANGES.map((r) => ({ key: r.key, label: r.label, href: `/audit/summary?range=${r.key}` }))} />

      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Events" value={summary.totals.events.toLocaleString()} icon={Activity} hint={`${summary.totals.people} people`} />
        <StatCard label="Records opened" value={summary.totals.recordViews.toLocaleString()} icon={Eye} />
        <StatCard label="Refused" value={summary.totals.denied} icon={ShieldAlert} hint={`${summary.totals.critical} critical`} />
        <StatCard label="Failed sign-ins" value={summary.totals.failedSignIns} icon={KeyRound} />
      </div>

      <Panel title="Activity per day">
        <BarChartPanel data={perDay} xKey="day" bars={[{ key: "Events", label: "Events" }, { key: "Denied", label: "Refused" }]} />
      </Panel>

      <div className="grid gap-6 xl:grid-cols-2">
        <Panel flush title="Most active people">
          <DataTable
            rows={summary.topPeople}
            rowKey={(p) => p.actorId ?? "none"}
            empty={<EmptyState icon={Users} title="No activity" />}
            columns={[
              { key: "who", header: "Person", cell: (p) => p.name },
              { key: "events", header: "Events", align: "right", cell: (p) => p.events.toLocaleString() },
              { key: "views", header: "Records opened", align: "right", cell: (p) => p.views.toLocaleString() },
            ]}
          />
        </Panel>
        <Panel flush title="Most frequent events">
          <DataTable
            rows={summary.topActions}
            rowKey={(a) => a.action}
            empty={<EmptyState icon={Activity} title="No activity" />}
            columns={[
              { key: "what", header: "Event", cell: (a) => <ActionCell action={a.action} category={a.category} /> },
              { key: "n", header: "Times", align: "right", cell: (a) => a.n.toLocaleString() },
            ]}
          />
        </Panel>
      </div>

      <Panel flush title="Refused access" description="Attempts to reach something a role does not allow. Recorded as critical.">
        <DataTable
          rows={summary.denials}
          rowKey={(d) => d.id}
          empty={<EmptyState icon={ShieldAlert} title="Nothing refused in this period" />}
          columns={[
            { key: "when", header: "When", cell: (d) => formatDateTime(d.createdAt, ctx.timezone) },
            { key: "who", header: "Who", cell: (d) => d.actorName ?? "—" },
            { key: "what", header: "What", cell: (d) => humanizeAction(d.action) },
            {
              key: "tried",
              header: "Tried",
              cell: (d) => <span className="font-mono text-xs">{String(d.details?.action ?? d.details?.path ?? (Array.isArray(d.details?.required) ? (d.details.required as string[]).join(" / ") : (d.details?.required ?? "—")))}</span>,
            },
          ]}
        />
      </Panel>
    </PageShell>
  );
}
