import Link from "next/link";
import { AlertTriangle, Building2, Gauge, PauseCircle, UserCog, Users } from "lucide-react";
import { EmptyState, PageHeader, PageShell, Panel, StatCard } from "@/components/app/page";
import { ButtonLink } from "@/components/app/buttons";
import { StatusBadge } from "@/components/app/status-badge";
import { requireOperator } from "@/lib/auth/platform-session";
import { withPlatform } from "@/lib/db";
import { getEstateSummary } from "@/features/platform/clinics.service";
import { formatRelative, humanizeAction } from "@/lib/format";

export const metadata = { title: "Estate · Operations console" };

export default async function EstatePage() {
  const operator = await requireOperator();
  const summary = await withPlatform((db) => getEstateSummary(db));

  return (
    <PageShell>
      <PageHeader
        icon={Gauge}
        eyebrow="Operations console"
        title="The estate"
        description="Clinics, their status and their usage. Counts and health only: this console never shows a patient record."
        actions={<ButtonLink href="/platform/tenants?onboard=1">Onboard a clinic</ButtonLink>}
      />

      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Clinics" value={summary.clinics.total} icon={Building2} hint={`${summary.clinics.active} active`} />
        <StatCard label="Suspended" value={summary.clinics.suspended} icon={PauseCircle} />
        <StatCard label="Active clinic staff" value={summary.activeStaff} icon={Users} />
        <StatCard label="Active operators" value={summary.activeOperators} icon={UserCog} />
      </div>

      {summary.clinics.withoutPlan > 0 && (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0" aria-hidden />
          <div>
            <p className="font-semibold">
              {summary.clinics.withoutPlan} clinic{summary.clinics.withoutPlan === 1 ? " has" : "s have"} no plan
            </p>
            <p className="mt-1">
              Every optional module is off for them, so pharmacy, lab, messaging, reports and analytics are unavailable.{" "}
              <Link href="/platform/tenants" className="font-semibold underline underline-offset-2">
                Review clinics
              </Link>
            </p>
          </div>
        </div>
      )}

      <Panel title="Recent console activity" description="Every operator action is recorded and cannot be edited.">
        {summary.recent.length === 0 ? (
          <EmptyState icon={Gauge} title="No activity yet" description="Actions taken in this console will appear here." />
        ) : (
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {summary.recent.map((event) => (
              <li key={event.id} className="flex items-center justify-between gap-4 py-3 text-sm">
                <div className="min-w-0">
                  <p className="font-medium text-zinc-900 dark:text-zinc-100">{humanizeAction(event.action)}</p>
                  <p className="text-xs text-zinc-500">
                    {event.operatorName ?? "Unknown operator"}
                    {event.targetType ? ` · ${event.targetType}` : ""}
                  </p>
                </div>
                <div className="flex flex-shrink-0 items-center gap-3">
                  {event.outcome !== "success" && <StatusBadge tone="danger">{event.outcome}</StatusBadge>}
                  <span className="text-xs text-zinc-500">{formatRelative(event.createdAt)}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <p className="text-center text-xs text-zinc-500">
        Signed in as {operator.email}. Console sessions end one hour after sign-in.
      </p>
    </PageShell>
  );
}
