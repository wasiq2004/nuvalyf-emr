import type {
  AppointmentAction,
  AppointmentStatus,
} from "@/features/appointments/appointment.policy";

/** Serializable appointment data passed from server pages to client lists. */
export type AppointmentCardData = {
  id: string;
  dayLabel: string;
  monthLabel: string;
  timeLabel: string;
  fullLabel: string;
  status: AppointmentStatus;
  notes: string | null;
  /** The other party: the doctor for patients, the patient for doctors. */
  name: string;
  email: string | null;
  department: string | null;
  actions: AppointmentAction[];
};
