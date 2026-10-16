import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, ArrowLeft, CalendarPlus, Receipt, Stethoscope, UserRound } from "lucide-react";
import { z } from "zod";
import { ButtonLink } from "@/components/app/buttons";
import { DetailList, EmptyState, PageHeader, PageShell, Panel } from "@/components/app/page";
import { DataTable } from "@/components/app/data-table";
import { StatusBadge } from "@/components/app/status-badge";
import { can, hasModule, requireClinic } from "@/lib/auth/clinic-session";
import { recordAudit } from "@/lib/audit";
import { withClinic } from "@/lib/db";
import { getRequestMeta } from "@/lib/request";
import { formatDate, formatDateTime } from "@/lib/format";
import { todayInTimeZone } from "@/lib/time";
import { getOverrides, getPatient, patientsByIds } from "@/features/patients/patients.service";
import { getBookingOptions, listPatientAppointments } from "@/features/scheduling/booking.service";
import { visits } from "@/lib/db/schema";
import { desc, eq } from "drizzle-orm";
import { appointmentTone, visitTone, VISIT_LABELS } from "@/components/frontdesk/status";
import { EditPatientDialog, WalkInDialog } from "./PatientActions";
import { AllergyBanner } from "@/components/clinical/allergy-banner";
import { AllergyList } from "@/components/clinical/allergy-list";
import { AddAllergyDialog, NoKnownAllergiesButton } from "@/components/clinical/allergy-actions";
import { listAllergies, listAllergyClassOptions } from "@/features/clinical/allergies.service";
import { listPatientEncounters } from "@/features/clinical/encounters.service";
import { listInvoices, outstandingSummary } from "@/features/billing/billing.service";
import { getClinicSettings } from "@/features/settings/settings.service";
import { InvoiceBadge } from "@/components/billing/status";
import { NewInvoiceButton } from "@/components/billing/billing-buttons";
import { formatMoney, toMinor } from "@/lib/money";
import { ConsentControls } from "@/components/messaging/consent-panel";
import { consentHistory, currentConsent } from "@/features/messaging/consent.service";
import { CONSENT_LABELS, type ConsentType } from "@/features/messaging/messaging-rules";

export const metadata = { title: "Patient" };

const SEX_LABEL: Record<string, string> = { male: "Male", female: "Female", other: "Other", unknown: "Not stated" };

