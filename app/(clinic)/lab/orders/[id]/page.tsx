import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ArrowLeft, FlaskConical, Printer } from "lucide-react";
import { ButtonLink, buttonClass } from "@/components/app/buttons";
import { PageHeader, PageShell, Panel } from "@/components/app/page";
import { StatusBadge } from "@/components/app/status-badge";
import { requireClinic } from "@/lib/auth/clinic-session";
import { recordAudit } from "@/lib/audit";
import { withClinic } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { getRequestMeta } from "@/lib/request";
import { todayInTimeZone } from "@/lib/time";
import { cn } from "@/lib/utils";
import { labOrderDetail } from "@/features/clinical/lab.service";
import { LAB_FLAG_MARKS, isCriticalFlag, type LabFlag } from "@/features/clinical/lab-rules";
import { DocumentsPanel } from "./DocumentsPanel";
import { ResultEntryForm } from "./ResultEntryForm";

export const metadata = { title: "Lab result" };

const SEX_SHORT: Record<string, string> = { male: "M", female: "F", other: "O", unknown: "?" };

const valueTone = (flag: string) => (flag === "normal" ? "text-zinc-900 dark:text-zinc-100" : isCriticalFlag(flag) ? "font-semibold text-red-700 dark:text-red-400" : "font-semibold text-amber-700 dark:text-amber-400");

/** One test: fill in the result and attach documents, or read what was saved. */
export default async function LabOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireClinic({ permission: "lab:result", module: "lab" });
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const meta = await getRequestMeta();

  const data = await withClinic({ clinicId: ctx.clinicId, userId: ctx.userId }, async (tx) => {
    const detail = await labOrderDetail(tx, ctx.clinicId, id, todayInTimeZone(ctx.timezone));
    if (detail?.item.status === "resulted") await recordAudit(tx, { clinicId: ctx.clinicId, actorUserId: ctx.userId, action: "LAB_RESULTS_VIEWED", targetType: "lab_order", targetId: id, patientId: detail.item.patientId, meta });
    return detail;
  });
  if (!data) notFound();
  const { item, fields, lines, documents, sampleType, resultedByName } = data;
  const active = documents.filter((d) => !d.removedAt);

  return (
    <PageShell>
      <Link href="/lab" className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-white">
        <ArrowLeft className="h-4 w-4" /> Lab worklist
      </Link>
      <PageHeader
        icon={FlaskConical}
        eyebrow={<span className="font-mono normal-case tracking-normal">{item.patientMrn}</span>}
        title={item.testName}
        description={[`${item.patientName}, ${item.patientAge ?? "—"} / ${SEX_SHORT[item.patientSex] ?? "?"}`, sampleType ? `Sample: ${sampleType}` : null, `Ordered by ${item.orderedByName}, ${formatDateTime(item.orderedAt, ctx.timezone)}`].filter(Boolean).join(" · ")}
        actions={
          item.status === "resulted" ? (
            <>
              <a href={`/lab/report/${item.encounterId}`} target="_blank" rel="noopener" className={buttonClass("primary", "md")}>
                <Printer className="h-4 w-4" /> Print report
              </a>
              <ButtonLink href={`/lab/patients/${item.patientId}`} variant="secondary">
                History
              </ButtonLink>
            </>
          ) : undefined
        }
      />

      {item.status === "cancelled" && (
        <Panel title="Cancelled">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">The doctor cancelled this test.</p>
        </Panel>
      )}

      {item.status === "ordered" && (
        <Panel title="Result" description={item.notes ? `Note from the doctor: ${item.notes}` : "Blank parameters are left off the report. Once saved, a result cannot be edited, and it goes straight to the doctor."}>
          <ResultEntryForm id={item.id} testName={item.testName} fields={fields} unit={item.unit} referenceRange={item.referenceRange} documentCount={active.length} />
        </Panel>
      )}

      {item.status === "resulted" && (
        <Panel
          flush={lines.length > 0}
          title="Result"
          description={[item.resultedAt ? `Reported ${formatDateTime(item.resultedAt, ctx.timezone)}` : null, resultedByName ? `by ${resultedByName}` : null].filter(Boolean).join(" ")}
          actions={item.resultFlag ? <StatusBadge tone={item.resultFlag === "critical" ? "danger" : item.resultFlag === "abnormal" ? "warning" : "success"}>{item.resultFlag}</StatusBadge> : undefined}
        >
          {lines.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-zinc-100 text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:border-zinc-800">
                    <th scope="col" className="px-6 py-3 lg:pl-8">
                      Parameter
                    </th>
                    <th scope="col" className="px-4 py-3 text-right">
                      Result
                    </th>
                    <th scope="col" className="px-4 py-3">
                      Unit
                    </th>
                    <th scope="col" className="px-4 py-3">
                      Reference
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {lines.map((l) => (
                    <tr key={l.id}>
                      <th scope="row" className="px-6 py-2.5 font-medium text-zinc-900 lg:pl-8 dark:text-zinc-100">
                        {l.name}
                      </th>
                      <td className={cn("px-4 py-2.5 text-right tabular-nums", valueTone(l.flag))}>
                        {l.value} {LAB_FLAG_MARKS[l.flag as LabFlag]}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-zinc-500">{l.unit}</td>
                      <td className="px-4 py-2.5 text-xs text-zinc-500">{l.referenceText}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              {item.resultValue}
              {item.unit ? ` ${item.unit}` : ""}
            </p>
          )}
          {item.resultNotes && <p className={cn("text-sm text-zinc-600 dark:text-zinc-400", lines.length > 0 ? "border-t border-zinc-100 px-6 py-3 lg:px-8 dark:border-zinc-800" : "mt-2")}>Note: {item.resultNotes}</p>}
        </Panel>
      )}

      <DocumentsPanel orderId={item.id} canUpload={item.status !== "cancelled"} resulted={item.status === "resulted"} documents={documents} timezone={ctx.timezone} />
    </PageShell>
  );
}
