import { CalendarPlus } from "lucide-react";
import { z } from "zod";
import { PageHeader, PageShell } from "@/components/app/page";
import { requireClinic } from "@/lib/auth/clinic-session";
import { withClinic } from "@/lib/db";
import { addDaysToDateString, isValidDateString, todayInTimeZone } from "@/lib/time";
import { getBookingOptions, MAX_BOOKING_DAYS_AHEAD } from "@/features/scheduling/booking.service";
import { getPatient } from "@/features/patients/patients.service";
import BookingForm from "./BookingForm";

export const metadata = { title: "Book appointment" };

export default async function NewAppointmentPage({
  searchParams,
}: {
  searchParams: Promise<{ patientId?: string; date?: string }>;
}) {
  const ctx = await requireClinic({ permission: ["appointment:manage", "patient:read"] });
  const params = await searchParams;
  const today = todayInTimeZone(ctx.timezone);

  const { options, patient } = await withClinic({ clinicId: ctx.clinicId, userId: ctx.userId }, async (tx) => ({
    options: await getBookingOptions(tx),
    patient:
      params.patientId && z.uuid().safeParse(params.patientId).success ? await getPatient(tx, params.patientId, today) : null,
  }));

  const initialDate = params.date && isValidDateString(params.date) && params.date >= today ? params.date : today;

  return (
    <PageShell width="default">
      <PageHeader
        icon={CalendarPlus}
        title="Book an appointment"
        description={`Slots come from each doctor's schedule and the service's duration. Times are clinic time (${ctx.timezone}).`}
      />
      <BookingForm
        doctors={options.doctors}
        services={options.services}
        initialPatient={patient ? { id: patient.id, name: patient.name, mrn: patient.mrn, age: patient.age, mobile: patient.mobile } : null}
        initialDate={initialDate}
        minDate={today}
        maxDate={addDaysToDateString(today, MAX_BOOKING_DAYS_AHEAD)}
      />
    </PageShell>
  );
}