export default async function PatientPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireClinic({ permission: "patient:read" });
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const today = todayInTimeZone(ctx.timezone);
  const meta = await getRequestMeta();

  const data = await withClinic({ clinicId: ctx.clinicId, userId: ctx.userId }, async (tx) => {
    const patient = await getPatient(tx, id, today);
    if (!patient) return null;
    // "Who opened this record?" must be answerable (Auditor flow).
    await recordAudit(tx, {
      clinicId: ctx.clinicId,
      actorUserId: ctx.userId,
      action: "PATIENT_VIEWED",
      targetType: "patient",
      targetId: id,
      patientId: id,
      meta,
    });
    const [appointmentRows, visitRows, overrides, options] = await Promise.all([
      listPatientAppointments(tx, id),
      tx.select().from(visits).where(eq(visits.patientId, id)).orderBy(desc(visits.arrivedAt)).limit(30),
      getOverrides(tx, id),
      getBookingOptions(tx),
    ]);
    const overridden = await patientsByIds(tx, overrides.flatMap((o) => o.candidateIds));
    // Clinical content only for roles that may read the clinical record.
    const clinical = can(ctx, "encounter:read")
      ? {
          allergies: await listAllergies(tx, id),
          classes: await listAllergyClassOptions(tx),
          encounters: await listPatientEncounters(tx, id),
        }
      : null;
    const billing = can(ctx, "billing:read")
      ? {
          invoices: await listInvoices(tx, "all", new Date(0), new Date(), id),
          outstanding: await outstandingSummary(tx, id),
          currency: (await getClinicSettings(tx, ctx.clinicId)).currency,
        }
      : null;
    const consent = hasModule(ctx, "whatsapp")
      ? {
          reminders: (await currentConsent(tx, "whatsapp_reminders", [id])).get(id) ?? false,
          broadcasts: (await currentConsent(tx, "whatsapp_broadcasts", [id])).get(id) ?? false,
          history: await consentHistory(tx, id),
        }
      : null;
    return { patient, appointmentRows, visitRows, overrides, overridden, options, clinical, billing, consent };
  });
  if (!data) notFound();

  const { patient } = data;
  const canWrite = can(ctx, "patient:write");

  return (
    <PageShell width="default">
      <Link href="/patients" className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-white">
        <ArrowLeft className="h-4 w-4" /> Patients
      </Link>

      <PageHeader
        icon={UserRound}
        eyebrow={<span className="font-mono normal-case tracking-normal">{patient.mrn}</span>}
        title={patient.name}
        description={`${patient.age !== null ? `${patient.age} years` : "Age unknown"} · ${SEX_LABEL[patient.sex]}${patient.mobile ? ` · ${patient.mobile}` : ""}`}
        actions={
          <>
            {canWrite && (
              <EditPatientDialog
                values={{
                  id: patient.id,
                  firstName: patient.firstName ?? "",
                  lastName: patient.lastName ?? "",
                  sex: patient.sex,
                  dateOfBirth: patient.dateOfBirth ?? "",
                  statedAgeYears: patient.dateOfBirth ? "" : String(patient.age ?? ""),
                  mobile: patient.mobile ?? "",
                  altPhone: patient.altPhone ?? "",
                  email: patient.email ?? "",
                  addressLine: patient.addressLine ?? "",
                  city: patient.city ?? "",
                }}
                completing={patient.isPlaceholder}
              />
            )}
            {can(ctx, "queue:checkin") && <WalkInDialog patientId={patient.id} doctors={data.options.doctors} services={data.options.services} />}
            {can(ctx, "appointment:manage") && (
              <ButtonLink href={`/appointments/new?patientId=${patient.id}`}>
                <CalendarPlus className="h-4 w-4" /> Book appointment
              </ButtonLink>
            )}
          </>
        }
      />

      {patient.isPlaceholder && (
        <div className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-400">
          <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0" />
          <div>
            <p className="font-semibold">Emergency admission: record incomplete</p>
            <p className="mt-1">
              Admitted as &ldquo;{patient.emergencyLabel}&rdquo;. Complete the details to close the urgent task.
            </p>
          </div>
        </div>
      )}

      {data.clinical && (
        <AllergyBanner allergies={data.clinical.allergies} noKnownAllergiesAt={patient.noKnownAllergiesAt} timezone={ctx.timezone} />
      )}

      <Panel title="Details">
        <DetailList
          items={[
            { label: "Record number", value: <span className="font-mono">{patient.mrn}</span> },
            { label: "Date of birth", value: patient.dateOfBirth ? formatDate(patient.dateOfBirth, "UTC") : "Not recorded" },
            {
              label: "Age",
              value: patient.age !== null ? `${patient.age} years${patient.statedAgeOn ? ` (stated on ${formatDate(patient.statedAgeOn, "UTC")})` : ""}` : "Unknown",
            },
            { label: "Sex", value: SEX_LABEL[patient.sex] },
            { label: "Mobile", value: patient.mobile },
            { label: "Alternate phone", value: patient.altPhone },
            { label: "Email", value: patient.email },
            { label: "Address", value: [patient.addressLine, patient.city].filter(Boolean).join(", ") || null },
          ]}
        />
      </Panel>

      {data.consent && (
        <Panel title="Messaging consent" description="WhatsApp messages only ever go to patients who agreed. Withdrawing takes effect immediately, even for messages already queued.">
          <ConsentControls
            patientId={patient.id}
            current={{ whatsapp_reminders: data.consent.reminders, whatsapp_broadcasts: data.consent.broadcasts }}
            canWrite={canWrite}
            hasMobile={Boolean(patient.mobile)}
          />
          {data.consent.history.length > 0 && (
            <details className="mt-4 text-sm">
              <summary className="cursor-pointer text-(--accent-text)">History ({data.consent.history.length})</summary>
              <ul className="mt-2 space-y-1 text-xs text-zinc-600 dark:text-zinc-400">
                {data.consent.history.map((h) => (
                  <li key={h.id}>
                    {formatDateTime(h.recordedAt, ctx.timezone)} · {h.granted ? "Agreed" : "Withdrew"}: {CONSENT_LABELS[h.type as ConsentType]} ·{" "}
                    {h.source === "import" ? "imported" : (h.recordedByName ?? h.source)}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </Panel>
      )}

      {data.overrides.length > 0 && (
        <Panel title="Duplicate decisions" description="This record was created despite similar existing records.">
          <ul className="space-y-3 text-sm">
            {data.overrides.map((o) => (
              <li key={o.id} className="rounded-xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/30">
                <p className="text-zinc-800 dark:text-zinc-200">&ldquo;{o.reason}&rdquo;</p>
                <p className="mt-1 text-xs text-zinc-500">
                  {formatDateTime(o.createdAt, ctx.timezone)} · similar to{" "}
                  {data.overridden
                    .filter((p) => o.candidateIds.includes(p.id))
                    .map((p) => `${[p.firstName, p.lastName].filter(Boolean).join(" ")} (${p.mrn})`)
                    .join(", ")}
                </p>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {data.clinical && (
        <>
          <Panel
            title="Allergies"
            actions={
              can(ctx, "allergy:write") ? (
                <>
                  {data.clinical.allergies.every((a) => a.status !== "active") && !patient.noKnownAllergiesAt && <NoKnownAllergiesButton patientId={patient.id} />}
                  <AddAllergyDialog patientId={patient.id} classes={data.clinical.classes} />
                </>
              ) : undefined
            }
          >
            <AllergyList allergies={data.clinical.allergies} canWrite={can(ctx, "allergy:write")} timezone={ctx.timezone} />
          </Panel>

          <Panel flush title="Consultations" description="Every view of a consultation is recorded in the audit trail.">
            <DataTable
              rows={data.clinical.encounters}
              rowKey={(e) => e.id}
              empty={<EmptyState icon={Stethoscope} title="No consultations yet" />}
              columns={[
                {
                  key: "date",
                  header: "Date",
                  cell: (e) => (
                    <Link href={`/encounters/${e.id}`} className="font-medium text-zinc-900 hover:underline dark:text-zinc-100">
                      {formatDate(e.openedAt, ctx.timezone)}
                    </Link>
                  ),
                },
                { key: "doctor", header: "Doctor", hideOnMobile: true, cell: (e) => e.doctorName ?? "—" },
                { key: "dx", header: "Diagnosis", cell: (e) => <span className="text-sm">{e.diagnoses.join("; ") || e.chiefComplaint || "—"}</span> },
                {
                  key: "status",
                  header: "",
                  align: "right",
                  cell: (e) => (e.status === "finalized" ? <StatusBadge tone="success">Signed</StatusBadge> : <StatusBadge tone="warning">Open</StatusBadge>),
                },
              ]}
            />
          </Panel>
        </>
      )}

      {data.billing && (
        <Panel
          flush
          title="Billing"
          description={
            toMinor(data.billing.outstanding.amount) > 0
              ? `Outstanding: ${formatMoney(data.billing.outstanding.amount, data.billing.currency)}`
              : "Nothing outstanding."
          }
          actions={can(ctx, "billing:manage") ? <NewInvoiceButton patientId={patient.id} /> : undefined}
        >
          <DataTable
            rows={data.billing.invoices}
            rowKey={(i) => i.id}
            empty={<EmptyState icon={Receipt} title="No invoices yet" />}
            columns={[
              {
                key: "number",
                header: "Invoice",
                cell: (i) => (
                  <Link href={`/billing/${i.id}`} className="font-mono text-sm font-semibold text-(--accent-text) hover:underline">
                    {i.number}
                  </Link>
                ),
              },
              { key: "date", header: "Date", hideOnMobile: true, cell: (i) => formatDate(i.createdAt, ctx.timezone) },
              { key: "total", header: "Total", align: "right", cell: (i) => formatMoney(i.total, data.billing!.currency) },
              { key: "status", header: "", align: "right", cell: (i) => <InvoiceBadge status={i.status} paymentState={i.paymentState} /> },
            ]}
          />
        </Panel>
      )}

      <Panel flush title="Appointments">
        <DataTable
          rows={data.appointmentRows}
          rowKey={(a) => a.id}
          empty={<EmptyState icon={CalendarPlus} title="No appointments yet" />}
          columns={[
            { key: "when", header: "When", cell: (a) => formatDateTime(a.startsAt, ctx.timezone) },
            { key: "doctor", header: "Doctor", cell: (a) => [a.doctorTitle, a.doctorFirst, a.doctorLast].filter(Boolean).join(" ") },
            { key: "service", header: "Service", hideOnMobile: true, cell: (a) => a.serviceName ?? "—" },
            {
              key: "status",
              header: "Status",
              cell: (a) => <StatusBadge tone={appointmentTone(a.status)}>{a.status.replace("_", " ")}</StatusBadge>,
            },
          ]}
        />
      </Panel>

      <Panel flush title="Visits" description="That a visit happened is visible here; what was recorded in it is in the clinical record.">
        <DataTable
          rows={data.visitRows}
          rowKey={(v) => v.id}
          empty={<EmptyState icon={UserRound} title="No visits yet" />}
          columns={[
            { key: "date", header: "Date", cell: (v) => formatDate(v.visitDate, "UTC") },
            { key: "arrived", header: "Arrived", cell: (v) => formatDateTime(v.arrivedAt, ctx.timezone) },
            {
              key: "status",
              header: "Status",
              cell: (v) => (
                <span className="flex gap-1">
                  <StatusBadge tone={visitTone(v.status)}>{VISIT_LABELS[v.status] ?? v.status}</StatusBadge>
                  {v.isEmergency && <StatusBadge tone="danger">Emergency</StatusBadge>}
                </span>
              ),
            },
          ]}
        />
      </Panel>
    </PageShell>
  );
}
