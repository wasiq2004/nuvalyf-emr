import Link from "next/link";
import { CalendarDays, Stethoscope } from "lucide-react";
import { ButtonLink } from "@/components/app/buttons";
import { EmptyState, PageHeader, PageShell, Panel } from "@/components/app/page";
import { DataTable } from "@/components/app/data-table";
import { StatusBadge } from "@/components/app/status-badge";
import { requireClinic } from "@/lib/auth/clinic-session";
import { withClinic } from "@/lib/db";
import { getDoctorSchedule, listDoctors } from "@/features/scheduling/schedules.service";
import { timeToMinutes } from "@/lib/time";

export const metadata = { title: "Schedules" };

const SHORT_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default async function SchedulesPage() {
  const ctx = await requireClinic({ permission: "settings:manage" });
  const doctors = await withClinic({ clinicId: ctx.clinicId, userId: ctx.userId }, async (tx) => {
    const list = await listDoctors(tx);
    return Promise.all(list.map(async (d) => ({ ...d, schedule: await getDoctorSchedule(tx, d.id) })));
  });

  return (
    <PageShell>
      <PageHeader
        icon={CalendarDays}
        eyebrow="Administration"
        title="Schedules"
        description={`Each doctor's recurring weekly hours, in clinic time (${ctx.timezone}). The calendar derives bookable slots from these.`}
      />

      <Panel flush>
        <DataTable
          rows={doctors}
          rowKey={(d) => d.id}
          empty={
            <EmptyState
              icon={Stethoscope}
              title="No doctors yet"
              description="Give a staff member the Doctor role to set up their schedule."
              action={<ButtonLink href="/settings/users" variant="secondary">Go to staff</ButtonLink>}
            />
          }
          columns={[
            {
              key: "doctor",
              header: "Doctor",
              cell: (d) => (
                <Link href={`/settings/schedules/${d.id}`} className="group block">
                  <span className="font-semibold text-zinc-900 group-hover:underline dark:text-zinc-100">
                    {[d.title, d.firstName, d.lastName].filter(Boolean).join(" ")}
                  </span>
                  <span className="block text-xs text-zinc-500">{d.specialty ?? "No specialty set"}</span>
                </Link>
              ),
            },
            {
              key: "days",
              header: "Working days",
              cell: (d) => {
                const days = new Set(d.schedule.windows.map((w) => w.weekday));
                return days.size === 0 ? (
                  <StatusBadge tone="warning">No hours set</StatusBadge>
                ) : (
                  <div className="flex gap-1">
                    {SHORT_DAYS.map((label, i) => (
                      <span
                        key={label}
                        className={
                          days.has(i)
                            ? "rounded-md bg-(--accent-soft) px-1.5 py-0.5 text-[11px] font-semibold text-(--accent-text)"
                            : "rounded-md px-1.5 py-0.5 text-[11px] text-zinc-400"
                        }
                      >
                        {label}
                      </span>
                    ))}
                  </div>
                );
              },
            },
            {
              key: "hours",
              header: "Hours / week",
              hideOnMobile: true,
              cell: (d) => {
                const minutes = d.schedule.windows.reduce((sum, w) => sum + timeToMinutes(w.endTime) - timeToMinutes(w.startTime), 0);
                return `${Math.round((minutes / 60) * 10) / 10} h`;
              },
            },
            {
              key: "services",
              header: "Services",
              hideOnMobile: true,
              cell: (d) => (d.schedule.serviceIds.length === 0 ? "All" : `${d.schedule.serviceIds.length} selected`),
            },
            {
              key: "edit",
              header: "",
              align: "right",
              cell: (d) => (
                <ButtonLink href={`/settings/schedules/${d.id}`} variant="secondary" size="sm">
                  Edit
                </ButtonLink>
              ),
            },
          ]}
        />
      </Panel>
    </PageShell>
  );
}
