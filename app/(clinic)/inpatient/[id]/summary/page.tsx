import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ArrowLeft, FileDown, FileText, Lock } from "lucide-react";
import { buttonClass } from "@/components/app/buttons";
import { PageHeader, PageShell, Panel } from "@/components/app/page";
import { StatusBadge } from "@/components/app/status-badge";
import { can, requireClinic } from "@/lib/auth/clinic-session";
import { withClinic } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { todayInTimeZone } from "@/lib/time";
import { admissionBill, getAdmission } from "@/features/inpatient/inpatient.service";
import { getSummary } from "@/features/inpatient/summary.service";
import { getClinicSettings } from "@/features/settings/settings.service";
import { DraftButton, SummaryEditor } from "./SummaryForms";

export const metadata = { title: "Discharge summary" };

export default async function SummaryPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireClinic({ permission: "inpatient:read", module: "inpatient" });
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const today = todayInTimeZone(ctx.timezone);
  const data = await withClinic({ clinicId: ctx.clinicId, userId: ctx.userId }, async (tx) => {
    const admission = await getAdmission(tx, id, today);
    if (!admission) return null;
    return { admission, summary: await getSummary(tx, id), bill: (await admissionBill(tx, id))!, currency: (await getClinicSettings(tx, ctx.clinicId)).currency };
  });
  if (!data) notFound();
  const { admission, summary, bill } = data;
  const canSign = can(ctx, "discharge:sign");
  const money = (v: string) => formatMoney(v, data.currency);

  return (
    <PageShell>
      <Link href={`/inpatient/${id}`} className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-white">
        <ArrowLeft className="h-4 w-4" /> {admission.number}
      </Link>
      <PageHeader
        icon={FileText}
        eyebrow={<span className="font-mono normal-case tracking-normal">{admission.number}</span>}
        title={`Discharge summary: ${admission.patient.name}`}
        description={`${formatDateTime(admission.admittedAt, ctx.timezone)} to ${admission.dischargedAt ? formatDateTime(admission.dischargedAt, ctx.timezone) : "still admitted"} · ${bill.balance > 0 ? `${money(bill.totals.balance)} due` : "nothing due"}`}
        actions={
          summary && (
            <>
              <StatusBadge tone={summary.status === "signed" ? "success" : "warning"}>{summary.status === "signed" ? "Signed" : "Draft"}</StatusBadge>
              <a href={`/inpatient/${id}/summary/pdf`} target="_blank" rel="noopener" className={buttonClass("secondary", "md")}>
                <FileDown className="h-4 w-4" /> PDF
              </a>
            </>
          )
        }
      />

      {!summary ? (
        <Panel>
          <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-400">
            The draft is written from this stay&apos;s record: reason, notes, diagnoses, lab results, vitals, bed moves, treatment and discharge medicines. The doctor reviews and signs it.
          </p>
          <DraftButton admissionId={id} label="Draft from the record" />
        </Panel>
      ) : summary.status === "signed" ? (
        <>
          <p className="flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-3 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
            <Lock className="h-4 w-4" /> Signed by {summary.signedByName} on {formatDateTime(summary.signedAt, ctx.timezone)}. This summary can no longer be changed.
          </p>
          {summary.sections
            .filter((s) => s.body.trim())
            .map((s) => (
              <Panel key={s.key} title={s.title}>
                <p className="whitespace-pre-wrap text-sm text-zinc-800 dark:text-zinc-200">{s.body}</p>
              </Panel>
            ))}
        </>
      ) : canSign ? (
        <SummaryEditor admissionId={id} sections={summary.sections} />
      ) : (
        <>
          <p className="text-sm text-zinc-500">Draft. The doctor reviews and signs it.</p>
          {summary.sections.map((s) => (
            <Panel key={s.key} title={s.title}>
              <p className="whitespace-pre-wrap text-sm text-zinc-800 dark:text-zinc-200">{s.body || "—"}</p>
            </Panel>
          ))}
        </>
      )}
    </PageShell>
  );
}
