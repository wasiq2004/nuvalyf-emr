import Link from "next/link";
import { Building2 } from "lucide-react";
import { EmptyState, PageHeader, PageShell, Panel } from "@/components/app/page";
import { DataTable } from "@/components/app/data-table";
import { StatusBadge } from "@/components/app/status-badge";
import { requireOperator } from "@/lib/auth/platform-session";
import { isProvisionerConfigured, withPlatform } from "@/lib/db";
import { listClinics } from "@/features/platform/clinics.service";
import { listPlans } from "@/features/platform/plans.service";
import { formatDate, formatRelative, PLATFORM_TIMEZONE } from "@/lib/format";
import { timezoneOptions } from "@/lib/timezones";
import OnboardClinicDialog from "./OnboardClinicDialog";

export const metadata = { title: "Clinics · Operations console" };

export default async function TenantsPage({ searchParams }: { searchParams: Promise<{ onboard?: string }> }) {
  await requireOperator();
  const { onboard } = await searchParams;
  const [clinics, plans] = await withPlatform((db) => Promise.all([listClinics(db), listPlans(db)]));
  const timezones = timezoneOptions();

  return (
    <PageShell>
      <PageHeader
        icon={Building2}
        title="Clinics"
        description="Every clinic on the platform, its plan and its activity."
        actions={
          <OnboardClinicDialog
            plans={plans.filter((p) => p.isActive).map((p) => ({ id: p.id, name: p.name }))}
            timezones={timezones}
            defaultOpen={onboard === "1"}
            enabled={isProvisionerConfigured()}
          />
        }
      />

      {!isProvisionerConfigured() && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
          Onboarding and admin rescue are switched off because <code>PROVISIONER_DATABASE_URL</code> is not configured.
        </div>
      )}

      <Panel flush title={`${clinics.length} clinic${clinics.length === 1 ? "" : "s"}`}>
        <DataTable
          rows={clinics}
          rowKey={(c) => c.id}
          empty={
            <EmptyState
              icon={Building2}
              title="No clinics yet"
              description="Onboard the first clinic to create its administrator account."
            />
          }
          columns={[
            {
              key: "name",
              header: "Clinic",
              cell: (c) => (
                <Link href={`/platform/tenants/${c.id}`} className="group block">
                  <span className="font-semibold text-zinc-900 group-hover:underline dark:text-zinc-100">{c.name}</span>
                  <span className="block font-mono text-xs text-zinc-500">{c.code}</span>
                </Link>
              ),
            },
            {
              key: "status",
              header: "Status",
              cell: (c) => (
                <StatusBadge tone={c.status === "active" ? "success" : "danger"}>{c.status}</StatusBadge>
              ),
            },
            {
              key: "plan",
              header: "Plan",
              cell: (c) => c.planName ?? <StatusBadge tone="warning">No plan</StatusBadge>,
            },
            {
              key: "staff",
              header: "Staff",
              hideOnMobile: true,
              cell: (c) => `${c.staffActive} active / ${c.staffTotal}`,
            },
            {
              key: "activity",
              header: "Last activity",
              hideOnMobile: true,
              cell: (c) => formatRelative(c.lastActivityAt),
            },
            {
              key: "created",
              header: "Onboarded",
              hideOnMobile: true,
              cell: (c) => formatDate(c.createdAt, PLATFORM_TIMEZONE),
            },
          ]}
        />
      </Panel>
    </PageShell>
  );
}
