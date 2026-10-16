// Pure queue rules (unit tested).

export const VISIT_STATUSES = ["waiting", "in_triage", "ready", "with_doctor", "completed", "left", "cancelled"] as const;
export type VisitStatus = (typeof VISIT_STATUSES)[number];

/** Statuses that count as "still in the building and not yet seen". */
export const ACTIVE_STATUSES: readonly VisitStatus[] = ["waiting", "in_triage", "ready", "with_doctor"];

export type QueueEntry = {
  id: string;
  isEmergency: boolean;
  position: number;
  arrivedAt: Date;
};

/**
 * Emergencies first - by the FLAG, never by manual position, so reordering
 * cannot push someone carried in below a routine follow-up. Then manual
 * position, then arrival time.
 */
export function compareQueue(a: QueueEntry, b: QueueEntry): number {
  if (a.isEmergency !== b.isEmergency) return a.isEmergency ? -1 : 1;
  if (a.position !== b.position) return a.position - b.position;
  return a.arrivedAt.getTime() - b.arrivedAt.getTime();
}

export function sortQueue<T extends QueueEntry>(entries: T[]): T[] {
  return [...entries].sort(compareQueue);
}

/** Minutes waited so far (until called, if they have been). */
export function waitMinutes(entry: { arrivedAt: Date; calledAt?: Date | null }, now: Date): number {
  const end = entry.calledAt ?? now;
  return Math.max(0, Math.floor((end.getTime() - entry.arrivedAt.getTime()) / 60_000));
}
