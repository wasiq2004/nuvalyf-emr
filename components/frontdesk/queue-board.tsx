// The queue as a list of rows. Server component; actions are passed in.
import Link from "next/link";
import { Phone, Siren } from "lucide-react";
import { StatusBadge } from "@/components/app/status-badge";
import { visitTone, VISIT_LABELS } from "@/components/frontdesk/status";
import { waitMinutes } from "@/features/queue/queue-rules";
import type { QueueItem } from "@/features/queue/queue.service";
import { cn } from "@/lib/utils";

const SEX_SHORT: Record<string, string> = { male: "M", female: "F", other: "O", unknown: "?" };

export function QueueBoard<T extends QueueItem>({
  items,
  now,
  linkPatients,
  renderActions,
}: {
  items: T[];
  now: Date;
  linkPatients: boolean;
  renderActions?: (item: T, index: number, routineIndex: number, routineCount: number) => React.ReactNode;
}) {
  const routine = items.filter((i) => !i.isEmergency && i.status === "waiting");

  return (
    <ol className="divide-y divide-zinc-100 dark:divide-zinc-800">
      {items.map((item, index) => {
        const waited = waitMinutes(item, now);
        const routineIndex = routine.findIndex((r) => r.id === item.id);
        return (
          <li
            key={item.id}
            className={cn(
              "flex flex-col gap-3 border-l-4 px-6 py-4 sm:flex-row sm:items-center lg:px-8",
              item.isEmergency ? "border-l-red-600 bg-red-50/60 dark:bg-red-950/20" : "border-l-transparent",
            )}
          >
            <div className="flex min-w-0 flex-1 items-center gap-4">
              <span
                className={cn(
                  "flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-sm font-bold tabular-nums",
                  item.isEmergency ? "bg-red-600 text-white" : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200",
                )}
                aria-label={`Position ${index + 1}`}
              >
                {index + 1}
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  {linkPatients ? (
                    <Link href={`/patients/${item.patientId}`} className="truncate font-semibold text-zinc-900 hover:underline dark:text-zinc-100">
                      {item.patientName}
                    </Link>
                  ) : (
                    <span className="truncate font-semibold text-zinc-900 dark:text-zinc-100">{item.patientName}</span>
                  )}
                  {item.isEmergency && (
                    <StatusBadge tone="danger">
                      <Siren className="h-3 w-3" /> Emergency
                    </StatusBadge>
                  )}
                  {item.isPlaceholder && <StatusBadge tone="warning">Record incomplete</StatusBadge>}
                </div>
                <p className="mt-0.5 text-xs text-zinc-500">
                  {item.patientMrn} · {item.patientAge ?? "—"} / {SEX_SHORT[item.patientSex] ?? "?"}
                  {item.doctorName ? ` · ${item.doctorName}` : " · Any doctor"}
                  {item.serviceName ? ` · ${item.serviceName}` : ""}
                  {item.appointmentId ? "" : " · Walk-in"}
                </p>
                {item.isEmergency && item.companionPhone && (
                  <p className="mt-1 flex items-center gap-1 text-xs font-medium text-red-700 dark:text-red-400">
                    <Phone className="h-3 w-3" /> Brought in by {item.companionPhone}
                  </p>
                )}
              </div>
            </div>

            <div className="flex flex-shrink-0 flex-wrap items-center gap-3 sm:justify-end">
              <StatusBadge tone={visitTone(item.status)}>{VISIT_LABELS[item.status] ?? item.status}</StatusBadge>
              <span
                className={cn(
                  "w-20 text-right text-sm tabular-nums",
                  waited >= 45 ? "font-semibold text-red-600" : waited >= 20 ? "text-amber-600" : "text-zinc-500",
                )}
                title={item.calledAt ? "Wait until called" : "Waiting so far"}
              >
                {waited} min
              </span>
              {renderActions?.(item, index, routineIndex, routine.length)}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
