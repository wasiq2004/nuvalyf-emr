// Pure rules for scheduled drugs at the counter (unit tested).
// docs/PHARMACY_DESIGN.md 4.5. Drugs and Cosmetics Rules: Schedule H needs a
// prescription; H1 and X additionally go into a register with the patient's
// and prescriber's details (rule 65(9)).

export const SCHEDULES = ["none", "G", "H", "H1", "X"] as const;
export type Schedule = (typeof SCHEDULES)[number];

export const SCHEDULE_LABELS: Record<Schedule, string> = {
  none: "Not scheduled",
  G: "Schedule G",
  H: "Schedule H (prescription)",
  H1: "Schedule H1 (register)",
  X: "Schedule X (register)",
};

export function isSchedule(value: string): value is Schedule {
  return (SCHEDULES as readonly string[]).includes(value);
}

export type ScheduleDetails = {
  prescriberName?: string | null;
  prescriberRegNo?: string | null;
  patientName?: string | null;
  patientAddress?: string | null;
};

type Field = keyof ScheduleDetails;

const NEEDS: Record<Schedule, Field[]> = {
  none: [],
  G: [],
  H: ["prescriberName"],
  H1: ["prescriberName", "prescriberRegNo", "patientName", "patientAddress"],
  X: ["prescriberName", "prescriberRegNo", "patientName", "patientAddress"],
};

export const FIELD_LABELS: Record<Field, string> = {
  prescriberName: "prescribing doctor",
  prescriberRegNo: "doctor's registration number",
  patientName: "patient's name",
  patientAddress: "patient's address",
};

/** The details a sale must carry, given the schedules of its lines. */
export function requiredDetails(schedules: readonly string[]): Field[] {
  const fields = new Set<Field>();
  for (const s of schedules) if (isSchedule(s)) for (const f of NEEDS[s]) fields.add(f);
  return [...fields];
}

/** The missing details, as words for a message; empty when complete. */
export function missingDetails(schedules: readonly string[], details: ScheduleDetails): string[] {
  return requiredDetails(schedules)
    .filter((f) => !details[f]?.trim())
    .map((f) => FIELD_LABELS[f]);
}

/** Lines that belong in the H1 register. */
export function inRegister(schedule: string): boolean {
  return schedule === "H1" || schedule === "X";
}
