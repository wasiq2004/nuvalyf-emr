import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ArrowLeft, ClipboardList, MessageCircleQuestion, ShieldAlert } from "lucide-react";
import { PageHeader, PageShell, Panel } from "@/components/app/page";
import { StatusBadge } from "@/components/app/status-badge";
import { requireClinic } from "@/lib/auth/clinic-session";
import { recordAudit } from "@/lib/audit";
import { withClinic } from "@/lib/db";
import { getRequestMeta } from "@/lib/request";
import { DEFAULT_LOCALE, formatDate, formatDateTime } from "@/lib/format";
import { todayInTimeZone } from "@/lib/time";
import { getClinicSettings } from "@/features/settings/settings.service";
import { getPrescriptionForDispensing } from "@/features/pharmacy/sales.service";
import { listQueriesForPrescription } from "@/features/pharmacy/queries.service";
import { ClosePrescriptionDialog, DispenseForm } from "./DispenseForm";

export const metadata = { title: "Fill prescription" };

const SEX: Record<string, string> = { male: "Male", female: "Female", other: "Other", unknown: "Sex not stated" };

export default async function DispensePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireClinic({ permission: "pharmacy:dispense", module: "pharmacy" });
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const today = todayInTimeZone(ctx.timezone);
  const meta = await getRequestMeta();

  const data = await withClinic({ clinicId: ctx.clinicId, userId: ctx.userId }, async (tx) => {
    const rx = await getPrescriptionForDispensing(tx, id, today);
    if (!rx) return null;
    await recordAudit(tx, {
      clinicId: ctx.clinicId,
      actorUserId: ctx.userId,
      action: "PRESCRIPTION_VIEWED_BY_PHARMACY",
      targetType: "prescription",
      targetId: id,
      patientId: rx.patient.id,
      meta,
    });
    return { rx, queries: await listQueriesForPrescription(tx, id), currency: (await getClinicSettings(tx, ctx.clinicId)).currency };
  });
  if (!data) notFound();
  const { rx } = data;
  const open = rx.dispenseStatus === "pending" || rx.dispenseStatus === "partial";

  return (
    <PageShell width="default">
      <Link href="/pharmacy" className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-white">
        <ArrowLeft className="h-4 w-4" /> Pharmacy
      </Link>

      <PageHeader
        icon={ClipboardList}
        eyebrow={<span className="font-mono normal-case tracking-normal">{rx.patient.mrn}</span>}
        title={rx.patient.name}
        description={`${rx.patient.age !== null ? `${rx.patient.age} years` : "Age unknown"} · ${SEX[rx.patient.sex]} · from ${rx.source.doctorName}, ${formatDate(rx.source.visitDate, ctx.timezone)}`}
        actions={
          <>
            <StatusBadge tone={rx.dispenseStatus === "partial" ? "warning" : rx.dispenseStatus === "dispensed" ? "success" : "info"}>
              {rx.dispenseStatus === "partial" ? "Part filled" : rx.dispenseStatus === "dispensed" ? "Dispensed" : rx.dispenseStatus === "not_required" ? "Closed" : "Waiting"}
            </StatusBadge>
            {open && <ClosePrescriptionDialog prescriptionId={rx.prescriptionId} />}
          </>
        }
      />

      {rx.patient.allergies.length > 0 ? (
        <div role="alert" aria-label="Allergies" className="flex items-start gap-3 rounded-2xl border border-red-300 bg-red-50 px-5 py-3.5 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/60 dark:text-red-300">
          <ShieldAlert className="mt-0.5 h-5 w-5 flex-shrink-0" />
          <p>
            <span className="font-semibold">Allergies: </span>
            {rx.patient.allergies.map((a) => `${a.substance} (${a.severity}${a.reaction ? `, ${a.reaction}` : ""})`).join("; ")}
          </p>
        </div>
      ) : (
        <p className="text-sm text-zinc-500">{rx.patient.noKnownAllergies ? "No known allergies." : "Allergies not recorded."}</p>
      )}

      {data.queries.length > 0 && (
        <Panel title="Questions to the doctor">
          <ul className="space-y-3">
            {data.queries.map((q) => (
              <li key={q.id} className="rounded-xl border border-zinc-200 p-3 text-sm dark:border-zinc-800">
                <p className="flex items-start gap-2">
                  <MessageCircleQuestion className="mt-0.5 h-4 w-4 flex-shrink-0 text-(--accent-text)" />
                  <span>
                    {q.itemName ? <span className="font-semibold">{q.itemName}: </span> : null}
                    {q.message}
                    <span className="block text-xs text-zinc-500">
                      {q.raisedByName} · {formatDateTime(q.raisedAt, ctx.timezone)}
                    </span>
                  </span>
                </p>
                {q.response ? (
                  <p className="mt-2 rounded-lg bg-emerald-50 p-2 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
                    {q.response}
                    <span className="block text-xs opacity-75">
                      {q.answeredByName} · {formatDateTime(q.answeredAt, ctx.timezone)}
                    </span>
                  </p>
                ) : (
                  <p className="mt-2 text-xs font-medium text-amber-700 dark:text-amber-400">Waiting for the doctor</p>
                )}
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Panel title="Prescription" description={`Signed ${formatDateTime(rx.signedAt, ctx.timezone)}. Fill each line from a batch; earliest expiry is chosen first.`}>
        {open ? (
          <DispenseForm prescriptionId={rx.prescriptionId} items={rx.items} currencyFormat={{ locale: DEFAULT_LOCALE, currency: data.currency }} />
        ) : (
          <p className="text-sm text-zinc-500">This prescription is closed.</p>
        )}
      </Panel>
    </PageShell>
  );
}
