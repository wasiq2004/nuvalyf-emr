import Link from "next/link";
import { Search, UserPlus, Users } from "lucide-react";
import { ButtonLink, buttonClass } from "@/components/app/buttons";
import { EmptyState, PageHeader, PageShell, Panel } from "@/components/app/page";
import { DataTable } from "@/components/app/data-table";
import { StatusBadge } from "@/components/app/status-badge";
import { inputClass } from "@/components/app/styles";
import { can, requireClinic } from "@/lib/auth/clinic-session";
import { recordAudit } from "@/lib/audit";
import { withClinic } from "@/lib/db";
import { getRequestMeta } from "@/lib/request";
import { formatDate } from "@/lib/format";
import { todayInTimeZone } from "@/lib/time";
import { cn } from "@/lib/utils";
import { searchPatients } from "@/features/patients/patients.service";

export const metadata = { title: "Patients" };

const SEX_SHORT: Record<string, string> = { male: "M", female: "F", other: "O", unknown: "?" };

export default async function PatientsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const ctx = await requireClinic({ permission: "patient:read" });
  const { q = "" } = await searchParams;
  const query = q.trim().slice(0, 100);
  const today = todayInTimeZone(ctx.timezone);
  const meta = await getRequestMeta();

  const results = await withClinic({ clinicId: ctx.clinicId, userId: ctx.userId }, async (tx) => {
    const rows = await searchPatients(tx, query, today);
    if (query) {
      await recordAudit(tx, {
        clinicId: ctx.clinicId,
        actorUserId: ctx.userId,
        action: "PATIENT_SEARCH",
        details: { query, results: rows.length },
        meta,
      });
    }
    return rows;
  });

  return (
    <PageShell>
      <PageHeader
        icon={Users}
        title="Patients"
        description="Search by name, mobile or record number. Families often share one mobile, so check the name and age too."
        actions={
          can(ctx, "patient:write") ? (
            <ButtonLink href="/patients/new">
              <UserPlus className="h-4 w-4" /> Register patient
            </ButtonLink>
          ) : undefined
        }
      />

      <form className="flex flex-col gap-3 sm:flex-row" role="search">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" aria-hidden />
          <input
            type="search"
            name="q"
            defaultValue={query}
            placeholder="Name, mobile or record number (e.g. P-000042)"
            aria-label="Search patients"
            autoFocus
            className={cn(inputClass, "h-12 pl-11 text-base")}
          />
        </div>
        <button type="submit" className={buttonClass("primary", "lg")}>
          Search
        </button>
      </form>

      <Panel flush title={query ? `${results.length} match${results.length === 1 ? "" : "es"} for "${query}"` : "Recently updated"}>
        <DataTable
          rows={results}
          rowKey={(p) => p.id}
          empty={
            <EmptyState
              icon={Search}
              title={query ? "No matching patients" : "No patients yet"}
              description={query ? "Check the spelling or try the mobile number." : "Registered patients will appear here."}
              action={
                can(ctx, "patient:write") ? (
                  <ButtonLink href="/patients/new" variant="secondary">
                    Register a new patient
                  </ButtonLink>
                ) : undefined
              }
            />
          }
          columns={[
            {
              key: "name",
              header: "Patient",
              cell: (p) => (
                <Link href={`/patients/${p.id}`} className="group block">
                  <span className="font-semibold text-zinc-900 group-hover:underline dark:text-zinc-100">{p.name}</span>
                  <span className="block font-mono text-xs text-zinc-500">{p.mrn}</span>
                </Link>
              ),
            },
            {
              key: "age",
              header: "Age / sex",
              cell: (p) => `${p.age ?? "—"} / ${SEX_SHORT[p.sex] ?? "?"}`,
            },
            { key: "mobile", header: "Mobile", cell: (p) => p.mobile ?? "—" },
            {
              key: "status",
              header: "",
              hideOnMobile: true,
              cell: (p) => (p.isPlaceholder ? <StatusBadge tone="danger">Record incomplete</StatusBadge> : null),
            },
            {
              key: "visit",
              header: "Last visit",
              hideOnMobile: true,
              cell: (p) => formatDate(p.lastVisitDate, "UTC"),
            },
          ]}
        />
      </Panel>
    </PageShell>
  );
}
