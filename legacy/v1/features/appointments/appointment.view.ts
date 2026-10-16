import "server-only";

import { APP_LOCALE, CLINIC_TIMEZONE } from "@/lib/config";
import { formatInTimeZone } from "@/lib/time";
import { availableActions, type AppointmentActor } from "./appointment.policy";
import type { AppointmentListItem } from "./appointment.service";
import type { AppointmentCardData } from "@/components/appointments/types";

/**
 * Turns appointment rows into display data. Dates are formatted on the server
 * in the clinic timezone so every user sees the same wall-clock time and the
 * markup is identical between server render and hydration.
 */
export function toAppointmentCards(
  items: AppointmentListItem[],
  actor: AppointmentActor,
  now: Date = new Date(),
): AppointmentCardData[] {
  const fmt = (date: Date, options: Intl.DateTimeFormatOptions) =>
    formatInTimeZone(date, CLINIC_TIMEZONE, options, APP_LOCALE);

  return items.map((item) => ({
    id: item.id,
    dayLabel: fmt(item.startsAt, { day: "numeric" }),
    monthLabel: fmt(item.startsAt, { month: "short" }),
    timeLabel: fmt(item.startsAt, { hour: "numeric", minute: "2-digit" }),
    fullLabel: fmt(item.startsAt, {
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }),
    status: item.status,
    notes: item.notes,
    name: item.counterpartName,
    email: item.counterpartEmail,
    department: item.department,
    actions: availableActions({ actor, status: item.status, startsAt: item.startsAt, now }),
  }));
}
