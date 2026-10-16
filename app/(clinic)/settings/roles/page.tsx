import Link from "next/link";
import { Check, Lock, RotateCcw, ShieldCheck } from "lucide-react";
import { PageHeader, PageShell, Panel } from "@/components/app/page";
import { StatusBadge } from "@/components/app/status-badge";
import { ConfirmAction } from "@/components/app/dialogs";
import { requireClinic } from "@/lib/auth/clinic-session";
import { withClinic } from "@/lib/db";
import { listRoles } from "@/features/staff/roles.service";
import { resetRoleAction } from "@/features/staff/staff.actions";
import { PERMISSIONS, PERMISSION_KEYS } from "@/lib/access/permissions";
import { MODULES } from "@/lib/access/modules";
import { cn } from "@/lib/utils";
import { PermissionSwitch } from "./PermissionSwitch";

export const metadata = { title: "Roles & permissions" };

export default async function RolesPage({ searchParams }: { searchParams: Promise<{ role?: string }> }) {
  const ctx = await requireClinic({ permission: "staff:manage" });
  const roles = await withClinic({ clinicId: ctx.clinicId, userId: ctx.userId }, (tx) => listRoles(tx));
  const { role: selectedKey } = await searchParams;
  const selected = roles.find((r) => r.key === selectedKey) ?? roles.find((r) => r.key === "clinic_admin") ?? roles[0];

  const groups = new Map<string, typeof PERMISSION_KEYS>();
  for (const key of PERMISSION_KEYS) {
    const group = PERMISSIONS[key].group;
    groups.set(group, [...(groups.get(group) ?? []), key]);
  }

  return (
    <PageShell>
      <PageHeader
        icon={ShieldCheck}
        eyebrow="Administration"
        title="Roles & permissions"
        description="Each role holds only what its job needs. Switches change a grant immediately; locked rules are safety rules that cannot be moved."
      />

      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        <Panel flush title="Roles">
          <nav className="space-y-1 p-2" aria-label="Roles">
            {roles.map((role) => (
              <Link
                key={role.id}
                href={`/settings/roles?role=${role.key}`}
                aria-current={role.id === selected?.id ? "page" : undefined}
                className={cn(
                  "flex items-center justify-between rounded-xl px-4 py-3 text-sm transition-colors",
                  role.id === selected?.id
                    ? "bg-(--accent-soft) font-semibold text-(--accent-text) ring-1 ring-(--accent-soft-border)"
                    : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800",
                )}
              >
                <span>{role.name}</span>
                <span className="text-xs text-zinc-500">{role.memberCount}</span>
              </Link>
            ))}
          </nav>
        </Panel>

        {selected && (
          <Panel
            title={selected.name}
            description={selected.description ?? undefined}
            actions={
              <ConfirmAction
                action={resetRoleAction}
                input={{ roleId: selected.id }}
                trigger={
                  <>
                    <RotateCcw className="h-3.5 w-3.5" /> Reset to defaults
                  </>
                }
                title={`Reset ${selected.name}?`}
                description="Restores the permissions NuvaLyf ships for this role. Staff holding it are affected on their next request."
                confirmLabel="Reset role"
                successMessage="Role reset to defaults"
              />
            }
          >
            <div className="space-y-8">
              {[...groups.entries()].map(([group, keys]) => (
                <div key={group}>
                  <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">{group}</p>
                  <ul className="mt-3 divide-y divide-zinc-100 rounded-2xl border border-zinc-100 dark:divide-zinc-800 dark:border-zinc-800">
                    {keys.map((key) => {
                      const def = PERMISSIONS[key];
                      const granted = selected.permissions.includes(key);
                      const requiredModule = "module" in def ? def.module : undefined;
                      const moduleOff = requiredModule && !ctx.modules.has(requiredModule);
                      return (
                        <li key={key} className="flex items-center justify-between gap-4 px-4 py-3">
                          <div className="min-w-0">
                            <p className={cn("text-sm", granted ? "text-zinc-900 dark:text-zinc-100" : "text-zinc-500")}>{def.label}</p>
                            <div className="mt-1 flex flex-wrap gap-1.5">
                              {!def.adjustable && (
                                <span className="inline-flex items-center gap-1 text-[11px] text-zinc-500">
                                  <Lock className="h-3 w-3" aria-hidden /> Safety rule
                                </span>
                              )}
                              {moduleOff && <StatusBadge tone="warning">Needs {MODULES[requiredModule].name} module</StatusBadge>}
                            </div>
                          </div>
                          {def.adjustable ? (
                            <PermissionSwitch roleId={selected.id} permission={key} granted={granted} label={def.label} />
                          ) : granted ? (
                            <Check className="h-5 w-5 text-(--accent-text)" aria-label="Granted" />
                          ) : (
                            <span className="text-xs text-zinc-400">Not granted</span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          </Panel>
        )}
      </div>
    </PageShell>
  );
}
