// Timezone-aware date helpers. Pure functions with no server-only imports, so
// they can be shared by services, scripts and tests.
//
// Conventions:
//   - "date string" = clinic-local calendar date, "YYYY-MM-DD"
//   - "time string" = clinic-local wall-clock time, "HH:mm"
//   - instants are JS Date objects (UTC under the hood) and are what we store.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

export function isValidDateString(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
  );
}

export function isValidTimeString(value: string): boolean {
  return TIME_RE.test(value);
}

/** Normalizes "9:00" / "09:00:00" to "09:00". */
export function normalizeTimeString(value: string): string {
  const [h = "0", m = "0"] = String(value).split(":");
  return `${h.padStart(2, "0")}:${m.padStart(2, "0")}`;
}

export function timeToMinutes(value: string): number {
  const [h, m] = normalizeTimeString(value).split(":").map(Number);
  return h * 60 + m;
}

export function minutesToTime(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Day of week (0 = Sunday) of a calendar date, independent of any timezone. */
export function dayOfWeekFromDateString(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function addDaysToDateString(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return date.toISOString().slice(0, 10);
}

function zonedParts(instant: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value);

  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

/** Offset of `timeZone` from UTC at `instant`, in milliseconds. */
export function getTimeZoneOffsetMs(instant: Date, timeZone: string): number {
  const p = zonedParts(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  const truncated = Math.floor(instant.getTime() / 1000) * 1000;
  return asUtc - truncated;
}

/**
 * Converts a clinic-local wall-clock date + time into the matching UTC instant.
 * Handles DST by re-checking the offset at the candidate instant.
 */
export function zonedTimeToUtc(dateStr: string, timeStr: string, timeZone: string): Date {
  const [y, mo, d] = dateStr.split("-").map(Number);
  const [h, mi] = normalizeTimeString(timeStr).split(":").map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);

  const firstOffset = getTimeZoneOffsetMs(new Date(guess), timeZone);
  let result = guess - firstOffset;
  const secondOffset = getTimeZoneOffsetMs(new Date(result), timeZone);
  if (secondOffset !== firstOffset) {
    result = guess - secondOffset;
  }
  return new Date(result);
}

/** Clinic-local calendar date and wall-clock time of an instant. */
export function toZonedDateTime(instant: Date, timeZone: string): { date: string; time: string } {
  const p = zonedParts(instant, timeZone);
  const date = `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
  const time = `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
  return { date, time };
}

export function todayInTimeZone(timeZone: string, now: Date = new Date()): string {
  return toZonedDateTime(now, timeZone).date;
}

/** Short weekday label ("Mon") for a calendar date. */
export function weekdayLabel(dateStr: string, locale = "en-US"): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString(locale, {
    weekday: "short",
    timeZone: "UTC",
  });
}

export function formatInTimeZone(
  instant: Date | string,
  timeZone: string,
  options: Intl.DateTimeFormatOptions,
  locale = "en-IN",
): string {
  const date = typeof instant === "string" ? new Date(instant) : instant;
  return date.toLocaleString(locale, { ...options, timeZone });
}
