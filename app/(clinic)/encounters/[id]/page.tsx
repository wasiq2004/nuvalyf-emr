import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ArrowLeft, FileDown, History, Lock, Pill, Stethoscope, TriangleAlert } from "lucide-react";
import { buttonClass } from "@/components/app/buttons";
import { EmptyState, PageHeader, PageShell, Panel } from "@/components/app/page";
import { StatusBadge } from "@/components/app/status-badge";
import { AllergyBanner } from "@/components/clinical/allergy-banner";
import { AllergyList } from "@/components/clinical/allergy-list";
import { AddAllergyDialog, NoKnownAllergiesButton } from "@/components/clinical/allergy-actions";
import { VitalsGrid } from "@/components/clinical/vitals-grid";
import { MarkReadButton } from "@/components/clinical/clinical-buttons";
import { visitTone, VISIT_LABELS } from "@/components/frontdesk/status";
import { can, hasModule, requireClinic } from "@/lib/auth/clinic-session";
import { recordAudit } from "@/lib/audit";
import { withClinic } from "@/lib/db";
import { getRequestMeta } from "@/lib/request";
import { formatDate, formatDateTime, formatTime } from "@/lib/format";
import { todayInTimeZone, toZonedDateTime } from "@/lib/time";
import { getEncounterCore, getPrivateNote, listAmendments, listPatientEncounters } from "@/features/clinical/encounters.service";
import { listQueriesForPrescription } from "@/features/pharmacy/queries.service";
import { AnswerQueryForm } from "@/components/clinical/answer-query";
import { listAllergies, listAllergyClassOptions } from "@/features/clinical/allergies.service";
import { listEncounterVitals } from "@/features/clinical/vitals.service";
import { listEncounterDiagnoses, searchDiagnosisCodes } from "@/features/clinical/diagnoses.service";
import { getDraftPrescription, listPresets } from "@/features/clinical/prescriptions.service";
import { listEncounterLabOrders, listLabTestOptions } from "@/features/clinical/lab.service";
import type { RxWarning } from "@/features/clinical/prescribing-rules";
import { cn } from "@/lib/utils";
import { AmendmentForm, LabOrderForm, NotesForm, PrivateNoteForm, VitalsDialog } from "./EncounterForms";
import { CancelLabButton, FinalizeButton, HandOverButton, RemoveDiagnosisButton, RemoveItemButton, TakeOverButton } from "./EncounterActions";
import { DiagnosisPicker } from "./DiagnosisPicker";
import { PrescriptionBuilder, WarningList } from "./PrescriptionBuilder";

export const metadata = { title: "Consultation" };

const SEX_LABEL: Record<string, string> = {
  male: "Male",
  female: "Female",
  other: "Other",
  unknown: "Sex not stated",
};

function NoteBlock({ label, text }: { label: string; text: string | null }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wider text-zinc-500">{label}</dt>
      <dd className={cn("mt-1 whitespace-pre-wrap text-sm", text ? "text-zinc-900 dark:text-zinc-100" : "text-zinc-400")}>
        {text || "Not recorded"}
      </dd>
    </div>
  );
}

function LabFlag({ flag }: { flag: string | null }) {
  if (!flag) return null;
  return <StatusBadge tone={flag === "critical" ? "danger" : flag === "abnormal" ? "warning" : "success"}>{flag}</StatusBadge>;
}

