import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { ArrowLeft, BedDouble } from "lucide-react";
import { EmptyState, PageHeader, PageShell, Panel } from "@/components/app/page";
import { requireClinic } from "@/lib/auth/clinic-session";
import { withClinic } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { toZonedDateTime, todayInTimeZone } from "@/lib/time";
import { getClinicSettings } from "@/features/settings/settings.service";
import { getPatient } from "@/features/patients/patients.service";
import { getBookingOptions } from "@/features/scheduling/booking.service";
import { bedBoard, openAdmissionFor } from "@/features/inpatient/inpatient.service";
import { AdmitForm } from "../InpatientForms";

export const metadata = { title: "Admit patient" };

export default async function AdmitPage({ searchParams }: { searchParams: Promise<{ patientId?: string }> }) {
  const ctx = await requireClinic({ permission: "inpatient:admit", module: "inpatient" });
  const { patientId } = await searchParams;
  if (!patientId || !z.uuid().safeParse(patientId).success) redirect("/inpatient");
  const today = todayInTimeZone(ctx.timezone);
  const data = await withClinic({ clinicId: ctx.clinicId, userId: ctx.userId }, async (tx) => ({
    patient: await getPatient(tx, patientId, today),
    open: await openAdmissionFor(tx, patientId),
    beds: await bedBoard(tx, today),
    options: await getBookingOptions(tx),
    currency: (await getClinicSettings(tx, ctx.clinicId)).currency,
  }));
  if (!data.patient) notFound();
  if (data.open) redirect(`/inpatient/${data.open.id}`);
  const free = data.beds
    .filter((b) => b.isActive && !b.admissionId)
    .map((b) => ({ value: b.id, label: `${b.ward ? `${b.ward} / ` : ""}${b.code} · ${b.categoryName} · ${formatMoney(b.dailyRate, data.currency)} a day` }));

  return (
    <PageShell>
      <Link href="/inpatient" className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-white">
        <ArrowLeft className="h-4 w-4" /> Inpatients
      </Link>
      <PageHeader
        icon={BedDouble}
        eyebrow={<span className="font-mono normal-case tracking-normal">{data.patient.mrn}</span>}
        title={`Admit ${data.patient.name}`}
        description={`${data.patient.age !== null ? `${data.patient.age} years` : "Age unknown"}. Bed charges start from the admission time.`}
      />
      <Panel>
        {free.length === 0 ? (
          <EmptyState icon={BedDouble} title="No free beds" description="A bed needs to be freed or added first." />
        ) : (
          <AdmitForm patientId={patientId} beds={free} doctors={data.options.doctors.map((d) => ({ value: d.id, label: d.name }))} now={toZonedDateTime(new Date(), ctx.timezone)} />
        )}
      </Panel>
    </PageShell>
  );
}
