import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ArrowLeft, Download, UsersRound } from "lucide-react";
import { buttonClass } from "@/components/app/buttons";
import { DetailList, PageHeader, PageShell, Panel } from "@/components/app/page";
import { DataTable } from "@/components/app/data-table";
import { StatusBadge } from "@/components/app/status-badge";
import { Count } from "@/components/analytics/cells";
import { can, requireClinic } from "@/lib/auth/clinic-session";
import { withClinic } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { describeDefinition, suppressValue } from "@/features/analytics/analytics-rules";
import { getCohort, minCell } from "@/features/analytics/analytics.service";
import { ArchiveCohortButton, CohortDialog, CohortRunner } from "../CohortForms";

export const metadata = { title: "Cohort" };

export default async function CohortPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireClinic({ permission: "analytics:read", module: "analytics" });
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const data = await withClinic({ clinicId: ctx.clinicId, userId: ctx.userId }, async (tx) => {
    const cohort = await getCohort(tx, id);
    return cohort ? { cohort, threshold: await minCell(tx, ctx.clinicId) } : null;
  });
  if (!data) notFound();
  const { cohort, threshold } = data;
  const active = cohort.status === "active";
  const manage = can(ctx, "analytics:manage");

  return (
    <PageShell>
      <Link href="/analytics/cohorts" className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-white">
        <ArrowLeft className="h-4 w-4" /> Cohorts
      </Link>
      <PageHeader
        icon={UsersRound}
        eyebrow={`Version ${cohort.version}`}
        title={cohort.name}
        description={cohort.purpose}
        actions={
          <>
            {!active && <StatusBadge>Archived</StatusBadge>}
            {manage && active && (
              <CohortDialog values={{ id: cohort.id, name: cohort.name, purpose: cohort.purpose, definition: cohort.definition }} defaults={{ from: cohort.definition.from, to: cohort.definition.to }} />
            )}
            {manage && active && (
              <a href={`/analytics/cohorts/${cohort.id}/export`} className={buttonClass("secondary", "md")}>
                <Download className="h-4 w-4" /> Export CSV
              </a>
            )}
            {manage && active && <ArchiveCohortButton id={cohort.id} />}
          </>
        }
      />

      <Panel title="Definition">
        <DetailList
          items={[
            { label: "Criteria", value: <ul className="list-disc space-y-0.5 pl-4">{describeDefinition(cohort.definition).map((p) => <li key={p}>{p}</li>)}</ul> },
            { label: "Last changed", value: formatDateTime(cohort.updatedAt, ctx.timezone) },
          ]}
        />
      </Panel>

      {active && (
        <Panel title="Results" description={`Counts below ${threshold} are hidden. Each run is recorded.`}>
          <CohortRunner id={cohort.id} />
        </Panel>
      )}

      <Panel flush title="Run history">
        <DataTable
          rows={cohort.runs}
          rowKey={(r) => r.id}
          empty={<p className="p-6 text-sm text-zinc-500 lg:p-8">Not run yet.</p>}
          columns={[
            { key: "when", header: "When", cell: (r) => formatDateTime(r.ranAt, ctx.timezone) },
            { key: "version", header: "Version", cell: (r) => `v${r.version}` },
            { key: "size", header: "Patients", align: "right", cell: (r) => <Count value={suppressValue(r.size, threshold)} threshold={threshold} /> },
          ]}
        />
      </Panel>
    </PageShell>
  );
}
