import { CheckCircle2, FlaskConical, Hourglass, Siren } from "lucide-react";
import { EmptyState, PageHeader, PageShell, Panel, StatCard } from "@/components/app/page";
import { DataTable } from "@/components/app/data-table";
import { StatusBadge } from "@/components/app/status-badge";
import { AutoRefresh } from "@/components/app/auto-refresh";
import { requireClinic } from "@/lib/auth/clinic-session";
import { withClinic } from "@/lib/db";
import { formatRelative, formatTime } from "@/lib/format";
import { todayInTimeZone, zonedTimeToUtc } from "@/lib/time";
import { listLabWorklist, listRecentResults, type LabWorkItem } from "@/features/clinical/lab.service";
import { EnterResultDialog } from "./LabActions";

export const metadata = { title: "Lab" };

const SEX_SHORT: Record<string, string> = { male: "M", female: "F", other: "O", unknown: "?" };

function Patient({ item }: { item: LabWorkItem }) {
  return (
    <div>
      <p className="font-medium text-zinc-900 dark:text-zinc-100">{item.patientName}</p>
      <p className="text-xs text-zinc-500">
        {item.patientMrn} · {item.patientAge ?? "—"} / {SEX_SHORT[item.patientSex] ?? "?"}
      </p>
    </div>
  );
}

export default async function LabPage() {
  const ctx = await requireClinic({ permission: "lab:result", module: "lab" });
  const today = todayInTimeZone(ctx.timezone);
  const startOfDay = zonedTimeToUtc(today, "00:00", ctx.timezone);
  const now = new Date();

  const { pending, done } = await withClinic({ clinicId: ctx.clinicId, userId: ctx.userId }, async (tx) => ({
    pending: await listLabWorklist(tx, today),
    done: await listRecentResults(tx, today, startOfDay),
  }));

  return (
    <PageShell>
      <AutoRefresh seconds={60} />
      <PageHeader icon={FlaskConical} eyebrow={ctx.clinicName} title="Lab worklist" description="Tests ordered by doctors, oldest first. Results go straight back to the ordering doctor." />

      <div className="grid gap-5 sm:grid-cols-3">
        <StatCard label="Waiting for a result" value={pending.length} icon={Hourglass} />
        <StatCard label="Resulted today" value={done.length} icon={CheckCircle2} />
        <StatCard label="Critical today" value={done.filter((d) => d.resultFlag === "critical").length} icon={Siren} />
      </div>

      <Panel flush title="Waiting for a result">
        <DataTable
          rows={pending}
          rowKey={(r) => r.id}
          empty={<EmptyState icon={FlaskConical} title="Nothing waiting" description="New orders appear here as doctors place them." />}
          columns={[
            {
              key: "ordered",
              header: "Ordered",
              cell: (r) => (
                <span className="whitespace-nowrap">
                  {formatTime(r.orderedAt, ctx.timezone)}
                  <span className="block text-xs text-zinc-500">{formatRelative(r.orderedAt, now)}</span>
                </span>
              ),
            },
            { key: "patient", header: "Patient", cell: (r) => <Patient item={r} /> },
            {
              key: "test",
              header: "Test",
              cell: (r) => (
                <div>
                  <p className="font-medium text-zinc-900 dark:text-zinc-100">{r.testName}</p>
                  {r.notes && <p className="text-xs text-zinc-500">{r.notes}</p>}
                </div>
              ),
            },
            { key: "by", header: "Doctor", hideOnMobile: true, cell: (r) => r.orderedByName },
            {
              key: "actions",
              header: "",
              align: "right",
              cell: (r) => <EnterResultDialog id={r.id} testName={r.testName} patientName={r.patientName} unit={r.unit} referenceRange={r.referenceRange} />,
            },
          ]}
        />
      </Panel>

      <Panel flush title="Resulted today">
        <DataTable
          rows={done}
          rowKey={(r) => r.id}
          empty={<EmptyState icon={CheckCircle2} title="No results yet today" />}
          columns={[
            { key: "time", header: "Resulted", cell: (r) => formatTime(r.resultedAt, ctx.timezone) },
            { key: "patient", header: "Patient", cell: (r) => <Patient item={r} /> },
            { key: "test", header: "Test", cell: (r) => r.testName },
            {
              key: "result",
              header: "Result",
              cell: (r) => (
                <span>
                  <span className="font-semibold text-zinc-900 dark:text-zinc-100">{r.resultValue}</span>
                  {r.unit ? ` ${r.unit}` : ""}
                </span>
              ),
            },
            {
              key: "flag",
              header: "",
              align: "right",
              cell: (r) => (
                <StatusBadge tone={r.resultFlag === "critical" ? "danger" : r.resultFlag === "abnormal" ? "warning" : "success"}>{r.resultFlag}</StatusBadge>
              ),
            },
          ]}
        />
      </Panel>
    </PageShell>
  );
}