export default async function EncounterPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireClinic({ permission: "encounter:read" });
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const today = todayInTimeZone(ctx.timezone);
  const meta = await getRequestMeta();
  const labOn = hasModule(ctx, "lab");

  const data = await withClinic({ clinicId: ctx.clinicId, userId: ctx.userId }, async (tx) => {
    const core = await getEncounterCore(tx, id, today);
    if (!core) return null;
    await recordAudit(tx, {
      clinicId: ctx.clinicId,
      actorUserId: ctx.userId,
      action: "ENCOUNTER_VIEWED",
      targetType: "encounter",
      targetId: id,
      patientId: core.patient.id,
      meta,
    });
    const [
      allergies,
      classes,
      vitals,
      diagnoses,
      favourites,
      prescription,
      presets,
      labOrders,
      labTests,
      amendments,
      privateNote,
      history,
    ] = await Promise.all([
      listAllergies(tx, core.patient.id),
      listAllergyClassOptions(tx),
      listEncounterVitals(tx, id),
      listEncounterDiagnoses(tx, id),
      searchDiagnosisCodes(tx, ""),
      getDraftPrescription(tx, id),
      listPresets(tx),
      labOn ? listEncounterLabOrders(tx, id) : Promise.resolve([]),
      labOn ? listLabTestOptions(tx) : Promise.resolve([]),
      listAmendments(tx, id),
      getPrivateNote(tx, id),
      listPatientEncounters(tx, core.patient.id, 8),
    ]);
    const queries =
      prescription?.status === "signed" && hasModule(ctx, "pharmacy") ? await listQueriesForPrescription(tx, prescription.id) : [];
    return {
      ...core,
      queries,
      allergies,
      classes,
      vitals,
      diagnoses,
      favourites,
      prescription,
      presets,
      labOrders,
      labTests,
      amendments,
      privateNote,
      history,
    };
  });
  if (!data) notFound();

  const { encounter, patient, visit } = data;
  const open = encounter.status === "open";
  // Another doctor's open consultation is read-only until taken over.
  const someoneElses = Boolean(encounter.doctorId && encounter.doctorId !== ctx.userId);
  const canWrite = open && can(ctx, "encounter:write") && !someoneElses;
  const canPrescribe = canWrite && can(ctx, "prescription:sign");
  const canVitals = open && can(ctx, "vitals:write");
  const canAllergy = can(ctx, "allergy:write");
  const canOrderLab = canWrite && labOn && can(ctx, "lab:order");
  const missingRegistration = open && can(ctx, "encounter:finalize") && !ctx.registrationNumber?.trim();
  const items = data.prescription?.items ?? [];
  const latestVitals = data.vitals[0];
  const previous = data.history.filter((h) => h.id !== encounter.id).slice(0, 5);
  // A nurse in triage works on vitals and allergies; the doctor's panels stay out of the way until they hold something.
  const triageView = open && !can(ctx, "encounter:write");
  const hasNotes = [encounter.chiefComplaint, encounter.history, encounter.examination, encounter.plan, encounter.followUp].some(Boolean);

  const vitalsPanel = (
    <Panel
      title="Vitals"
      description={latestVitals ? `${latestVitals.recordedByName} · ${formatTime(latestVitals.recordedAt, ctx.timezone)}` : undefined}
      actions={canVitals ? <VitalsDialog encounterId={encounter.id} primary={!latestVitals && !can(ctx, "encounter:write")} /> : undefined}
    >
      {latestVitals ? (
        <div className="space-y-4">
          <VitalsGrid values={latestVitals.values} flags={latestVitals.flags} compact={!triageView} />
          {latestVitals.notes && <p className="text-xs text-zinc-500">{latestVitals.notes}</p>}
          {data.vitals.length > 1 && (
            <details className="text-sm">
              <summary className="cursor-pointer text-(--accent-text)">Earlier readings ({data.vitals.length - 1})</summary>
              <div className="mt-3 space-y-4">
                {data.vitals.slice(1).map((v) => (
                  <div key={v.id}>
                    <p className="mb-2 text-xs text-zinc-500">
                      {v.recordedByName} · {formatTime(v.recordedAt, ctx.timezone)}
                    </p>
                    <VitalsGrid values={v.values} flags={v.flags} compact={!triageView} />
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      ) : (
        <p className="text-sm text-zinc-500">No vitals recorded in this consultation.</p>
      )}
    </Panel>
  );
  const allergiesPanel = (
    <Panel
      title="Allergies"
      actions={
        canAllergy ? (
          <>
            {data.allergies.every((a) => a.status !== "active") && !patient.noKnownAllergiesAt && (
              <NoKnownAllergiesButton patientId={patient.id} />
            )}
            <AddAllergyDialog patientId={patient.id} classes={data.classes} />
          </>
        ) : undefined
      }
    >
      <AllergyList allergies={data.allergies} canWrite={canAllergy} timezone={ctx.timezone} />
    </Panel>
  );

  return (
    <PageShell>
      <Link href="/today" className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-white">
        <ArrowLeft className="h-4 w-4" /> Today
      </Link>

      <PageHeader
        icon={Stethoscope}
        eyebrow={
          <span className="normal-case tracking-normal">
            <span className="font-mono">{patient.mrn}</span> · Consultation
          </span>
        }
        title={patient.name}
        description={
          <>
            {patient.age !== null ? `${patient.age} years` : "Age unknown"} · {SEX_LABEL[patient.sex]}
            {data.doctor ? ` · ${data.doctor.name}` : ""} · started {formatTime(encounter.openedAt, ctx.timezone)}
            {toZonedDateTime(encounter.openedAt, ctx.timezone).date !== today ? `, ${formatDate(encounter.openedAt, ctx.timezone)}` : ""}
          </>
        }
        actions={
          <>
            {open ? (
              <StatusBadge tone={visitTone(visit.status)}>{VISIT_LABELS[visit.status] ?? visit.status}</StatusBadge>
            ) : (
              <StatusBadge tone="success">
                <Lock className="h-3 w-3" /> Signed
              </StatusBadge>
            )}
            {open &&
              can(ctx, ["queue:call", "vitals:write"]) &&
              !can(ctx, "encounter:write") &&
              ["waiting", "in_triage"].includes(visit.status) && <HandOverButton encounterId={encounter.id} />}
            {open && !someoneElses && can(ctx, "encounter:finalize") && (
              <FinalizeButton
                encounterId={encounter.id}
                medicines={items.length}
                diagnoses={data.diagnoses.length}
                blocked={missingRegistration}
              />
            )}
            {!open && data.prescription?.status === "signed" && (
              <a
                href={`/encounters/${encounter.id}/prescription`}
                target="_blank"
                rel="noopener"
                className={buttonClass("secondary", "md")}
              >
                <FileDown className="h-4 w-4" /> Prescription PDF
              </a>
            )}
          </>
        }
      />

      <AllergyBanner allergies={data.allergies} noKnownAllergiesAt={patient.noKnownAllergiesAt} timezone={ctx.timezone} sticky />

      {missingRegistration && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300"
        >
          <TriangleAlert className="mt-0.5 h-5 w-5 flex-shrink-0" />
          <div>
            <p className="font-semibold">Your medical registration number is not on file</p>
            <p className="mt-1">
              You can write notes, but you cannot sign this consultation or its prescription until your Clinic Admin adds it to your staff
              profile.
            </p>
          </div>
        </div>
      )}

      {open && someoneElses && can(ctx, ["encounter:write", "prescription:sign"]) && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-200">
          <p>
            This is <span className="font-semibold">{data.doctor?.name ?? "another doctor"}</span>&apos;s consultation. You can read it; to continue it, take
            it over (recorded in the audit trail).
          </p>
          <TakeOverButton encounterId={encounter.id} />
        </div>
      )}

      {!open && (
        <div className="flex items-start gap-3 rounded-2xl border border-zinc-200 bg-white/80 p-4 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-400">
          <Lock className="mt-0.5 h-5 w-5 flex-shrink-0" />
          <p>
            Signed by <span className="font-semibold text-zinc-900 dark:text-zinc-100">{data.finalizedByName}</span> on{" "}
            {formatDateTime(encounter.finalizedAt, ctx.timezone)}. This record can no longer be changed; corrections are added as
            amendments.
          </p>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="min-w-0 space-y-6 xl:col-span-2">
          {triageView && vitalsPanel}
          {triageView && allergiesPanel}

          {(!triageView || hasNotes) && (
            <Panel title="Consultation notes">
              {canWrite ? (
                <NotesForm
                  encounterId={encounter.id}
                  values={{
                    chiefComplaint: encounter.chiefComplaint ?? "",
                    history: encounter.history ?? "",
                    examination: encounter.examination ?? "",
                    plan: encounter.plan ?? "",
                    followUp: encounter.followUp ?? "",
                  }}
                />
              ) : (
                <dl className="space-y-5">
                  <NoteBlock label="Chief complaint" text={encounter.chiefComplaint} />
                  <div className="grid gap-5 lg:grid-cols-2">
                    <NoteBlock label="History" text={encounter.history} />
                    <NoteBlock label="Examination" text={encounter.examination} />
                  </div>
                  <NoteBlock label="Plan and advice" text={encounter.plan} />
                  <NoteBlock label="Follow-up" text={encounter.followUp} />
                </dl>
              )}
            </Panel>
          )}

          {(!triageView || data.diagnoses.length > 0) && (
            <Panel title="Diagnosis" description="ICD-10. The first diagnosis is the primary one.">
              <div className="space-y-5">
                {data.diagnoses.length > 0 ? (
                  <ul className="divide-y divide-zinc-100 rounded-2xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
                    {data.diagnoses.map((d) => (
                      <li key={d.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                        <span className="flex min-w-0 items-center gap-3">
                          <span className="font-mono text-sm font-semibold text-(--accent-text)">{d.code}</span>
                          <span className="truncate text-sm text-zinc-800 dark:text-zinc-200">{d.label}</span>
                          {d.isPrimary && <StatusBadge tone="accent">Primary</StatusBadge>}
                        </span>
                        {canWrite && <RemoveDiagnosisButton id={d.id} code={d.code} />}
                      </li>
                    ))}
                  </ul>
                ) : (
                  !canWrite && <p className="text-sm text-zinc-500">No diagnosis recorded.</p>
                )}
                {canWrite && <DiagnosisPicker encounterId={encounter.id} favourites={data.favourites} />}
              </div>
            </Panel>
          )}

          {(!triageView || items.length > 0) && (
            <Panel
              title="Prescription"
              description={
                data.prescription?.status === "signed"
                  ? `Signed ${formatDateTime(data.prescription.signedAt, ctx.timezone)}`
                  : "Each medicine is checked against the patient's allergies and the other medicines here."
              }
              actions={data.prescription?.status === "signed" ? <StatusBadge tone="success">Signed</StatusBadge> : undefined}
            >
              <div className="space-y-5">
                {items.length > 0 ? (
                  <ol className="space-y-3">
                    {items.map((item, index) => {
                      const warnings = (item.warnings ?? []) as RxWarning[];
                      return (
                        <li key={item.id} className="rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="font-semibold text-zinc-900 dark:text-zinc-100">
                                {index + 1}. {item.drugName}
                                <span className="ml-2 text-xs font-normal text-zinc-500">
                                  {item.genericName}
                                  {item.strength ? ` · ${item.strength}` : ""} · {item.form}
                                </span>
                              </p>
                              <p className="mt-1 text-sm text-zinc-700 dark:text-zinc-300">
                                {item.dose} · {item.frequency}
                                {item.durationDays ? ` · ${item.durationDays} ${item.durationDays === 1 ? "day" : "days"}` : ""}
                                {item.instructions ? ` · ${item.instructions}` : ""}
                                {item.quantity ? ` · Qty ${item.quantity}` : ""}
                              </p>
                            </div>
                            {canPrescribe && <RemoveItemButton id={item.id} name={item.drugName} />}
                          </div>
                          {warnings.length > 0 && (
                            <div className="mt-3 space-y-2">
                              <WarningList warnings={warnings} />
                              {item.overrideReason && (
                                <p className="text-xs text-zinc-600 dark:text-zinc-400">
                                  <span className="font-semibold">Prescribed anyway:</span> {item.overrideReason}
                                </p>
                              )}
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                ) : (
                  !canPrescribe && <EmptyState icon={Pill} title="No medicines prescribed" />
                )}
                {canPrescribe && <PrescriptionBuilder encounterId={encounter.id} presets={data.presets} />}
              </div>
            </Panel>
          )}

          {labOn && (data.labOrders.length > 0 || canOrderLab) && (
            <Panel title="Lab tests" description="Results come back to the ordering doctor and stay on their Today screen until read.">
              <div className="space-y-5">
                {data.labOrders.length > 0 && (
                  <ul className="divide-y divide-zinc-100 rounded-2xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
                    {data.labOrders.map((o) => (
                      <li key={o.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
                        <div className="min-w-0">
                          <p
                            className={cn(
                              "text-sm font-medium",
                              o.status === "cancelled" ? "text-zinc-400 line-through" : "text-zinc-900 dark:text-zinc-100",
                            )}
                          >
                            {o.testName}
                          </p>
                          {o.status === "resulted" ? (
                            <p className="mt-0.5 text-sm text-zinc-700 dark:text-zinc-300">
                              <span className="font-semibold">{o.resultValue}</span>
                              {o.unit ? ` ${o.unit}` : ""}
                              {o.referenceRange ? <span className="text-zinc-500"> (ref {o.referenceRange})</span> : null}
                              {o.resultNotes ? <span className="block text-xs text-zinc-500">{o.resultNotes}</span> : null}
                            </p>
                          ) : (
                            <p className="mt-0.5 text-xs text-zinc-500">
                              Ordered {formatTime(o.orderedAt, ctx.timezone)}
                              {o.notes ? ` · ${o.notes}` : ""}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          {o.status === "ordered" && <StatusBadge tone="info">Awaiting result</StatusBadge>}
                          {o.status === "cancelled" && <StatusBadge>Cancelled</StatusBadge>}
                          <LabFlag flag={o.resultFlag} />
                          {o.status === "resulted" && !o.readAt && o.orderedBy === ctx.userId && <MarkReadButton id={o.id} />}
                          {o.status === "ordered" && canOrderLab && <CancelLabButton id={o.id} name={o.testName} />}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                {canOrderLab && <LabOrderForm encounterId={encounter.id} tests={data.labTests} />}
              </div>
            </Panel>
          )}

          {data.queries.length > 0 && (
            <Panel title="Pharmacy questions" description="Asked while dispensing. Answers are kept with the prescription.">
              <ul className="space-y-3">
                {data.queries.map((q) => (
                  <li key={q.id} className="rounded-2xl border border-zinc-200 p-4 text-sm dark:border-zinc-800">
                    <p className="text-zinc-900 dark:text-zinc-100">
                      {q.itemName ? <span className="font-semibold">{q.itemName}: </span> : null}
                      {q.message}
                    </p>
                    <p className="mt-1 text-xs text-zinc-500">
                      {q.raisedByName} · {formatDateTime(q.raisedAt, ctx.timezone)}
                    </p>
                    {q.response ? (
                      <p className="mt-2 rounded-lg bg-emerald-50 p-2 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
                        {q.response}
                        <span className="block text-xs opacity-75">
                          {q.answeredByName} · {formatDateTime(q.answeredAt, ctx.timezone)}
                        </span>
                      </p>
                    ) : can(ctx, "prescription:sign") ? (
                      <div className="mt-3">
                        <AnswerQueryForm id={q.id} />
                      </div>
                    ) : (
                      <p className="mt-2 text-xs font-medium text-amber-700 dark:text-amber-400">Waiting for the doctor</p>
                    )}
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          {!open && (
            <Panel title="Amendments" description="Added after signing. The signed record above is unchanged.">
              <div className="space-y-5">
                {data.amendments.length === 0 ? (
                  <p className="text-sm text-zinc-500">No amendments.</p>
                ) : (
                  <ul className="space-y-3">
                    {data.amendments.map((a) => (
                      <li key={a.id} className="rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800">
                        <p className="whitespace-pre-wrap text-sm text-zinc-900 dark:text-zinc-100">{a.text}</p>
                        <p className="mt-2 text-xs text-zinc-500">
                          {a.authorName} · {formatDateTime(a.createdAt, ctx.timezone)}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
                {can(ctx, "encounter:write") && <AmendmentForm encounterId={encounter.id} />}
              </div>
            </Panel>
          )}
        </div>

        <div className="min-w-0 space-y-6">
          {!triageView && vitalsPanel}
          {!triageView && allergiesPanel}

          {can(ctx, "encounter:write") && (
            <Panel title="Private note" description="Yours alone: not the Clinic Admin, not other doctors.">
              <PrivateNoteForm encounterId={encounter.id} text={data.privateNote?.text ?? ""} />
            </Panel>
          )}

          <Panel flush title="Previous consultations">
            {previous.length === 0 ? (
              <div className="p-6">
                <EmptyState icon={History} title="First consultation" />
              </div>
            ) : (
              <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {previous.map((h) => (
                  <li key={h.id}>
                    <Link href={`/encounters/${h.id}`} className="block px-6 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                      <p className="flex items-center justify-between gap-2 text-sm font-medium text-zinc-900 dark:text-zinc-100">
                        {formatDate(h.openedAt, ctx.timezone)}
                        {h.status === "open" && <StatusBadge tone="warning">Open</StatusBadge>}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-zinc-500">
                        {h.diagnoses[0] ?? h.chiefComplaint ?? "No diagnosis"}
                        {h.doctorName ? ` · ${h.doctorName}` : ""}
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </PageShell>
  );
}
