import Link from "next/link";
import { AlertTriangle, UserCog, Users } from "lucide-react";
import { EmptyState, PageHeader, PageShell, Panel, StatCard } from "@/components/app/page";
import { DataTable } from "@/components/app/data-table";
import { StatusBadge } from "@/components/app/status-badge";
import { requireClinic } from "@/lib/auth/clinic-session";
import { withClinic } from "@/lib/db";
import { listStaff } from "@/features/staff/staff.service";
import { listRoles } from "@/features/staff/roles.service";
import { formatRelative } from "@/lib/format";
import { CreateStaffDialog } from "./StaffDialogs";

export const metadata = { title: "Staff" };

export default async function StaffPage() {
  const ctx = await requireClinic({ permission: "staff:manage" });
  const [staff, roles] = await withClinic({ clinicId: ctx.clinicId, userId: ctx.userId }, (tx) =>
    Promise.all([listStaff(tx), listRoles(tx)]),
  );

  const active = staff.filter((s) => s.status === "active").length;
  const doctorsWithoutReg = staff.filter(
    (s) => s.status === "active" && s.roles.some((r) => r.key === "doctor") && !s.registrationNumber,
  ).length;

  return (
    <PageShell>
      <PageHeader
        icon={UserCog}
        eyebrow="Administration"
        title="Staff"
        description="Everyone who signs in to this clinic, and the roles that decide what they can do."
        actions={
          <CreateStaffDialog
            clinicCode={ctx.clinicCode}
            roleOptions={roles.map((r) => ({ key: r.key, name: r.name, description: r.description }))}
          />
        }
      />

      <div className="grid gap-5 sm:grid-cols-3">
        <StatCard label="Active accounts" value={active} icon={Users} hint={`${staff.length - active} disabled`} />
        <StatCard
          label="Awaiting first sign-in"
          value={staff.filter((s) => s.mustChangePassword && s.status === "active").length}
          icon={UserCog}
        />
        <StatCard label="Doctors without registration no." value={doctorsWithoutReg} icon={AlertTriangle} hint="They cannot sign prescriptions" />
      </div>

      <Panel flush title="All staff">
        <DataTable
          rows={staff}
          rowKey={(s) => s.id}
          empty={<EmptyState icon={Users} title="No staff yet" />}
          columns={[
            {
              key: "name",
              header: "Name",
              cell: (s) => (
                <Link href={`/settings/users/${s.id}`} className="group block">
                  <span className="font-semibold text-zinc-900 group-hover:underline dark:text-zinc-100">
                    {[s.title, s.firstName, s.lastName].filter(Boolean).join(" ")}
                    {s.id === ctx.userId && <span className="ml-1 text-xs font-normal text-zinc-500">(you)</span>}
                  </span>
                  <span className="block text-xs text-zinc-500">{s.email}</span>
                </Link>
              ),
            },
            {
              key: "roles",
              header: "Roles",
              cell: (s) => (
                <div className="flex flex-wrap gap-1">
                  {s.roles.map((r) => (
                    <StatusBadge key={r.key} tone="accent">
                      {r.name}
                    </StatusBadge>
                  ))}
                  {s.roles.some((r) => r.key === "doctor") && !s.registrationNumber && (
                    <StatusBadge tone="warning">No reg. no.</StatusBadge>
                  )}
                </div>
              ),
            },
            {
              key: "status",
              header: "Status",
              cell: (s) =>
                s.status !== "active" ? (
                  <StatusBadge tone="neutral">Disabled</StatusBadge>
                ) : s.mustChangePassword ? (
                  <StatusBadge tone="info">Pending sign-in</StatusBadge>
                ) : (
                  <StatusBadge tone="success">Active</StatusBadge>
                ),
            },
            { key: "login", header: "Last sign-in", hideOnMobile: true, cell: (s) => formatRelative(s.lastLoginAt) },
          ]}
        />
      </Panel>
    </PageShell>
  );
}
