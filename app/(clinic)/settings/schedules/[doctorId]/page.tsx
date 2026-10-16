import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CalendarDays } from "lucide-react";
import { z } from "zod";
import { PageHeader, PageShell, Panel } from "@/components/app/page";
import { StatusBadge } from "@/components/app/status-badge";
import { formatDate } from "@/lib/format";
import { todayInTimeZone } from "@/lib/time";
import { bookedOn, listLeave } from "@/features/scheduling/booking.service";
import { AddLeaveForm, RemoveLeaveButton } from "./LeaveDays";
import { requireClinic } from "@/lib/auth/clinic-session";
import { withClinic } from "@/lib/db";
import { getDoctorSchedule, listDoctors } from "@/features/scheduling/schedules.service";
import { listServices } from "@/features/scheduling/services.service";
import ScheduleEditor from "./ScheduleEditor";

export const metadata = { title: "Edit schedule" };

export default async function DoctorSchedulePage({ params }: { params: Promise<{ doctorId: string }> }) {
  const ctx = await requireClinic({ permission: "settings:manage" });
  const { doctorId } = await params;
  if (!z.uuid().safeParse(doctorId).success) notFound();
  const today = todayInTimeZone(ctx.timezone);

  const data = await withClinic({ clinicId: ctx.clinicId, userId: ctx.userId }, async (tx) => {
    const doctor = (await listDoctors(tx, { activeOnly: false })).find((d) => d.id === doctorId);
    if (!doctor) return null;
    const [schedule, services, leave] = await Promise.all([
      getDoctorSchedule(tx, doctorId),
      listServices(tx, { activeOnly: true }),
      listLeave(tx, doctorId, today),
    ]);
    const clashes = await Promise.all(leave.map((l) => bookedOn(tx, doctorId, l.date, ctx.timezone)));
    return { doctor, schedule, services, leave: leave.map((l, i) => ({ ...l, booked: clashes[i] })) };
  });
  if (!data) notFound();

  const name = [data.doctor.title, data.doctor.firstName, data.doctor.lastName].filter(Boolean).join(" ");

  return (
    <PageShell width="default">
      <Link href="/settings/schedules" className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-white">
        <ArrowLeft className="h-4 w-4" /> All schedules
      </Link>
      <PageHeader
        icon={CalendarDays}
        eyebrow="Weekly schedule"
        title={name}
        description={`Working hours in clinic time (${ctx.timezone}). Add several windows on a day for split shifts.`}
      />
      <ScheduleEditor
        doctorId={doctorId}
        initialWindows={data.schedule.windows}
        initialServiceIds={data.schedule.serviceIds}
        services={data.services.map((s) => ({ id: s.id, name: s.name, durationMinutes: s.durationMinutes }))}
      />
      <Panel title="Leave days" description="No slots are offered on these days and nothing can be booked. Existing bookings are not cancelled for you.">
        <div className="space-y-5">
          {data.leave.length > 0 && (
            <ul className="divide-y divide-zinc-100 rounded-2xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
              {data.leave.map((l) => (
                <li key={l.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 text-sm">
                  <span>
                    <span className="font-medium text-zinc-900 dark:text-zinc-100">{formatDate(l.date, "UTC")}</span>
                    <span className="text-zinc-500"> · {l.reason}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    {l.booked > 0 && (
                      <Link href={`/appointments?date=${l.date}&doctor=${doctorId}`}>
                        <StatusBadge tone="warning">{l.booked} booked: move them</StatusBadge>
                      </Link>
                    )}
                    <RemoveLeaveButton id={l.id} date={l.date} />
                  </span>
                </li>
              ))}
            </ul>
          )}
          <AddLeaveForm doctorId={doctorId} today={today} />
        </div>
      </Panel>
    </PageShell>
  );
}
