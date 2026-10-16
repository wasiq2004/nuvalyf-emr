import Link from "next/link";
import { CalendarDays, CalendarPlus, ChevronLeft, ChevronRight } from "lucide-react";
import { ButtonLink, buttonClass } from "@/components/app/buttons";
import { EmptyState, PageHeader, PageShell, Panel, StatCard } from "@/components/app/page";
import { DataTable } from "@/components/app/data-table";
import { StatusBadge } from "@/components/app/status-badge";
import { inputClass } from "@/components/app/styles";
import { can, requireClinic } from "@/lib/auth/clinic-session";
import { withClinic } from "@/lib/db";
import { formatTime } from "@/lib/format";
import { addDaysToDateString, isValidDateString, todayInTimeZone, weekdayLabel } from "@/lib/time";
import { cn } from "@/lib/utils";
import { listAppointmentsForDay } from "@/features/scheduling/booking.service";
import { listDoctors } from "@/features/scheduling/schedules.service";
import { appointmentTone } from "@/components/frontdesk/status";
import { AppointmentRowActions } from "./AppointmentActions";

export const metadata = { title: "Appointments" };

export default async function AppointmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; doctor?: string }>;
}) {
  const ctx = await requireClinic({ permission: "appointment:read" });
  const params = await searchParams;
  const today = todayInTimeZone(ctx.timezone);
  const date = params.date && isValidDateString(params.date) ? params.date : today;

  const { rows, doctors } = await withClinic({ clinicId: ctx.clinicId, userId: ctx.userId }, async (tx) => {
    const doctors = await listDoctors(tx);
    const doctorId = doctors.some((d) => d.id === params.doctor) ? params.doctor : undefined;
    return { rows: await listAppointmentsForDay(tx, { date, timeZone: ctx.timezone, doctorId }), doctors };
  });

  const active = rows.filter((r) => r.status !== "cancelled");
  const canManage = can(ctx, "appointment:manage");
  const canCheckIn = can(ctx, "queue:checkin");
  const dayLink = (d: string) => `/appointments?date=${d}${params.doctor ? `&doctor=${params.doctor}` : ""}`;
  const dateLabel = new Date(`${date}T12:00:00Z`).toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });

  return (
    <PageShell>
      <PageHeader
        icon={CalendarDays}
        eyebrow={date === today ? "Today" : weekdayLabel(date)}
        title={dateLabel}
        description="Booked visits for the day. Check patients in when they arrive to start their wait clock."
        actions={
          canManage ? (
            <ButtonLink href={`/appointments/new?date=${date}`}>
              <CalendarPlus className="h-4 w-4" /> Book appointment
            </ButtonLink>
          ) : undefined
        }
      />

      <form className="flex flex-wrap items-center gap-3">
        <Link href={dayLink(addDaysToDateString(date, -1))} className={buttonClass("secondary", "md")} aria-label="Previous day">
          <ChevronLeft className="h-4 w-4" />
        </Link>
        <input type="date" name="date" defaultValue={date} className={cn(inputClass, "h-11 w-44")} aria-label="Date" />
        <Link href={dayLink(addDaysToDateString(date, 1))} className={buttonClass("secondary", "md")} aria-label="Next day">
          <ChevronRight className="h-4 w-4" />
        </Link>
        <select name="doctor" defaultValue={params.doctor ?? ""} className={cn(inputClass, "h-11 w-56")} aria-label="Doctor">
          <option value="">All doctors</option>
          {doctors.map((d) => (
            <option key={d.id} value={d.id}>
              {[d.title, d.firstName, d.lastName].filter(Boolean).join(" ")}
            </option>
          ))}
        </select>
        <button type="submit" className={buttonClass("secondary", "md")}>
          Show
        </button>
        {date !== today && (
          <Link href="/appointments" className="text-sm font-medium text-(--accent-text) hover:underline">
            Back to today
          </Link>
        )}
      </form>

      <div className="grid gap-5 sm:grid-cols-4">
        <StatCard label="Booked" value={active.length} icon={CalendarDays} />
        <StatCard label="Checked in" value={rows.filter((r) => r.status === "checked_in" || r.status === "completed").length} icon={CalendarDays} />
        <StatCard label="Still to arrive" value={rows.filter((r) => r.status === "booked").length} icon={CalendarDays} />
        <StatCard label="No-shows" value={rows.filter((r) => r.status === "no_show").length} icon={CalendarDays} />
      </div>

      <Panel flush>
        <DataTable
          rows={rows}
          rowKey={(a) => a.id}
          empty={<EmptyState icon={CalendarDays} title="Nothing booked" description="Appointments booked for this day appear here." />}
          columns={[
            {
              key: "time",
              header: "Time",
              cell: (a) => (
                <span className={cn("font-semibold tabular-nums", a.status === "cancelled" && "text-zinc-400 line-through")}>
                  {formatTime(a.startsAt, ctx.timezone)}
                </span>
              ),
            },
            {
              key: "patient",
              header: "Patient",
              cell: (a) => (
                <Link href={`/patients/${a.patientId}`} className="group block">
                  <span className="font-medium text-zinc-900 group-hover:underline dark:text-zinc-100">{a.patientName}</span>
                  <span className="block text-xs text-zinc-500">
                    {a.patientMrn}
                    {a.patientMobile ? ` · ${a.patientMobile}` : ""}
                  </span>
                </Link>
              ),
            },
            { key: "doctor", header: "Doctor", hideOnMobile: true, cell: (a) => a.doctorName },
            { key: "service", header: "Service", hideOnMobile: true, cell: (a) => a.serviceName ?? "—" },
            {
              key: "status",
              header: "Status",
              cell: (a) => <StatusBadge tone={appointmentTone(a.status)}>{a.status.replace("_", " ")}</StatusBadge>,
            },
            {
              key: "actions",
              header: "",
              align: "right",
              cell: (a) =>
                a.status === "booked" && (canManage || canCheckIn) ? (
                  <AppointmentRowActions
                    id={a.id}
                    patientName={a.patientName}
                    canCheckIn={canCheckIn && date === today}
                    canManage={canManage}
                    started={a.startsAt.getTime() <= Date.now()}
                    reschedule={a.status === "booked" && a.serviceId ? { doctorId: a.doctorId, serviceId: a.serviceId, date } : undefined}
                  />
                ) : null,
            },
          ]}
        />
      </Panel>
    </PageShell>
  );
}
