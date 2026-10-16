import { ClipboardCheck } from "lucide-react";
import { PageHeader, PageShell, Panel } from "@/components/app/page";
import { AnalyticsTabs } from "@/components/analytics/cells";
import { requireClinic } from "@/lib/auth/clinic-session";
import { withClinic } from "@/lib/db";
import { cn } from "@/lib/utils";
import { dataQuality } from "@/features/analytics/analytics.service";

export const metadata = { title: "Data quality" };

function Measure({ label, count, of, hint }: { label: string; count: number; of?: number; hint?: string }) {
  const share = of ? Math.round((count / of) * 100) : null;
  const tone = share === null ? "" : share >= 25 ? "text-red-600 dark:text-red-400" : share >= 10 ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400";
  return (
    <div className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0">
      <div>
        <p className="text-sm text-zinc-800 dark:text-zinc-200">{label}</p>
        {hint && <p className="text-xs text-zinc-500">{hint}</p>}
      </div>
      <p className="text-right">
        <span className="text-lg font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">{count.toLocaleString()}</span>
        {share !== null && <span className={cn("ml-2 text-sm font-medium tabular-nums", tone)}>{share}%</span>}
      </p>
    </div>
  );
}

export default async function DataQualityPage() {
  const ctx = await requireClinic({ permission: "analytics:read", module: "analytics" });
  const q = await withClinic({ clinicId: ctx.clinicId, userId: ctx.userId }, (tx) => dataQuality(tx));

  return (
    <PageShell>
      <PageHeader icon={ClipboardCheck} eyebrow={ctx.clinicName} title="Data quality" description="Gaps that weaken analysis: missing or uncoded fields. Counts of records only." />
      <AnalyticsTabs active="quality" />

      <div className="grid gap-6 xl:grid-cols-2">
        <Panel title="Patients" description={`${q.patients.total.toLocaleString()} records`}>
          <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
            <Measure label="Age only (no date of birth)" count={q.patients.noDob} of={q.patients.total} hint="Ages are dated, but a date of birth is more precise" />
            <Measure label="Sex not recorded" count={q.patients.unknownSex} of={q.patients.total} />
            <Measure label="No mobile number" count={q.patients.noMobile} of={q.patients.total} hint="Cannot receive reminders" />
            <Measure label="Emergency records still incomplete" count={q.patients.placeholders} of={q.patients.total} />
          </div>
        </Panel>
        <Panel title="Consultations" description={`${q.consultations.finalized.toLocaleString()} finalised`}>
          <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
            <Measure label="Signed without a diagnosis" count={q.consultations.noDiagnosis} of={q.consultations.finalized} />
            <Measure label="Signed without vitals" count={q.consultations.noVitals} of={q.consultations.finalized} />
          </div>
        </Panel>
        <Panel title="Diagnoses" description={`${q.diagnoses.total.toLocaleString()} recorded`}>
          <Measure label="Codes not in the clinic's ICD-10 list" count={q.diagnoses.uncoded} of={q.diagnoses.total} hint="Custom codes cannot be grouped with standard ones" />
        </Panel>
        <Panel title="Prescriptions and lab" description={`${q.prescriptions.total.toLocaleString()} signed prescription lines`}>
          <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
            <Measure label="No quantity stated" count={q.prescriptions.noQuantity} of={q.prescriptions.total} />
            <Measure label="Lab tests waiting more than 7 days" count={q.lab.staleOrders} />
          </div>
        </Panel>
      </div>
    </PageShell>
  );
}
