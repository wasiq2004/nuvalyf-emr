// The clinical home screens: the doctor's worklist and the nurse's triage
// list. Server components built on the shared queue board.
import { CheckCircle2, FlaskConical, HeartPulse, ListOrdered, Stethoscope, Timer, Users } from "lucide-react";
import { ButtonLink } from "@/components/app/buttons";
import { EmptyState, Panel, StatCard } from "@/components/app/page";
import { StatusBadge } from "@/components/app/status-badge";
import { QueueBoard } from "@/components/frontdesk/queue-board";
import { CallNextButton, CallPatientButton, MarkReadButton, StartTriageButton } from "@/components/clinical/clinical-buttons";
import type { ClinicalQueueItem } from "@/features/clinical/encounters.service";
import type { UnreadResult } from "@/features/clinical/lab.service";
import type { OpenQuery } from "@/features/pharmacy/queries.service";
import { AnswerQueryForm } from "@/components/clinical/answer-query";
import { waitMinutes } from "@/features/queue/queue-rules";
import { formatTime } from "@/lib/format";

function OpenButton({ encounterId, label = "Open" }: { encounterId: string | null; label?: string }) {
  if (!encounterId) return null;
  return (
    <ButtonLink href={`/encounters/${encounterId}`} variant="secondary" size="sm">
      {label}
    </ButtonLink>
  );
}

const longestWait = (items: ClinicalQueueItem[], now: Date) => items.reduce((max, q) => Math.max(max, waitMinutes(q, now)), 0);

