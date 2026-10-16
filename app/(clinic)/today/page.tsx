import Link from "next/link";
import { AlertTriangle, CalendarClock, CalendarDays, CheckCircle2, HeartPulse, Home, ListOrdered, ShieldCheck, Stethoscope, Users } from "lucide-react";
import { ButtonLink } from "@/components/app/buttons";
import { EmptyState, PageHeader, PageShell, Panel, StatCard } from "@/components/app/page";
import { StatusBadge } from "@/components/app/status-badge";
import { AutoRefresh } from "@/components/app/auto-refresh";
import { QueueBoard } from "@/components/frontdesk/queue-board";
import { can, hasModule, requireClinic, type ClinicContext } from "@/lib/auth/clinic-session";
import { DoctorDay, NurseDay } from "@/components/clinical/clinical-day";
import { countSeenToday, listClinicalQueue } from "@/features/clinical/encounters.service";
import { listUnreadResults } from "@/features/clinical/lab.service";
import { listOpenQueriesFor } from "@/features/pharmacy/queries.service";
import { visitsToBill } from "@/features/billing/billing.service";
import { BillVisitButton } from "@/components/billing/billing-buttons";
import { withClinic } from "@/lib/db";
import { formatTime } from "@/lib/format";
import { todayInTimeZone } from "@/lib/time";
import { PERMISSIONS } from "@/lib/access/permissions";
import { listAppointmentsForDay } from "@/features/scheduling/booking.service";
import { listOpenTasks, listQueue } from "@/features/queue/queue.service";
import { AppointmentRowActions } from "../appointments/AppointmentActions";

export const metadata = { title: "Today" };

