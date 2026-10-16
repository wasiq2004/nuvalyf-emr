import Link from "next/link";
import { Download, ScrollText } from "lucide-react";
import { buttonClass } from "@/components/app/buttons";
import { EmptyState, PageHeader, PageShell, Panel } from "@/components/app/page";
import { DataTable } from "@/components/app/data-table";
import { requireClinic } from "@/lib/auth/clinic-session";
import { recordAudit } from "@/lib/audit";
import { withClinic } from "@/lib/db";
import { getRequestMeta } from "@/lib/request";
import { formatDateTime } from "@/lib/format";
import { addDaysToDateString, todayInTimeZone, zonedTimeToUtc } from "@/lib/time";
import { parseFilters, toSearchParams } from "@/features/audit/audit-rules";
import { listActions, listStaffForFilter, searchAudit } from "@/features/audit/audit.service";
import { ActionCell, AuditFilterForm, DetailsCell, OutcomeBadge } from "./AuditViews";

export const metadata = { title: "Audit trail" };

export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requireClinic({ permission: "audit:read" });
  const params = await searchParams;
  const today = todayInTimeZone(ctx.timezone);
  const filters = parseFilters(params, today, addDaysToDateString);
  const range = { from: zonedTimeToUtc(filters.from, "00:00", ctx.timezone), to: zonedTimeToUtc(addDaysToDateString(filters.to, 1), "00:00", ctx.timezone) };
  const cursor = params.cursor && params.cursor.length < 100 ? params.cursor : null;
  const meta = await getRequestMeta();

  const data = await withClinic({ clinicId: ctx.clinicId, userId: ctx.userId }, async (tx) => {
    const page = await searchAudit(tx, filters, range, cursor);
    // Reading the audit trail is itself audited.
    await recordAudit(tx, {
      clinicId: ctx.clinicId,
      actorUserId: ctx.userId,
      action: "AUDIT_VIEWED",
      targetType: "audit",
      details: { ...filters, page: cursor ? "next" : "first", results: page.rows.length },
      meta,
    });
    return { page, staff: await listStaffForFilter(tx), actions: await listActions(tx) };
  });
  const query = toSearchParams(filters);

  return (
    <PageShell>
      <PageHeader
        icon={ScrollText}
        eyebrow={ctx.clinicName}
        title="Audit trail"
        description="Every sign-in, record opened, change made and access refused. Append-only: nobody, including administrators, can edit or delete it."
        actions={
          <a href={`/audit/export?${query}`} className={buttonClass("secondary", "md")}>
            <Download className="h-4 w-4" /> Export CSV
          </a>
        }
      />

      <Panel>
        <AuditFilterForm filters={filters} staff={data.staff} actions={data.actions} resetHref="/audit" />
      </Panel>

      <Panel flush title={`Events ${filters.from === filters.to ? `on ${filters.from}` : `${filters.from} to ${filters.to}`}`} description="Newest first. Clinical details are never shown here.">
        <DataTable
          rows={data.page.rows}
          rowKey={(r) => r.id}
          empty={
            <EmptyState
              icon={ScrollText}
              title={data.page.patientNotFound ? `No patient with record number ${filters.patientMrn}` : "No events match"}
              description={data.page.patientNotFound ? "Check the record number." : "Try a wider date range or fewer filters."}
            />
          }
          columns={[
            { key: "when", header: "When", cell: (r) => <span className="whitespace-nowrap text-sm">{formatDateTime(r.createdAt, ctx.timezone)}</span> },
            { key: "who", header: "Who", cell: (r) => r.actorName ?? <span className="text-zinc-400">Not signed in</span> },
            { key: "what", header: "What", cell: (r) => <ActionCell action={r.action} category={r.category} /> },
            {
              key: "patient",
              header: "Patient",
              hideOnMobile: true,
              cell: (r) =>
                r.patientMrn ? (
                  <Link href={`/audit/access?mrn=${encodeURIComponent(r.patientMrn)}`} className="text-sm hover:underline">
                    <span className="font-mono">{r.patientMrn}</span>
                    <span className="block text-xs text-zinc-500">{r.patientName}</span>
                  </Link>
                ) : (
                  <span className="text-zinc-400">—</span>
                ),
            },
            { key: "outcome", header: "Outcome", cell: (r) => <OutcomeBadge outcome={r.outcome} severity={r.severity} /> },
            { key: "details", header: "", hideOnMobile: true, cell: (r) => <DetailsCell details={r.details} /> },
          ]}
        />
        {data.page.nextCursor && (
          <div className="border-t border-zinc-100 px-6 py-4 text-right lg:px-8 dark:border-zinc-800">
            <Link href={`/audit?${query}&cursor=${encodeURIComponent(data.page.nextCursor)}`} className={buttonClass("secondary", "sm")}>
              Older events
            </Link>
          </div>
        )}
      </Panel>
    </PageShell>
  );
}
