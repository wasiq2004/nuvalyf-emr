import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, ArrowLeft, Building2 } from "lucide-react";
import { z } from "zod";
import { DetailList, PageHeader, PageShell, Panel } from "@/components/app/page";
import { DataTable } from "@/components/app/data-table";
import { StatusBadge } from "@/components/app/status-badge";
import { requireOperator } from "@/lib/auth/platform-session";
import { isProvisionerConfigured, withPlatform, withProvisioner } from "@/lib/db";
import { getClinic } from "@/features/platform/clinics.service";
import { listPlans } from "@/features/platform/plans.service";
import { listClinicAdmins } from "@/features/platform/onboarding.service";
import { MODULES, isModuleKey } from "@/lib/access/modules";
import { formatDate, formatDateTime, formatRelative, PLATFORM_TIMEZONE } from "@/lib/format";
import { ClinicContactForm, ClinicPlanForm, ClinicStatusControl, RescueAdminButton } from "./ClinicControls";

export const metadata = { title: "Clinic · Operations console" };

export default async function ClinicDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const operator = await requireOperator();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const [clinic, plans] = await withPlatform((db) => Promise.all([getClinic(db, id), listPlans(db)]));
  if (!clinic) notFound();

  const provisioner = isProvisionerConfigured();
  const isPlatformAdmin = operator.role === "platform_admin";
  // The provisioner role can read staff accounts in every clinic: only used
  // for the people allowed to rescue an administrator.
  const admins = provisioner && isPlatformAdmin ? await withProvisioner((tx) => listClinicAdmins(tx, clinic.id)) : [];

  return (
    <PageShell width="default">
      <Link href="/platform/tenants" className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-white">
        <ArrowLeft className="h-4 w-4" /> All clinics
      </Link>

      <PageHeader
        icon={Building2}
        eyebrow={<span className="font-mono normal-case tracking-normal">{clinic.code}</span>}
        title={clinic.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge tone={clinic.status === "active" ? "success" : "danger"}>{clinic.status}</StatusBadge>
            <span>Onboarded {formatDate(clinic.createdAt, PLATFORM_TIMEZONE)}</span>
          </span>
        }
        actions={<ClinicStatusControl clinicId={clinic.id} clinicName={clinic.name} status={clinic.status} />}
      />

      {clinic.status === "suspended" && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-400">
          <p className="font-semibold">Suspended {formatDateTime(clinic.suspendedAt, PLATFORM_TIMEZONE)}</p>
          {clinic.suspendedReason && <p className="mt-1">{clinic.suspendedReason}</p>}
        </div>
      )}

      {!clinic.planId && (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0" aria-hidden />
          No plan assigned: every optional module is off for this clinic.
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Usage" description="Counts only.">
          <DetailList
            items={[
              { label: "Active staff", value: clinic.staffActive },
              { label: "All staff accounts", value: clinic.staffTotal },
              { label: "Last staff sign-in", value: formatRelative(clinic.lastActivityAt) },
              { label: "Status", value: clinic.status },
            ]}
          />
        </Panel>

        <Panel title="Plan & modules">
          <div className="mb-5 flex flex-wrap gap-1.5">
            {clinic.modules.length === 0 ? (
              <span className="text-sm text-zinc-500">Core features only</span>
            ) : (
              clinic.modules.filter(isModuleKey).map((m) => (
                <StatusBadge key={m} tone="accent">
                  {MODULES[m].name}
                </StatusBadge>
              ))
            )}
          </div>
          <ClinicPlanForm
            clinicId={clinic.id}
            planId={clinic.planId}
            plans={plans.filter((p) => p.isActive || p.id === clinic.planId).map((p) => ({ id: p.id, name: p.name }))}
          />
        </Panel>
      </div>

      <Panel flush title="Clinic administrators" description="The rescue path re-issues a one-time password to a locked-out administrator.">
        {!provisioner ? (
          <p className="px-6 py-4 text-sm text-zinc-500 lg:px-8">
            Administrator details and rescue are unavailable: <code>PROVISIONER_DATABASE_URL</code> is not configured.
          </p>
        ) : !isPlatformAdmin ? (
          <p className="px-6 py-4 text-sm text-zinc-500 lg:px-8">Administrator accounts and rescue are visible to Platform Admins only.</p>
        ) : (
          <DataTable
            rows={admins}
            rowKey={(a) => a.id}
            columns={[
              {
                key: "admin",
                header: "Administrator",
                cell: (a) => (
                  <div>
                    <p className="font-medium text-zinc-900 dark:text-zinc-100">{a.name}</p>
                    <p className="text-xs text-zinc-500">{a.email}</p>
                  </div>
                ),
              },
              {
                key: "status",
                header: "Status",
                cell: (a) => <StatusBadge tone={a.status === "active" ? "success" : "neutral"}>{a.status}</StatusBadge>,
              },
              { key: "login", header: "Last sign-in", hideOnMobile: true, cell: (a) => formatRelative(a.lastLoginAt) },
              {
                key: "actions",
                header: "",
                align: "right",
                cell: (a) =>
                  isPlatformAdmin ? (
                    <RescueAdminButton clinicId={clinic.id} userId={a.id} email={a.email} />
                  ) : (
                    <span className="text-xs text-zinc-400">Platform Admin only</span>
                  ),
              },
            ]}
          />
        )}
      </Panel>

      <Panel title="Clinic details">
        <ClinicContactForm
          clinicId={clinic.id}
          name={clinic.name}
          contactName={clinic.contactName}
          contactEmail={clinic.contactEmail}
          contactPhone={clinic.contactPhone}
        />
      </Panel>
    </PageShell>
  );
}
