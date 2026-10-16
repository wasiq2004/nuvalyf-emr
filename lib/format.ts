// Display formatting shared by every panel.
export const DEFAULT_LOCALE = process.env.APP_LOCALE || "en-IN";

/** Timezone for the operations console (platform staff are not tied to a clinic). */
export const PLATFORM_TIMEZONE = process.env.PLATFORM_TIMEZONE || "Asia/Kolkata";

export function formatDate(value: Date | string | null | undefined, timeZone: string): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString(DEFAULT_LOCALE, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone,
  });
}

export function formatDateTime(value: Date | string | null | undefined, timeZone: string): string {
  if (!value) return "—";
  return new Date(value).toLocaleString(DEFAULT_LOCALE, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  });
}

export function formatTime(value: Date | string | null | undefined, timeZone: string): string {
  if (!value) return "—";
  return new Date(value).toLocaleTimeString(DEFAULT_LOCALE, { hour: "numeric", minute: "2-digit", timeZone });
}

/** "5 min ago", "3 days ago". Server-rendered, so relative to request time. */
export function formatRelative(value: Date | string | null | undefined, now: Date = new Date()): string {
  if (!value) return "Never";
  const seconds = Math.round((now.getTime() - new Date(value).getTime()) / 1000);
  if (seconds < 60) return "Just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  const months = Math.round(days / 30);
  return `${months} month${months === 1 ? "" : "s"} ago`;
}

/** "CLINIC_ONBOARDED" -> "Clinic onboarded" */
export function humanizeAction(action: string): string {
  const words = action.toLowerCase().split("_");
  return words.map((word, i) => (i === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word)).join(" ");
}
