// Pure slot computation - no database access, so it is unit tested directly.
import {
  minutesToTime,
  normalizeTimeString,
  timeToMinutes,
  zonedTimeToUtc,
} from "@/lib/time";

export type AvailabilityWindow = { startTime: string; endTime: string };

export type Slot = {
  /** Clinic-local wall-clock start, "HH:mm". */
  time: string;
  /** The same moment as an ISO-8601 UTC instant. */
  startsAt: string;
};

/** Slot start times ("HH:mm") that fit entirely inside the working windows. */
export function generateSlotTimes(windows: AvailabilityWindow[], slotMinutes: number): string[] {
  const times = new Set<string>();

  for (const window of windows) {
    const start = timeToMinutes(normalizeTimeString(window.startTime));
    const end = timeToMinutes(normalizeTimeString(window.endTime));
    for (let t = start; t + slotMinutes <= end; t += slotMinutes) {
      times.add(minutesToTime(t));
    }
  }

  return [...times].sort();
}

/**
 * Bookable slots on a clinic-local date: inside working hours, not in the
 * past, and not already taken by an active (non-cancelled) appointment.
 */
export function computeAvailableSlots(input: {
  date: string;
  windows: AvailabilityWindow[];
  bookedStarts: Date[];
  now: Date;
  timeZone: string;
  slotMinutes: number;
}): Slot[] {
  const booked = new Set(input.bookedStarts.map((d) => d.getTime()));

  return generateSlotTimes(input.windows, input.slotMinutes)
    .map((time) => ({ time, instant: zonedTimeToUtc(input.date, time, input.timeZone) }))
    .filter(({ instant }) => instant.getTime() > input.now.getTime())
    .filter(({ instant }) => !booked.has(instant.getTime()))
    .map(({ time, instant }) => ({ time, startsAt: instant.toISOString() }));
}
