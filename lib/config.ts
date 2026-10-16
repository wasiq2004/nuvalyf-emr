import { isValidTimeZone } from "@/lib/time";

function readTimeZone(): string {
  const value = process.env.CLINIC_TIMEZONE || "Asia/Kolkata";
  if (!isValidTimeZone(value)) {
    throw new Error(`CLINIC_TIMEZONE "${value}" is not a valid IANA timezone`);
  }
  return value;
}

/**
 * IANA timezone the clinic operates in. Doctor working hours are interpreted
 * in this zone and every date/time shown in the UI is rendered in it.
 */
export const CLINIC_TIMEZONE = readTimeZone();

/** Locale used for user-facing date formatting. */
export const APP_LOCALE = process.env.APP_LOCALE || "en-IN";

/** Length of a bookable consultation slot. */
export const SLOT_MINUTES = 30;

/** How far ahead patients may book. */
export const MAX_BOOKING_DAYS_AHEAD = 90;
