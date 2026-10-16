import { BarChart3, Pill, Stethoscope, Users } from "lucide-react";
import { EmptyState, PageHeader, PageShell, Panel, StatCard } from "@/components/app/page";
import { DataTable } from "@/components/app/data-table";
import { BarChartPanel } from "@/components/app/charts";
import { AnalyticsTabs, Count, SuppressionNote } from "@/components/analytics/cells";
import { requireClinic } from "@/lib/auth/clinic-session";
import { withClinic } from "@/lib/db";
import { todayInTimeZone } from "@/lib/time";
import { AGE_BANDS } from "@/features/analytics/analytics-rules";
import { minCell, overview } from "@/features/analytics/analytics.service";

export const metadata = { title: "Analytics" };

const SEXES = ["female", "male", "other", "unknown"] as const;

export default async function AnalyticsPage() {
  const ctx = await requireClinic({ permission: "analytics:read", module: "analytics" });
  const today = todayInTimeZone(ctx.timezone);
  const data = await withClinic({ clinicId: ctx.clinicId, userId: ctx.userId }, async (tx) => overview(tx, today, await minCell(tx, ctx.clinicId)));
  const t = data.threshold;
  const cell = (band: string, sex: string) => data.ageSex.find((c) => c.band === band && c.sex === sex)?.count ?? 0;
  // Hidden months are gaps, not zeros; the total says when it leaves some out.
  const chart = data.perMonth.map((m) => ({ month: m.month.slice(2), Visits: m.visits }));
  const shownVisits = data.perMonth.reduce((s, m) => s + (m.visits ?? 0), 0);
  const hiddenMonths = data.perMonth.filter((m) => m.visits === null).length;
  const visitsValue =
    hiddenMonths === 0 ? shownVisits.toLocaleString() : shownVisits === 0 ? <Count value={null} threshold={t} /> : `${shownVisits.toLocaleString()}+`;

  return (
    <PageShell>
      <PageHeader
        icon={BarChart3}
        eyebrow={ctx.clinicName}
        title="Analytics"
        description={`De-identified: counts and bands only, no names, numbers or record numbers. Counts below ${t} are hidden.`}
      />
      <AnalyticsTabs active="overview" />

      <div className="grid gap-5 sm:grid-cols-3">
        <StatCard label="Patients" value={<Count value={data.patients} threshold={t} />} icon={Users} />
        <StatCard
          label="Visits (12 months)"
          value={visitsValue}
          icon={Stethoscope}
          hint={hiddenMonths ? `${hiddenMonths} ${hiddenMonths === 1 ? "month has" : "months have"} fewer than ${t} and ${hiddenMonths === 1 ? "is" : "are"} hidden` : undefined}
        />
        <StatCard label="Medicines prescribed" value={data.topMedicines.rows.length} icon={Pill} hint="Distinct generics, top 15" />
      </div>

      <Panel title="Visits per month" description={`Completed visits, last 12 months. Months with fewer than ${t} visits are left blank.`}>
        <BarChartPanel data={chart} xKey="month" bars={[{ key: "Visits", label: "Visits" }]} />
      </Panel>

      <Panel flush title="Patients by age and sex">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-100 dark:border-zinc-800">
                <th scope="col" className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-zinc-500 lg:px-8">
                  Age band
                </th>
                {SEXES.map((s) => (
                  <th key={s} scope="col" className="px-6 py-3 text-right text-xs font-semibold uppercase tracking-wider text-zinc-500">
                    {s}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {[...AGE_BANDS, "unknown"].map((band) => (
                <tr key={band}>
                  <th scope="row" className="px-6 py-3 text-left font-medium text-zinc-900 lg:px-8 dark:text-zinc-100">
                    {band === "unknown" ? "Age unknown" : band}
                  </th>
                  {SEXES.map((s) => (
                    <td key={s} className="px-6 py-3 text-right">
                      <Count value={cell(band, s)} threshold={t} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-6 py-3 lg:px-8">
          <SuppressionNote suppressed={data.ageSexSuppressed} threshold={t} />
        </div>
      </Panel>

      <div className="grid gap-6 xl:grid-cols-2">
        <Panel flush title="Most common diagnoses" description="Patients per ICD-10 code, finalised consultations, last 12 months.">
          <DataTable
            rows={data.topDiagnoses.rows}
            rowKey={(d) => d.code}
            empty={<EmptyState icon={Stethoscope} title="No coded diagnoses yet" />}
            columns={[
              {
                key: "code",
                header: "Diagnosis",
                cell: (d) => (
                  <span>
                    <span className="font-mono text-xs font-semibold text-(--accent-text)">{d.code}</span> {d.label}
                  </span>
                ),
              },
              { key: "n", header: "Patients", align: "right", cell: (d) => <Count value={d.count} threshold={t} /> },
            ]}
          />
          <div className="px-6 py-3 lg:px-8">
            <SuppressionNote suppressed={data.topDiagnoses.suppressed} threshold={t} />
          </div>
        </Panel>
        <Panel flush title="Most prescribed medicines" description="Patients per generic, signed prescriptions, last 12 months.">
          <DataTable
            rows={data.topMedicines.rows}
            rowKey={(m) => m.generic}
            empty={<EmptyState icon={Pill} title="No prescriptions yet" />}
            columns={[
              { key: "generic", header: "Generic", cell: (m) => <span className="capitalize">{m.generic}</span> },
              { key: "n", header: "Patients", align: "right", cell: (m) => <Count value={m.count} threshold={t} /> },
            ]}
          />
          <div className="px-6 py-3 lg:px-8">
            <SuppressionNote suppressed={data.topMedicines.suppressed} threshold={t} />
          </div>
        </Panel>
      </div>
    </PageShell>
  );
}