export function DoctorDay({
  userId,
  queue,
  seenToday,
  unread,
  queries,
  showLab,
  timezone,
  now,
}: {
  userId: string;
  queue: ClinicalQueueItem[];
  seenToday: number;
  unread: UnreadResult[];
  queries: OpenQuery[];
  showLab: boolean;
  timezone: string;
  now: Date;
}) {
  const withMe = queue.filter((q) => q.status === "with_doctor" && q.doctorId === userId);
  const mine = queue.filter((q) => ["waiting", "in_triage", "ready"].includes(q.status) && (q.doctorId === null || q.doctorId === userId));
  const ready = mine.filter((q) => q.status === "ready");

  return (
    <>
      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Waiting for you" value={mine.length} icon={Users} hint={`${mine.filter((q) => q.isEmergency).length} emergency`} />
        <StatCard label="Ready (triaged)" value={ready.length} icon={HeartPulse} />
        <StatCard label="Longest wait" value={`${longestWait(mine, now)} min`} icon={Timer} />
        <StatCard label="Seen by you today" value={seenToday} icon={CheckCircle2} />
      </div>

      {queries.length > 0 && (
        <Panel title="Pharmacy questions" description="The pharmacist is waiting on your answer before dispensing.">
          <ul className="space-y-4">
            {queries.map((q) => (
              <li key={q.id} className="rounded-xl border border-(--accent-soft-border) bg-(--accent-soft) p-4">
                <p className="text-sm text-zinc-900 dark:text-zinc-100">
                  {q.itemName ? <span className="font-semibold">{q.itemName}: </span> : null}
                  {q.message}
                </p>
                <p className="mt-1 text-xs text-zinc-500">
                  {q.patientName} · {q.patientMrn} · {q.raisedByName}, {formatTime(q.raisedAt, timezone)} ·{" "}
                  <a href={`/encounters/${q.encounterId}`} className="font-medium text-(--accent-text) hover:underline">
                    consultation
                  </a>
                </p>
                <div className="mt-3">
                  <AnswerQueryForm id={q.id} />
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {withMe.length > 0 && (
        <Panel title="With you now">
          <ul className="space-y-2">
            {withMe.map((q) => (
              <li key={q.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-(--accent-soft-border) bg-(--accent-soft) px-4 py-3">
                <span className="text-sm">
                  <span className="font-semibold text-zinc-900 dark:text-zinc-100">{q.patientName}</span>
                  <span className="text-zinc-500">
                    {" "}
                    · {q.patientMrn} · called {formatTime(q.calledAt, timezone)}
                  </span>
                </span>
                <OpenButton encounterId={q.encounterId} label="Continue consultation" />
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <div className="grid gap-6 xl:grid-cols-3">
        <div className={showLab ? "xl:col-span-2" : "xl:col-span-3"}>
          <Panel
            flush
            title="Your queue"
            description="Emergencies first, then patients the nurse has made ready, then everyone still waiting."
            actions={mine.length > 0 ? <CallNextButton /> : undefined}
          >
            {mine.length === 0 ? (
              <div className="p-6 lg:p-8">
                <EmptyState icon={ListOrdered} title="Nobody waiting for you" description="Patients booked with you, and walk-ins for any doctor, appear here." />
              </div>
            ) : (
              <QueueBoard
                items={mine}
                now={now}
                linkPatients
                renderActions={(item) =>
                  // In triage: the status badge already says so; the nurse hands over when ready.
                  item.status === "in_triage" ? null : <CallPatientButton visitId={item.id} patientName={item.patientName} />
                }
              />
            )}
          </Panel>
        </div>

        {showLab && (
          <Panel title="Unread results" description="Stay here until you mark them read.">
            {unread.length === 0 ? (
              <EmptyState icon={FlaskConical} title="Nothing new" />
            ) : (
              <ul className="space-y-3">
                {unread.map((r) => (
                  <li
                    key={r.id}
                    className={
                      r.resultFlag === "critical"
                        ? "rounded-xl border border-red-200 bg-red-50 p-3 dark:border-red-900 dark:bg-red-950/30"
                        : "rounded-xl border border-zinc-200 p-3 dark:border-zinc-800"
                    }
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{r.testName}</p>
                        <p className="text-xs text-zinc-500">
                          {r.patientName} · {r.patientMrn}
                        </p>
                      </div>
                      {r.resultFlag && (
                        <StatusBadge tone={r.resultFlag === "critical" ? "danger" : r.resultFlag === "abnormal" ? "warning" : "success"}>
                          {r.resultFlag}
                        </StatusBadge>
                      )}
                    </div>
                    <p className="mt-2 text-sm text-zinc-800 dark:text-zinc-200">
                      <span className="font-semibold">{r.resultValue}</span>
                      {r.unit ? ` ${r.unit}` : ""}
                      {r.referenceRange ? <span className="text-zinc-500"> (ref {r.referenceRange})</span> : null}
                    </p>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <OpenButton encounterId={r.encounterId} label="Open consultation" />
                      <MarkReadButton id={r.id} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        )}
      </div>
    </>
  );
}

export function NurseDay({ queue, now }: { queue: ClinicalQueueItem[]; now: Date }) {
  const toTriage = queue.filter((q) => q.status === "waiting" || q.status === "in_triage");
  const ready = queue.filter((q) => q.status === "ready");
  const withDoctor = queue.filter((q) => q.status === "with_doctor");

  return (
    <>
      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Waiting for triage" value={queue.filter((q) => q.status === "waiting").length} icon={Users} />
        <StatCard label="In triage" value={queue.filter((q) => q.status === "in_triage").length} icon={Stethoscope} />
        <StatCard label="Ready for doctor" value={ready.length} icon={HeartPulse} />
        <StatCard label="Longest wait" value={`${longestWait(toTriage, now)} min`} icon={Timer} />
      </div>

      <Panel flush title="Triage" description="Pick a patient up, record vitals and allergies, then hand over as ready.">
        {toTriage.length === 0 ? (
          <div className="p-6 lg:p-8">
            <EmptyState icon={ListOrdered} title="Nobody waiting for triage" />
          </div>
        ) : (
          <QueueBoard
            items={toTriage}
            now={now}
            linkPatients
            renderActions={(item) =>
              item.status === "in_triage" ? (
                <OpenButton encounterId={item.encounterId} label="Continue" />
              ) : (
                <StartTriageButton visitId={item.id} patientName={item.patientName} />
              )
            }
          />
        )}
      </Panel>

      {(ready.length > 0 || withDoctor.length > 0) && (
        <Panel flush title="Handed over">
          <QueueBoard items={[...ready, ...withDoctor]} now={now} linkPatients renderActions={(item) => <OpenButton encounterId={item.encounterId} />} />
        </Panel>
      )}
    </>
  );
}
