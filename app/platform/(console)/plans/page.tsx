import { Layers } from "lucide-react";
import { EmptyState, PageHeader, PageShell, Panel } from "@/components/app/page";
import { StatusBadge } from "@/components/app/status-badge";
import { requireOperator } from "@/lib/auth/platform-session";
import { withPlatform } from "@/lib/db";
import { listPlans } from "@/features/platform/plans.service";
import { MODULES, OFFERED_MODULE_KEYS, isModuleKey } from "@/lib/access/modules";
import { CreatePlanDialog, EditPlanDialog } from "./PlanForms";

export const metadata = { title: "Plans · Operations console" };

export default async function PlansPage() {
  const operator = await requireOperator();
  const plans = await withPlatform((db) => listPlans(db));
  const canEdit = operator.role === "platform_admin";

  const moduleOptions = OFFERED_MODULE_KEYS.map((key) => ({
    key,
    name: MODULES[key].name,
    description: MODULES[key].description,
    requires: MODULES[key].requires.map((r) => MODULES[r].name),
  }));

  return (
    <PageShell>
      <PageHeader
        icon={Layers}
        title="Plans"
        description="Which optional modules each plan includes. A clinic with no plan has every optional module off."
        actions={canEdit ? <CreatePlanDialog modules={moduleOptions} /> : undefined}
      />

      {plans.length === 0 ? (
        <Panel>
          <EmptyState
            icon={Layers}
            title="No plans yet"
            description={canEdit ? "Create a plan before onboarding clinics." : "A Platform Admin needs to create plans."}
          />
        </Panel>
      ) : (
        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
          {plans.map((plan) => (
            <Panel
              key={plan.id}
              title={
                <span className="flex items-center gap-2">
                  {plan.name}
                  {!plan.isActive && <StatusBadge tone="neutral">Retired</StatusBadge>}
                </span>
              }
              description={`${plan.clinicCount} clinic${plan.clinicCount === 1 ? "" : "s"}`}
              actions={
                canEdit ? (
                  <EditPlanDialog
                    plan={{ id: plan.id, name: plan.name, description: plan.description, isActive: plan.isActive, modules: plan.modules }}
                    modules={moduleOptions}
                  />
                ) : undefined
              }
            >
              {plan.description && <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-400">{plan.description}</p>}
              <ul className="space-y-2 text-sm">
                <li className="flex items-center justify-between">
                  <span className="text-zinc-700 dark:text-zinc-300">Core clinic features</span>
                  <StatusBadge tone="success">Included</StatusBadge>
                </li>
                {OFFERED_MODULE_KEYS.map((key) => {
                  const included = plan.modules.filter(isModuleKey).includes(key);
                  return (
                    <li key={key} className="flex items-center justify-between">
                      <span className={included ? "text-zinc-700 dark:text-zinc-300" : "text-zinc-400"}>{MODULES[key].name}</span>
                      {included ? <StatusBadge tone="accent">On</StatusBadge> : <span className="text-xs text-zinc-400">Off</span>}
                    </li>
                  );
                })}
              </ul>
            </Panel>
          ))}
        </div>
      )}
    </PageShell>
  );
}
