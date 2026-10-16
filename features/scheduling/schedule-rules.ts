// Pure schedule validation (unit tested).
import { timeToMinutes } from "@/lib/time";

export type ScheduleWindow = { weekday: number; startTime: string; endTime: string };

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

/** Returns a user-facing message for the first problem found, or null. */
export function findOverlap(windows: ScheduleWindow[]): string | null {
  for (const w of windows) {
    if (timeToMinutes(w.endTime) <= timeToMinutes(w.startTime)) {
      return `${WEEKDAYS[w.weekday]}: the end time must be after the start time.`;
    }
  }

  const byDay = new Map<number, ScheduleWindow[]>();
  for (const w of windows) byDay.set(w.weekday, [...(byDay.get(w.weekday) ?? []), w]);

  for (const [day, list] of byDay) {
    const sorted = [...list].sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));
    for (let i = 1; i < sorted.length; i++) {
      if (timeToMinutes(sorted[i].startTime) < timeToMinutes(sorted[i - 1].endTime)) {
        return `${WEEKDAYS[day]}: ${sorted[i - 1].startTime}–${sorted[i - 1].endTime} overlaps ${sorted[i].startTime}–${sorted[i].endTime}.`;
      }
    }
  }
  return null;
}
