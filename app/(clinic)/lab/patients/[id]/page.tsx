import Link from "next/link";
import { forbidden, notFound } from "next/navigation";
import { z } from "zod";
import { ArrowLeft, FlaskConical } from "lucide-react";
import { EmptyState, PageHeader, PageShell, Panel } from "@/components/app/page";
import { TrendChart } from "@/components/app/charts";
import { can, hasModule, recordDenied, requireClinic } from "@/lib/auth/clinic-session";
import { recordAudit } from "@/lib/audit";
import { withClinic } from "@/lib/db";
import { getRequestMeta } from "@/lib/request";
import { formatDate, formatDateTime } from "@/lib/format";
import { todayInTimeZone } from "@/lib/time";
import { cn } from "@/lib/utils";
import { getPatient } from "@/features/patients/patients.service";
import { patientLabHistory } from "@/features/clinical/lab.service";
import { LAB_FLAG_LABELS, LAB_FLAG_MARKS, type LabFlag } from "@/features/clinical/lab-rules";

export const metadata = { title: "Lab results" };

const cellTone = (flag: LabFlag) =>
  flag === "normal" ? "text-zinc-800 dark:text-zinc-200" : flag === "critical_low" || flag === "critical_high" ? "font-semibold text-red-700 dark:text-red-400" : "font-semibold text-amber-700 dark:text-amber-400";

export default async function PatientLabPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireClinic({ module: "lab" });
  if (!hasModule(ctx, "lab") || (!can(ctx, "lab:result") && !can(ctx, "encounter:read"))) {
    await recordDenied(ctx, "PAGE_ACCESS_DENIED", { required: ["lab:result", "encounter:read"], path: "/lab/patients/[id]" });
    forbidden();
  }
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const meta = await getRequestMeta();
  const data = await withClinic({ clinicId: ctx.clinicId, userId: ctx.userId }, async (tx) => {
    const patient = await getPatient(tx, id, todayInTimeZone(ctx.timezone));
    if (!patient) return null;
    await recordAudit(tx, { clinicId: ctx.clinicId, actorUserId: ctx.userId, action: "LAB_RESULTS_VIEWED", targetType: "patient", targetId: id, patientId: id, meta });
    return { patient, history: await patientLabHistory(tx, id, ctx.timezone) };
  });
  if (!data) notFound();
  const { patient, history } = data;
  const nothing = history.tests.length === 0 && history.others.length === 0;

  return (
    <PageShell width="wide">
      <Link href={can(ctx, "patient:read") ? `/patients/${id}` : "/lab"} className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-white">
        <ArrowLeft className="h-4 w-4" /> {can(ctx, "patient:read") ? patient.name : "Lab"}
      </Link>
      <PageHeader icon={FlaskConical} eyebrow={<span className="font-mono normal-case tracking-normal">{patient.mrn}</span>} title={`Lab results: ${patient.name}`} description="Each test over time. Values outside their range are marked; a change of unit starts its own row." />
      {nothing && <EmptyState icon={FlaskConical} title="No lab results yet" />}

      {history.tests.map((test) => {
        const charted = test.rows.filter((r) => r.cells.filter((c) => c.number !== null).length >= 2);
        return (
          <Panel key={test.name} flush title={test.name} description={`${test.dates.length} ${test.dates.length === 1 ? "report" : "reports"}`}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-zinc-100 dark:border-zinc-800">
                    <th scope="col" className="px-6 py-3 text-xs font-semibold uppercase tracking-wider text-zinc-500 lg:pl-8">
                      Parameter
                    </th>
                    <th scope="col" className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                      Reference
                    </th>
                    {test.dates.map((d) => (
                      <th key={d.orderId} scope="col" className="whitespace-nowrap px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-zinc-500">
                        {formatDate(d.date, "UTC")}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {test.rows.map((row) => (
                    <tr key={row.key}>
                      <th scope="row" className="whitespace-nowrap px-6 py-2.5 font-medium text-zinc-900 lg:pl-8 dark:text-zinc-100">
                        {row.name}
                        {row.unit && <span className="ml-1.5 text-xs font-normal text-zinc-500">{row.unit}</span>}
                      </th>
                      <td className="whitespace-nowrap px-4 py-2.5 text-xs text-zinc-500">{row.cells[row.cells.length - 1]?.ref || "—"}</td>
                      {test.dates.map((d) => {
                        const cell = row.cells.find((c) => c.orderId === d.orderId);
                        return (
                          <td key={d.orderId} title={cell ? LAB_FLAG_LABELS[cell.flag] : undefined} className={cn("whitespace-nowrap px-4 py-2.5 text-right tabular-nums", cell && cellTone(cell.flag))}>
                            {cell ? `${cell.value}${LAB_FLAG_MARKS[cell.flag] ? ` ${LAB_FLAG_MARKS[cell.flag]}` : ""}` : "—"}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {charted.length > 0 && (
              <div className="grid gap-6 border-t border-zinc-100 p-6 lg:grid-cols-2 lg:p-8 dark:border-zinc-800">
                {charted.map((row) => {
                  const last = row.cells[row.cells.length - 1];
                  const [low, high] = last.ref.includes(" - ") ? last.ref.split(" - ").map(Number) : [null, null];
                  return (
                    <div key={row.key}>
                      <p className="mb-2 text-sm font-medium text-zinc-900 dark:text-zinc-100">
                        {row.name}
                        {row.unit && <span className="ml-1.5 text-xs font-normal text-zinc-500">{row.unit}</span>}
                      </p>
                      <TrendChart
                        label={row.name}
                        unit={row.unit}
                        low={low}
                        high={high}
                        data={row.cells.filter((c) => c.number !== null).map((c) => ({ date: formatDate(c.date, "UTC"), value: c.number! }))}
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </Panel>
        );
      })}

      {history.others.length > 0 && (
        <Panel title="Other results" description="Reported as a single result.">
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {history.others.map((o) => (
              <li key={o.id} className="flex flex-wrap items-baseline justify-between gap-3 py-2.5 text-sm first:pt-0 last:pb-0">
                <span className="font-medium text-zinc-900 dark:text-zinc-100">{o.testName}</span>
                <span className="text-zinc-700 dark:text-zinc-300">
                  {o.resultValue}
                  {o.unit ? ` ${o.unit}` : ""}
                  {o.referenceRange ? <span className="text-xs text-zinc-500"> (ref {o.referenceRange})</span> : null}
                  <span className="ml-2 text-xs text-zinc-500">{o.resultedAt ? formatDateTime(o.resultedAt, ctx.timezone) : ""}</span>
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </PageShell>
  );
}
