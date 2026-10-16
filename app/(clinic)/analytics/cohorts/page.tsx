import Link from "next/link";
import { UsersRound } from "lucide-react";
import { EmptyState, PageHeader, PageShell, Panel } from "@/components/app/page";
import { DataTable } from "@/components/app/data-table";
import { StatusBadge } from "@/components/app/status-badge";
import { AnalyticsTabs } from "@/components/analytics/cells";
import { can, requireClinic } from "@/lib/auth/clinic-session";
import { withClinic } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { addDaysToDateString, todayInTimeZone } from "@/lib/time";
import { listCohorts } from "@/features/analytics/analytics.service";
import { monthEnd, monthStart } from "@/features/analytics/analytics-rules";
import { CohortDialog } from "./CohortForms";

export const metadata = { title: "Cohorts" };

export default async function CohortsPage() {
  const ctx = await requireClinic({ permission: "analytics:read", module: "analytics" });
  const cohorts = await withClinic({ clinicId: ctx.clinicId, userId: ctx.userId }, (tx) => listCohorts(tx));
  const today = todayInTimeZone(ctx.timezone);

  return (
    <PageShell>
      <PageHeader
        icon={UsersRound}
        eyebrow={ctx.clinicName}
        title="Cohorts"
        description="Groups of patients defined by criteria, with a stated purpose and a date window. Members appear only as pseudonyms."
        actions={can(ctx, "analytics:manage") ? <CohortDialog defaults={{ from: monthStart(addDaysToDateString(today, -330)), to: monthEnd(today) }} /> : undefined}
      />
      <AnalyticsTabs active="cohorts" />

      <Panel flush>
        <DataTable
          rows={cohorts}
          rowKey={(c) => c.id}
          empty={<EmptyState icon={UsersRound} title="No cohorts yet" />}
          columns={[
            {
              key: "name",
              header: "Cohort",
              cell: (c) => (
                <Link href={`/analytics/cohorts/${c.id}`} className="group block">
                  <p className="font-medium text-zinc-900 group-hover:underline dark:text-zinc-100">{c.name}</p>
                  <p className="line-clamp-1 text-xs text-zinc-500">{c.purpose}</p>
                </Link>
              ),
            },
            { key: "version", header: "Version", align: "right", cell: (c) => `v${c.version}` },
            { key: "by", header: "Owner", hideOnMobile: true, cell: (c) => c.createdByName },
            { key: "run", header: "Last run", hideOnMobile: true, cell: (c) => (c.lastRunAt ? formatDateTime(c.lastRunAt, ctx.timezone) : "Never") },
            { key: "status", header: "", align: "right", cell: (c) => (c.status === "archived" ? <StatusBadge>Archived</StatusBadge> : <StatusBadge tone="success">Active</StatusBadge>) },
          ]}
        />
      </Panel>
    </PageShell>
  );
}