function greeting(timezone: string) {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: timezone }).format(new Date()));
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function AccessOverview({ ctx }: { ctx: ClinicContext }) {
  const grouped = new Map<string, string[]>();
  for (const permission of ctx.permissions) {
    const def = PERMISSIONS[permission];
    grouped.set(def.group, [...(grouped.get(def.group) ?? []), def.label]);
  }
  return (
    <Panel title="Your access" description="What your role lets you do in this clinic.">
      {grouped.size === 0 ? (
        <p className="text-sm text-zinc-500">No permissions are assigned to your account yet.</p>
      ) : (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {[...grouped.entries()].map(([group, labels]) => (
            <div key={group}>
              <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">{group}</p>
              <ul className="mt-2 space-y-1.5 text-sm text-zinc-700 dark:text-zinc-300">
                {labels.map((label) => (
                  <li key={label} className="flex items-start gap-2">
                    <ShieldCheck className="mt-0.5 h-4 w-4 flex-shrink-0 text-(--accent-text)" aria-hidden />
                    {label}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

export default async function TodayPage() {
  const ctx = await requireClinic();
  const today = todayInTimeZone(ctx.timezone);
  const now = new Date();
  const seesDay = can(ctx, "appointment:read") || can(ctx, "queue:read");

  // Doctors and nurses get their clinical worklist instead of the front desk.
  const isDoctor = can(ctx, ["encounter:write", "queue:call"]);
  const isNurse = !isDoctor && can(ctx, ["vitals:write", "queue:call"]);
  if (isDoctor || isNurse) {
    const showLab = isDoctor && hasModule(ctx, "lab") && can(ctx, "lab:order");
    const clinical = await withClinic({ clinicId: ctx.clinicId, userId: ctx.userId }, async (tx) => ({
      queue: await listClinicalQueue(tx, today),
      seenToday: isDoctor ? await countSeenToday(tx, ctx.userId, today) : 0,
      unread: showLab ? await listUnreadResults(tx, ctx.userId, today) : [],
      queries: isDoctor && hasModule(ctx, "pharmacy") && can(ctx, "prescription:sign") ? await listOpenQueriesFor(tx, ctx.userId) : [],
    }));
    return (
      <PageShell>
        <AutoRefresh seconds={30} />
        <PageHeader
          icon={isDoctor ? Stethoscope : HeartPulse}
          eyebrow={ctx.clinicName}
          title={`${greeting(ctx.timezone)}, ${ctx.firstName}`}
          description={isDoctor ? "Who is waiting for you, how long they have waited, and results to read." : "Patients waiting for triage, and who you have handed over."}
        />
        {isDoctor ? (
          <DoctorDay userId={ctx.userId} queue={clinical.queue} seenToday={clinical.seenToday} unread={clinical.unread} queries={clinical.queries} showLab={showLab} timezone={ctx.timezone} now={now} />
        ) : (
          <NurseDay queue={clinical.queue} now={now} />
        )}
      </PageShell>
    );
  }

  const data = seesDay
    ? await withClinic({ clinicId: ctx.clinicId, userId: ctx.userId }, async (tx) => ({
        appointments: can(ctx, "appointment:read") ? await listAppointmentsForDay(tx, { date: today, timeZone: ctx.timezone }) : [],
        queue: can(ctx, "queue:read") ? await listQueue(tx, today, { includeFinished: true }) : [],
        tasks: can(ctx, "patient:write") ? await listOpenTasks(tx) : [],
        toBill: can(ctx, "billing:manage") ? await visitsToBill(tx, today) : [],
      }))
    : null;

  const header = (
    <PageHeader
      icon={Home}
      eyebrow={ctx.clinicName}
      title={`${greeting(ctx.timezone)}, ${ctx.firstName}`}
      description={seesDay ? "Who is booked, who has arrived and what still needs doing, on one screen." : "Your day at a glance."}
    />
  );

  if (!data) {
    return (
      <PageShell>
        {header}
        <AccessOverview ctx={ctx} />
      </PageShell>
    );
  }

  const booked = data.appointments.filter((a) => a.status !== "cancelled");
  const toArrive = data.appointments.filter((a) => a.status === "booked");
  const activeQueue = data.queue.filter((q) => ["waiting", "in_triage", "ready", "with_doctor"].includes(q.status));
  const seen = data.queue.filter((q) => q.status === "completed");
  const urgent = data.tasks.filter((t) => t.priority === "urgent");

  return (
    <PageShell>
      <AutoRefresh seconds={60} />
      {header}

      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Booked today" value={booked.length} icon={CalendarDays} />
        <StatCard label="Still to arrive" value={toArrive.length} icon={CalendarClock} />
        <StatCard label="In the clinic now" value={activeQueue.length} icon={ListOrdered} hint={`${activeQueue.filter((q) => q.isEmergency).length} emergency`} />
        <StatCard label="Seen today" value={seen.length} icon={CheckCircle2} />
      </div>

      {urgent.length > 0 && (
        <Panel title="Urgent" description="Records left incomplete by an emergency admission come back here until they are whole.">
          <ul className="space-y-2">
            {urgent.map((task) => (
              <li
                key={task.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm dark:border-red-900 dark:bg-red-950/30"
              >
                <span className="flex items-center gap-2 font-medium text-red-800 dark:text-red-300">
                  <AlertTriangle className="h-4 w-4" /> {task.title}
                </span>
                {task.patientId && (
                  <ButtonLink href={`/patients/${task.patientId}`} variant="secondary" size="sm">
                    Complete record
                  </ButtonLink>
                )}
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {data.toBill.length > 0 && (
        <Panel
          flush
          title="To bill"
          description="Finished visits without an invoice."
          actions={
            <Link href="/billing" className="text-sm font-medium text-(--accent-text) hover:underline">
              Billing
            </Link>
          }
        >
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {data.toBill.slice(0, 6).map((v) => (
              <li key={v.visitId} className="flex flex-wrap items-center justify-between gap-3 px-6 py-3 lg:px-8">
                <span className="text-sm">
                  <span className="font-medium text-zinc-900 dark:text-zinc-100">{v.patientName}</span>
                  <span className="text-zinc-500">
                    {" "}
                    · {v.patientMrn}
                    {v.serviceName ? ` · ${v.serviceName}` : ""}
                  </span>
                </span>
                <BillVisitButton visitId={v.visitId} patientName={v.patientName} />
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <div className="grid gap-6 xl:grid-cols-2">
        {can(ctx, "queue:read") && (
          <Panel
            flush
            title="Queue now"
            actions={
              <Link href="/queue" className="text-sm font-medium text-(--accent-text) hover:underline">
                Open queue
              </Link>
            }
          >
            {activeQueue.length === 0 ? (
              <div className="p-6">
                <EmptyState icon={Users} title="Nobody waiting" />
              </div>
            ) : (
              <QueueBoard items={activeQueue.slice(0, 6)} now={now} linkPatients={can(ctx, "patient:read")} />
            )}
          </Panel>
        )}

        {can(ctx, "appointment:read") && (
          <Panel
            flush
            title="Still to arrive"
            actions={
              <Link href="/appointments" className="text-sm font-medium text-(--accent-text) hover:underline">
                All appointments
              </Link>
            }
          >
            {toArrive.length === 0 ? (
              <div className="p-6">
                <EmptyState icon={CalendarDays} title="Everyone booked today has arrived" />
              </div>
            ) : (
              <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {toArrive.slice(0, 8).map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 px-6 py-3 lg:px-8">
                    <div className="flex items-center gap-4">
                      <span className="w-16 font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
                        {formatTime(a.startsAt, ctx.timezone)}
                      </span>
                      <div>
                        <Link href={`/patients/${a.patientId}`} className="font-medium text-zinc-900 hover:underline dark:text-zinc-100">
                          {a.patientName}
                        </Link>
                        <p className="text-xs text-zinc-500">
                          {a.doctorName}
                          {a.serviceName ? ` · ${a.serviceName}` : ""}
                        </p>
                      </div>
                    </div>
                    {a.startsAt < now && <StatusBadge tone="warning">Late</StatusBadge>}
                    {(can(ctx, "queue:checkin") || can(ctx, "appointment:manage")) && (
                      <AppointmentRowActions
                        id={a.id}
                        patientName={a.patientName}
                        canCheckIn={can(ctx, "queue:checkin")}
                        canManage={can(ctx, "appointment:manage")}
                        started={a.startsAt <= now}
                      />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        )}
      </div>
    </PageShell>
  );
}
