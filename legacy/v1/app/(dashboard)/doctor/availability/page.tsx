import { AlertCircle } from "lucide-react";
import { requirePageRole } from "@/lib/auth/guards";
import { AppError } from "@/lib/errors";
import { getDoctorAvailability } from "@/features/doctors/doctor-availability.service";
import AvailabilityEditor from "./AvailabilityEditor";

export default async function DoctorAvailabilityPage() {
  const user = await requirePageRole("doctor");

  let slots;
  try {
    ({ slots } = await getDoctorAvailability(user.id));
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    return (
      <div className="p-6 lg:p-10">
        <div className="max-w-xl mx-auto mt-20 rounded-3xl border border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30 p-8 text-center">
          <AlertCircle className="mx-auto h-10 w-10 text-amber-600" />
          <p className="mt-4 text-amber-800 dark:text-amber-300">{error.message}</p>
        </div>
      </div>
    );
  }

  return <AvailabilityEditor initialSlots={slots} />;
}
