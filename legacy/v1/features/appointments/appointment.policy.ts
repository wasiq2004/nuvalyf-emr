// Appointment status rules - pure, so they are shared by the service layer
// (enforcement) and the UI (which buttons to show), and unit tested.

export const APPOINTMENT_STATUSES = ["pending", "confirmed", "completed", "cancelled"] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

export type AppointmentActor = "patient" | "doctor";
export type AppointmentAction = "confirm" | "complete" | "cancel";

export const ACTION_TARGET_STATUS: Record<AppointmentAction, AppointmentStatus> = {
  confirm: "confirmed",
  complete: "completed",
  cancel: "cancelled",
};

const TRANSITIONS: Record<AppointmentStatus, AppointmentStatus[]> = {
  pending: ["confirmed", "cancelled"],
  confirmed: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

export function isAppointmentStatus(value: unknown): value is AppointmentStatus {
  return typeof value === "string" && (APPOINTMENT_STATUSES as readonly string[]).includes(value);
}

/**
 * Returns null when `actor` may perform `action`, otherwise a user-facing
 * reason. Ownership (is this *their* appointment?) is checked by the caller.
 */
export function checkAppointmentAction(input: {
  actor: AppointmentActor;
  action: AppointmentAction;
  status: AppointmentStatus;
  startsAt: Date;
  now: Date;
}): string | null {
  const { actor, action, status, startsAt, now } = input;
  const target = ACTION_TARGET_STATUS[action];
  const hasStarted = startsAt.getTime() <= now.getTime();

  if (!TRANSITIONS[status].includes(target)) {
    return `A ${status} appointment cannot be ${target}.`;
  }

  if (actor === "patient") {
    if (action !== "cancel") return "Only your doctor can update this appointment.";
    if (hasStarted) return "Past appointments can no longer be cancelled.";
    return null;
  }

  // doctor
  if (action === "confirm" && hasStarted) {
    return "This appointment time has already passed.";
  }
  if (action === "complete" && !hasStarted) {
    return "An appointment can only be completed once it has started.";
  }
  return null;
}

/** Actions to offer in the UI for an appointment. */
export function availableActions(input: {
  actor: AppointmentActor;
  status: AppointmentStatus;
  startsAt: Date;
  now: Date;
}): AppointmentAction[] {
  const actions: AppointmentAction[] = ["confirm", "complete", "cancel"];
  return actions.filter((action) => checkAppointmentAction({ ...input, action }) === null);
}
