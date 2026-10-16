import { UserCog } from "lucide-react";
import { PageHeader, PageShell, Panel } from "@/components/app/page";
import { DataTable } from "@/components/app/data-table";
import { StatusBadge } from "@/components/app/status-badge";
import { requireOperator } from "@/lib/auth/platform-session";
import { withPlatform } from "@/lib/db";
import { listOperators } from "@/features/platform/operators.service";
import { formatRelative } from "@/lib/format";
import { CreateOperatorDialog, EditOperatorDialog, ResetOperatorPasswordDialog } from "./OperatorForms";

export const metadata = { title: "Operators · Operations console" };

export default async function OperatorsPage() {
  const me = await requireOperator({ role: "platform_admin" });
  const operators = await withPlatform((db) => listOperators(db));

  return (
    <PageShell>
      <PageHeader
        icon={UserCog}
        title="Operators"
        description="People who can run the platform. Platform Admins can also manage operators and rescue locked-out clinic administrators."
        actions={<CreateOperatorDialog />}
      />

      <Panel flush>
        <DataTable
          rows={operators}
          rowKey={(o) => o.id}
          columns={[
            {
              key: "operator",
              header: "Operator",
              cell: (o) => (
                <div>
                  <p className="font-medium text-zinc-900 dark:text-zinc-100">
                    {o.name} {o.id === me.id && <span className="text-xs font-normal text-zinc-500">(you)</span>}
                  </p>
                  <p className="text-xs text-zinc-500">{o.email}</p>
                </div>
              ),
            },
            {
              key: "role",
              header: "Role",
              cell: (o) => (
                <StatusBadge tone={o.role === "platform_admin" ? "accent" : "neutral"}>
                  {o.role === "platform_admin" ? "Platform Admin" : "Operator"}
                </StatusBadge>
              ),
            },
            {
              key: "status",
              header: "Status",
              cell: (o) => <StatusBadge tone={o.status === "active" ? "success" : "neutral"}>{o.status}</StatusBadge>,
            },
            { key: "login", header: "Last sign-in", hideOnMobile: true, cell: (o) => formatRelative(o.lastLoginAt) },
            {
              key: "actions",
              header: "",
              align: "right",
              cell: (o) =>
                o.id === me.id ? null : (
                  <div className="flex justify-end gap-2">
                    <EditOperatorDialog id={o.id} name={o.name} role={o.role} status={o.status} />
                    <ResetOperatorPasswordDialog id={o.id} email={o.email} />
                  </div>
                ),
            },
          ]}
        />
      </Panel>
    </PageShell>
  );
}
