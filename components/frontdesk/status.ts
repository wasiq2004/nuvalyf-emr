import type { BadgeTone } from "@/components/app/status-badge";

export const VISIT_LABELS: Record<string, string> = {
  waiting: "Waiting",
  in_triage: "In triage",
  ready: "Ready for doctor",
  with_doctor: "With doctor",
  completed: "Completed",
  left: "Left unseen",
  cancelled: "Cancelled",
};

export function visitTone(status: string): BadgeTone {
  switch (status) {
    case "waiting":
      return "warning";
    case "in_triage":
    case "ready":
      return "info";
    case "with_doctor":
      return "accent";
    case "completed":
      return "success";
    default:
      return "neutral";
  }
}

export function appointmentTone(status: string): BadgeTone {
  switch (status) {
    case "booked":
      return "info";
    case "checked_in":
      return "accent";
    case "completed":
      return "success";
    case "cancelled":
    case "no_show":
      return "neutral";
    default:
      return "neutral";
  }
}
