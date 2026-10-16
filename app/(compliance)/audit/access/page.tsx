import { Eye, UserSearch } from "lucide-react";
import { buttonClass } from "@/components/app/buttons";
import { inputClass } from "@/components/app/styles";
import { EmptyState, PageHeader, PageShell, Panel, StatCard } from "@/components/app/page";
import { DataTable } from "@/components/app/data-table";
import { requireClinic } from "@/lib/auth/clinic-session";
import { recordAudit } from "@/lib/audit";
import { withClinic } from "@/lib/db";
import { getRequestMeta } from "@/lib/request";
import { formatDateTime, humanizeAction } from "@/lib/format";
import { addDaysToDateString, todayInTimeZone, zonedTimeToUtc } from "@/lib/time";
import { parseFilters } from "@/features/audit/audit-rules";
import { recordAccess } from "@/features/audit/audit.service";
import { cn } from "@/lib/utils";

export const metadata = { title: "Record access" };

export default async function RecordAccessPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requireClinic({ permission: "audit:read" });
  const params = await searchParams;
  const today = todayInTimeZone(ctx.timezone);
  const filters = parseFilters(params, today, addDaysToDateString);
  const range = { from: zonedTimeToUtc(filters.from, "00:00", ctx.timezone), to: zonedTimeToUtc(addDaysToDateString(filters.to, 1), "00:00", ctx.timezone) };
  const meta = await getRequestMeta();

  const access = filters.patientMrn
    ? await withClinic({ clinicId: ctx.clinicId, userId: ctx.userId }, async (tx) => {
        const result = await recordAccess(tx, filters.patientMrn!, range);
        await recordAudit(tx, {
          clinicId: ctx.clinicId,
          actorUserId: ctx.userId,
          action: "AUDIT_RECORD_ACCESS_VIEWED",
          targetType: "audit",
          patientId: result?.patient.id ?? null,
          details: { mrn: filters.patientMrn, from: filters.from, to: filters.to, found: Boolean(result) },
          meta,
        });
        return result;
      })
    : undefined;

  return (
    <PageShell>
      <PageHeader
        icon={UserSearch}
        eyebrow={ctx.clinicName}
        title="Who opened this record?"
        description="Every time a patient's record, consultation, prescription or invoice was opened or printed, and by whom."
      />

      <Panel>
        <form role="search" aria-label="Find a patient's record access" className="grid gap-4 sm:grid-cols-[1fr_10rem_10rem_auto] sm:items-end">
          <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Patient record no.
            <input name="mrn" required defaultValue={filters.patientMrn ?? ""} placeholder="e.g. P-000123" className={cn(inputClass, "mt-1.5 h-11 font-mono normal-case tracking-normal")} />
          </label>
          <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-500">
            From
            <input type="date" name="from" defaultValue={filters.from} className={cn(inputClass, "mt-1.5 h-11 normal-case tracking-normal")} />
          </label>
          <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-500">
            To
            <input type="date" name="to" defaultValue={filters.to} className={cn(inputClass, "mt-1.5 h-11 normal-case tracking-normal")} />
          </label>
          <button type="submit" className={buttonClass("primary", "md", "h-11")}>
            Look up
          </button>
        </form>
      </Panel>

      {access === null && (
        <EmptyState icon={UserSearch} title={`No patient with record number ${filters.patientMrn}`} description="Check the record number and try again." />
      )}

      {access && (
        <>
          <div className="grid gap-5 sm:grid-cols-3">
            <StatCard label="Patient" value={<span className="font-mono text-2xl">{access.patient.mrn}</span>} icon={UserSearch} hint={access.patient.name} />
            <StatCard label="Times opened" value={access.events.length} icon={Eye} hint={`${filters.from} to ${filters.to}`} />
            <StatCard label="People" value={access.people.length} icon={UserSearch} />
          </div>

          <Panel flush title="By person">
            <DataTable
              rows={access.people}
              rowKey={(p) => p.actorId ?? "unknown"}
              empty={<EmptyState icon={Eye} title="Nobody opened this record in the period" />}
              columns={[
                {
                  key: "who",
                  header: "Person",
                  cell: (p) => (
                    <div>
                      <p className="font-medium text-zinc-900 dark:text-zinc-100">{p.name}</p>
                      <p className="text-xs text-zinc-500">{p.roles || "—"}</p>
                    </div>
                  ),
                },
                { key: "views", header: "Times", align: "right", cell: (p) => <span className="font-semibold tabular-nums">{p.views}</span> },
                { key: "what", header: "Opened", hideOnMobile: true, cell: (p) => p.actions.map(humanizeAction).join(", ") },
                { key: "first", header: "First", hideOnMobile: true, cell: (p) => formatDateTime(p.first, ctx.timezone) },
                { key: "last", header: "Last", cell: (p) => formatDateTime(p.last, ctx.timezone) },
              ]}
            />
          </Panel>

          <Panel flush title="Every access" description="Newest first.">
            <DataTable
              rows={access.events}
              rowKey={(e) => e.id}
              empty={<EmptyState icon={Eye} title="No access in this period" />}
              columns={[
                { key: "when", header: "When", cell: (e) => formatDateTime(e.createdAt, ctx.timezone) },
                { key: "who", header: "Who", cell: (e) => e.actorName ?? "—" },
                { key: "what", header: "What", cell: (e) => humanizeAction(e.action) },
                { key: "ip", header: "From", hideOnMobile: true, cell: (e) => <span className="font-mono text-xs">{e.ipAddress ?? "—"}</span> },
              ]}
            />
          </Panel>
        </>
      )}
    </PageShell>
  );
}
