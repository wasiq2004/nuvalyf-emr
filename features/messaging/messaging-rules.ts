// Pure messaging rules (unit tested).
import { normalizeMobile } from "@/features/patients/patient-rules";

export const CONSENT_TYPES = ["whatsapp_reminders", "whatsapp_broadcasts"] as const;
export type ConsentType = (typeof CONSENT_TYPES)[number];

export const CONSENT_LABELS: Record<ConsentType, string> = {
  whatsapp_reminders: "WhatsApp appointment reminders",
  whatsapp_broadcasts: "WhatsApp clinic updates (broadcasts)",
};

/** WhatsApp wants the full international number, digits only. */
export function toWhatsAppNumber(mobile: string | null | undefined, countryCode = process.env.DEFAULT_COUNTRY_CODE ?? "91"): string | null {
  if (!mobile) return null;
  const raw = mobile.replace(/[^\d+]/g, "");
  if (raw.startsWith("+")) {
    const digits = raw.slice(1);
    return digits.length >= 8 && digits.length <= 15 ? digits : null;
  }
  const local = normalizeMobile(mobile);
  if (!local || local.length !== 10) return null;
  return `${countryCode}${local}`;
}

/** A reminder goes out once we are inside the window before the appointment. */
export function reminderDue(startsAt: Date, now: Date, hoursBefore: number): boolean {
  const opens = startsAt.getTime() - hoursBefore * 3_600_000;
  return now.getTime() >= opens && now.getTime() < startsAt.getTime();
}

export type Audience = { kind: "all" } | { kind: "seen_within_days"; days: number };

export function describeAudience(audience: Audience): string {
  return audience.kind === "all" ? "Every patient" : `Patients seen in the last ${audience.days} days`;
}

export const MAX_SEND_ATTEMPTS = 3;
