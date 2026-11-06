import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ArrowLeft, FlaskConical } from "lucide-react";
import { EmptyState, PageHeader, PageShell, Panel } from "@/components/app/page";
import { StatusBadge } from "@/components/app/status-badge";
import { requireClinic } from "@/lib/auth/clinic-session";
import { withClinic } from "@/lib/db";
import { getLabTestWithParameters } from "@/features/catalog/catalog.service";
import { DeleteRangeButton, ParameterDialog, ParameterToggle, RangeDialog } from "./ParameterForms";

export const metadata = { title: "Lab test" };

const SEX: Record<string, string> = { any: "Everyone", male: "Male", female: "Female" };
const age = (min: number, max: number | null) => (min === 0 && max === null ? "All ages" : max === null ? `${min}+ years` : `${min}-${max} years`);
const limits = (low: string | null, high: string | null) => [low === null ? null : Number(low), high === null ? null : Number(high)];

export default async function LabTestPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireClinic({ permission: "catalog:manage", module: "lab" });
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const test = await withClinic({ clinicId: ctx.clinicId, userId: ctx.userId }, (tx) => getLabTestWithParameters(tx, id));
  if (!test) notFound();

  return (
    <PageShell>
      <Link href="/settings/catalog?tab=lab" className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-white">
        <ArrowLeft className="h-4 w-4" /> Lab tests
      </Link>
      <PageHeader
        icon={FlaskConical}
        eyebrow={test.sampleType ?? "Lab test"}
        title={test.name}
        description="What this test reports. Ranges are this clinic's own, by sex and age. A change here applies to new results; saved reports keep the range they were reported with."
        actions={<ParameterDialog testId={test.id} nextOrder={test.parameters.length} />}
      />
      {test.parameters.length === 0 ? (
        <EmptyState icon={FlaskConical} title="No parameters yet" description="Without parameters this test takes one free-text result. Add what it reports to get a full, checked report." />
      ) : (
        <ul className="space-y-4">
          {test.parameters.map((p) => (
            <li key={p.id}>
              <Panel
                title={
                  <span className="flex flex-wrap items-center gap-2">
                    {p.name} {p.unit && <span className="text-sm font-normal text-zinc-500">{p.unit}</span>}
                    {p.section && <StatusBadge>{p.section}</StatusBadge>}
                    {!p.isActive && <StatusBadge tone="warning">Inactive</StatusBadge>}
                  </span>
                }
                description={p.valueType === "text" ? (p.normalText ? `Expected finding: ${p.normalText}` : "A written result; no expected finding") : undefined}
                actions={
                  <div className="flex flex-wrap gap-1">
                    <ParameterDialog
                      testId={test.id}
                      nextOrder={p.sortOrder}
                      values={{ id: p.id, name: p.name, section: p.section ?? "", unit: p.unit ?? "", valueType: p.valueType, normalText: p.normalText ?? "", sortOrder: p.sortOrder }}
                    />
                    <ParameterToggle id={p.id} name={p.name} isActive={p.isActive} />
                    {p.valueType === "number" && <RangeDialog parameterId={p.id} name={p.name} />}
                  </div>
                }
              >
                {p.valueType === "number" &&
                  (p.ranges.length === 0 ? (
                    <p className="text-sm text-zinc-500">No range: results will not be flagged.</p>
                  ) : (
                    <ul className="divide-y divide-zinc-100 text-sm dark:divide-zinc-800">
                      {p.ranges.map((r) => {
                        const [low, high] = limits(r.low, r.high);
                        const [cLow, cHigh] = limits(r.criticalLow, r.criticalHigh);
                        return (
                          <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
                            <span className="text-zinc-700 dark:text-zinc-300">
                              {SEX[r.sex]}, {age(r.ageMinYears, r.ageMaxYears)}
                            </span>
                            <span className="flex items-center gap-3">
                              <span className="font-medium tabular-nums text-zinc-900 dark:text-zinc-100">
                                {low ?? "—"} to {high ?? "—"}
                              </span>
                              {(cLow !== null || cHigh !== null) && (
                                <span className="text-xs text-zinc-500">
                                  critical below {cLow ?? "—"}, above {cHigh ?? "—"}
                                </span>
                              )}
                              <DeleteRangeButton id={r.id} />
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  ))}
              </Panel>
            </li>
          ))}
        </ul>
      )}
    </PageShell>
  );
}
