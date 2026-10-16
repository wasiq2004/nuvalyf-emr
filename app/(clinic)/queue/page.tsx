import { ListOrdered, Siren, Timer, Users } from "lucide-react";
import { ButtonLink } from "@/components/app/buttons";
import { EmptyState, PageHeader, PageShell, Panel, StatCard } from "@/components/app/page";
import { AutoRefresh } from "@/components/app/auto-refresh";
import { QueueBoard } from "@/components/frontdesk/queue-board";
import { can, requireClinic } from "@/lib/auth/clinic-session";
import { withClinic } from "@/lib/db";
import { todayInTimeZone } from "@/lib/time";
import { listClinicalQueue, type ClinicalQueueItem } from "@/features/clinical/encounters.service";
import { CallPatientButton, StartTriageButton } from "@/components/clinical/clinical-buttons";
import { waitMinutes } from "@/features/queue/queue-rules";
import { QueueRowActions } from "./QueueActions";

export const metadata = { title: "Queue" };

export default async function QueuePage() {
  const ctx = await requireClinic({ permission: "queue:read" });
  const today = todayInTimeZone(ctx.timezone);
  const now = new Date();
  const queue = await withClinic({ clinicId: ctx.clinicId, userId: ctx.userId }, (tx) => listClinicalQueue(tx, today));

  const waiting = queue.filter((q) => q.status === "waiting");
  const longest = waiting.reduce((max, q) => Math.max(max, waitMinutes(q, now)), 0);
  const canManage = can(ctx, "queue:checkin");
  const isDoctor = can(ctx, ["queue:call", "encounter:write"]);
  const isNurse = !isDoctor && can(ctx, ["queue:call", "vitals:write"]);
  const canOpen = can(ctx, "encounter:read");

  function clinicalAction(item: ClinicalQueueItem) {
    if (isDoctor && ["waiting", "ready"].includes(item.status) && (item.doctorId === null || item.doctorId === ctx.userId)) {
      return <CallPatientButton visitId={item.id} patientName={item.patientName} />;
    }
    if (isNurse && item.status === "waiting") {
      return <StartTriageButton visitId={item.id} patientName={item.patientName} />;
    }
    if (canOpen && item.encounterId) {
      return (
        <ButtonLink href={`/encounters/${item.encounterId}`} variant="secondary" size="sm">
          Open
        </ButtonLink>
      );
    }
    return null;
  }

  return (
    <PageShell>
      <AutoRefresh seconds={30} />
      <PageHeader
        icon={ListOrdered}
        title="Today's queue"
        description="Emergencies always sit at the top. Everyone else is in order of check-in unless moved."
        actions={
          can(ctx, "patient:read") && canManage ? (
            <ButtonLink href="/patients" variant="secondary">
              Add a walk-in
            </ButtonLink>
          ) : undefined
        }
      />

      <div className="grid gap-5 sm:grid-cols-3">
        <StatCard label="In the queue" value={queue.length} icon={Users} />
        <StatCard label="Emergencies" value={queue.filter((q) => q.isEmergency).length} icon={Siren} />
        <StatCard label="Longest wait" value={`${longest} min`} icon={Timer} hint={`${waiting.length} waiting`} />
      </div>

      <Panel flush title="Queue" description="Refreshes every 30 seconds.">
        {queue.length === 0 ? (
          <div className="p-6 lg:p-8">
            <EmptyState icon={ListOrdered} title="Nobody waiting" description="Checked-in patients and walk-ins appear here." />
          </div>
        ) : (
          <QueueBoard
            items={queue}
            now={now}
            linkPatients={can(ctx, "patient:read")}
            renderActions={(item, _index, routineIndex, routineCount) => (
              <>
                {clinicalAction(item)}
                {canManage && (
                  <QueueRowActions
                    visitId={item.id}
                    patientName={item.patientName}
                    canMoveUp={routineIndex > 0}
                    canMoveDown={routineIndex >= 0 && routineIndex < routineCount - 1}
                    canMarkLeft={item.status === "waiting" || item.status === "ready"}
                  />
                )}
              </>
            )}
          />
        )}
      </Panel>
    </PageShell>
  );
}
