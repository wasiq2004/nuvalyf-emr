// Pure slot computation - no database access, so it is unit tested directly.
import { minutesToTime, normalizeTimeString, timeToMinutes, zonedTimeToUtc } from "@/lib/time";

export type AvailabilityWindow = { startTime: string; endTime: string };

export type Slot = {
  /** Clinic-local wall-clock start, "HH:mm". */
  time: string;
  /** The same moment as an ISO-8601 UTC instant. */
  startsAt: string;
  /** End of the booking (start + service duration), ISO-8601. */
  endsAt: string;
};

export type BusyRange = { start: Date; end: Date };

/**
 * Start times on the clinic's slot grid where a booking of `durationMinutes`
 * fits entirely inside one working window (split shifts are separate windows).
 */
export function generateStartTimes(windows: AvailabilityWindow[], gridMinutes: number, durationMinutes: number): string[] {
  const times = new Set<string>();
  for (const window of windows) {
    const start = timeToMinutes(normalizeTimeString(window.startTime));
    const end = timeToMinutes(normalizeTimeString(window.endTime));
    for (let t = start; t + durationMinutes <= end; t += gridMinutes) {
      times.add(minutesToTime(t));
    }
  }
  return [...times].sort();
}

/**
 * Bookable slots on a clinic-local date: on the grid, inside working hours,
 * not in the past, and not overlapping any busy range (existing bookings).
 */
export function computeAvailableSlots(input: {
  date: string;
  windows: AvailabilityWindow[];
  busy: BusyRange[];
  now: Date;
  timeZone: string;
  gridMinutes: number;
  durationMinutes: number;
}): Slot[] {
  const durationMs = input.durationMinutes * 60_000;

  return generateStartTimes(input.windows, input.gridMinutes, input.durationMinutes)
    .map((time) => {
      const start = zonedTimeToUtc(input.date, time, input.timeZone);
      return { time, start, end: new Date(start.getTime() + durationMs) };
    })
    .filter(({ start }) => start.getTime() > input.now.getTime())
    .filter(({ start, end }) => !input.busy.some((b) => start < b.end && b.start < end))
    .map(({ time, start, end }) => ({ time, startsAt: start.toISOString(), endsAt: end.toISOString() }));
}
