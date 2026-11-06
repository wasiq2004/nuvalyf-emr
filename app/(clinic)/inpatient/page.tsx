import Link from "next/link";
import { BedDouble, LogIn, Plus, Search, Users } from "lucide-react";
import { ButtonLink } from "@/components/app/buttons";
import { EmptyState, PageHeader, PageShell, Panel, StatCard } from "@/components/app/page";
import { DataTable } from "@/components/app/data-table";
import { StatusBadge } from "@/components/app/status-badge";
import { TabNav } from "@/components/app/tabs";
import { AutoRefresh } from "@/components/app/auto-refresh";
import { inputClass } from "@/components/app/styles";
import { can, requireClinic } from "@/lib/auth/clinic-session";
import { withClinic } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { todayInTimeZone } from "@/lib/time";
import { cn } from "@/lib/utils";
import { getClinicSettings } from "@/features/settings/settings.service";
import { searchPatients } from "@/features/patients/patients.service";
import { bedBoard, listAdmissions } from "@/features/inpatient/inpatient.service";

export const metadata = { title: "Inpatients" };

export default async function InpatientPage({ searchParams }: { searchParams: Promise<{ show?: string; q?: string }> }) {
  const ctx = await requireClinic({ permission: "inpatient:read", module: "inpatient" });
  const { show, q = "" } = await searchParams;
  const tab = show === "discharged" ? "discharged" : "admitted";
  const search = q.trim().slice(0, 100);
  const today = todayInTimeZone(ctx.timezone);
  const canAdmit = can(ctx, "inpatient:admit");
  const data = await withClinic({ clinicId: ctx.clinicId, userId: ctx.userId }, async (tx) => ({
    list: await listAdmissions(tx, tab, today),
    beds: await bedBoard(tx, today),
    found: search.length >= 2 && canAdmit && can(ctx, "patient:read") ? await searchPatients(tx, search, today, 8) : [],
    currency: (await getClinicSettings(tx, ctx.clinicId)).currency,
  }));
  const inUse = data.beds.filter((b) => b.isActive);
  const occupied = inUse.filter((b) => b.admissionId);
  const wards = [...new Set(inUse.map((b) => b.ward ?? "Beds"))];

  return (
    <PageShell width="wide">
      <AutoRefresh seconds={60} />
      <PageHeader icon={BedDouble} eyebrow={ctx.clinicName} title="Inpatients" description="Who is admitted, in which bed, and which beds are free." />

      <div className="grid gap-5 sm:grid-cols-3">
        <StatCard label="Admitted now" value={occupied.length} icon={Users} />
        <StatCard label="Free beds" value={inUse.length - occupied.length} icon={BedDouble} hint={`${inUse.length} beds in use`} />
        <StatCard label="Occupancy" value={inUse.length ? `${Math.round((occupied.length * 100) / inUse.length)} %` : "—"} icon={LogIn} />
      </div>

      {canAdmit && (
        <Panel title="Admit a patient" description="Find the patient, or open their record and choose Admit.">
          <form action="/inpatient" className="relative">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" aria-hidden />
            <input type="search" name="q" defaultValue={search} aria-label="Find a patient to admit" placeholder="Patient name, phone or record number" autoComplete="off" className={cn(inputClass, "h-11 pl-10")} />
          </form>
          {search && (
            <ul className="mt-3 divide-y divide-zinc-100 dark:divide-zinc-800">
              {data.found.length === 0 && <li className="py-2 text-sm text-zinc-500">No patient found. Register them first.</li>}
              {data.found.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                  <span className="text-sm">
                    <span className="font-medium text-zinc-900 dark:text-zinc-100">{p.name}</span>
                    <span className="text-zinc-500"> · {p.mrn}</span>
                  </span>
                  <ButtonLink href={`/inpatient/admit?patientId=${p.id}`} variant="secondary" size="sm">
                    <Plus className="h-4 w-4" /> Admit
                  </ButtonLink>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}

      <Panel title="Beds" description={inUse.length === 0 ? undefined : "Open an occupied bed to see the patient's stay and bill."}>
        {inUse.length === 0 ? (
          <EmptyState icon={BedDouble} title="No beds set up" description={can(ctx, "settings:manage") ? "Add categories and beds under Beds & inpatient." : "A Clinic Admin sets up beds."} />
        ) : (
          <div className="space-y-5">
            {wards.map((ward) => (
              <div key={ward}>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">{ward}</p>
                <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                  {inUse
                    .filter((b) => (b.ward ?? "Beds") === ward)
                    .map((b) => {
                      const body = (
                        <>
                          <span className="flex items-center justify-between gap-2">
                            <span className="font-mono text-sm font-semibold text-zinc-900 dark:text-zinc-100">{b.code}</span>
                            <span className="text-xs text-zinc-500">{b.categoryName}</span>
                          </span>
                          <span className="mt-1 block truncate text-sm text-zinc-700 dark:text-zinc-300">{b.patientName ?? `Free · ${formatMoney(b.dailyRate, data.currency)} a day`}</span>
                        </>
                      );
                      const style = cn("block rounded-xl border p-3", b.admissionId ? "border-(--accent-soft-border) bg-(--accent-soft)/50 hover:bg-(--accent-soft)" : "border-zinc-200 dark:border-zinc-800");
                      return <li key={b.id}>{b.admissionId ? <Link href={`/inpatient/${b.admissionId}`} className={style}>{body}</Link> : <div className={style}>{body}</div>}</li>;
                    })}
                </ul>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <TabNav
        label="Admissions"
        active={tab}
        tabs={[
          { key: "admitted", label: "Admitted", href: "/inpatient" },
          { key: "discharged", label: "Discharged", href: "/inpatient?show=discharged" },
        ]}
      />
      <Panel flush>
        <DataTable
          rows={data.list}
          rowKey={(a) => a.id}
          empty={<EmptyState icon={Users} title={tab === "admitted" ? "Nobody admitted" : "No discharges yet"} />}
          columns={[
            {
              key: "patient",
              header: "Patient",
              cell: (a) => (
                <Link href={`/inpatient/${a.id}`} className="group block">
                  <p className="font-medium text-zinc-900 group-hover:underline dark:text-zinc-100">{a.patientName}</p>
                  <p className="font-mono text-xs text-zinc-500">
                    {a.number} · {a.patientMrn}
                  </p>
                </Link>
              ),
            },
            { key: "bed", header: "Bed", cell: (a) => (a.bed ? <StatusBadge tone="accent">{a.bed}</StatusBadge> : "—") },
            { key: "doctor", header: "Consultant", hideOnMobile: true, cell: (a) => a.doctorName },
            { key: "in", header: "Admitted", hideOnMobile: true, cell: (a) => formatDateTime(a.admittedAt, ctx.timezone) },
            ...(tab === "discharged" ? [{ key: "out", header: "Discharged", cell: (a: (typeof data.list)[number]) => formatDateTime(a.dischargedAt, ctx.timezone) }] : []),
          ]}
        />
      </Panel>
    </PageShell>
  );
}
