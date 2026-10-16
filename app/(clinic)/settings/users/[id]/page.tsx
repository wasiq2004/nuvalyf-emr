import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, UserCog } from "lucide-react";
import { z } from "zod";
import { DetailList, PageHeader, PageShell, Panel } from "@/components/app/page";
import { StatusBadge } from "@/components/app/status-badge";
import { requireClinic } from "@/lib/auth/clinic-session";
import { withClinic } from "@/lib/db";
import { getStaff } from "@/features/staff/staff.service";
import { listRoles } from "@/features/staff/roles.service";
import { formatDateTime, formatRelative } from "@/lib/format";
import { ReissuePasswordDialog } from "../StaffDialogs";
import { EditStaffForm, StaffStatusButton } from "./StaffControls";

export const metadata = { title: "Staff member" };

export default async function StaffDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireClinic({ permission: "staff:manage" });
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const [member, roles] = await withClinic({ clinicId: ctx.clinicId, userId: ctx.userId }, (tx) =>
    Promise.all([getStaff(tx, id), listRoles(tx)]),
  );
  if (!member) notFound();

  const isSelf = member.id === ctx.userId;
  const fullName = [member.title, member.firstName, member.lastName].filter(Boolean).join(" ");

  return (
    <PageShell width="default">
      <Link href="/settings/users" className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-white">
        <ArrowLeft className="h-4 w-4" /> All staff
      </Link>

      <PageHeader
        icon={UserCog}
        title={fullName}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge tone={member.status === "active" ? "success" : "neutral"}>{member.status}</StatusBadge>
            {member.roles.map((r) => (
              <StatusBadge key={r.key} tone="accent">
                {r.name}
              </StatusBadge>
            ))}
          </span>
        }
        actions={
          isSelf ? (
            <span className="text-sm text-zinc-500">This is your account.</span>
          ) : (
            <>
              <ReissuePasswordDialog id={member.id} email={member.email} />
              <StaffStatusButton id={member.id} name={fullName} status={member.status} />
            </>
          )
        }
      />

      <Panel title="Account">
        <DetailList
          items={[
            { label: "Sign-in email", value: member.email },
            { label: "Last sign-in", value: formatRelative(member.lastLoginAt) },
            { label: "Created", value: formatDateTime(member.createdAt, ctx.timezone) },
            { label: "Password", value: member.mustChangePassword ? "One-time password not yet changed" : "Set by the user" },
          ]}
        />
      </Panel>

      <Panel title="Profile and roles" description={isSelf ? "You cannot remove your own Clinic Admin role." : undefined}>
        <EditStaffForm
          values={{
            id: member.id,
            firstName: member.firstName,
            lastName: member.lastName,
            email: member.email,
            phone: member.phone ?? "",
            title: member.title ?? "",
            specialty: member.specialty ?? "",
            registrationNumber: member.registrationNumber ?? "",
            registrationCouncil: member.registrationCouncil ?? "",
            roles: member.roles.map((r) => r.key),
          }}
          roleOptions={roles.map((r) => ({ key: r.key, name: r.name, description: r.description }))}
        />
      </Panel>
    </PageShell>
  );
}
