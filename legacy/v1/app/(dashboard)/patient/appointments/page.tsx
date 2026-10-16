import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ListPlus } from "lucide-react";
import { requirePageRole } from "@/lib/auth/guards";
import { CLINIC_TIMEZONE, MAX_BOOKING_DAYS_AHEAD } from "@/lib/config";
import { addDaysToDateString, todayInTimeZone } from "@/lib/time";
import { listPatientAppointments } from "@/features/appointments/appointment.service";
import { toAppointmentCards } from "@/features/appointments/appointment.view";
import { getBookableDoctors } from "@/features/doctors/doctor.service";
import { getDepartmentOptions } from "@/features/departments/department.service";
import { AppointmentList } from "@/components/appointments/appointment-list";
import BookAppointmentModal from "./BookAppointmentModal";

export default async function PatientAppointmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ book?: string }>;
}) {
  const user = await requirePageRole("patient");
  const { book } = await searchParams;
  const now = new Date();
  const today = todayInTimeZone(CLINIC_TIMEZONE, now);

  const [upcoming, past, doctors, departments] = await Promise.all([
    listPatientAppointments(user.id, "upcoming", now),
    listPatientAppointments(user.id, "past", now),
    getBookableDoctors(),
    getDepartmentOptions(),
  ]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-zinc-50 to-teal-50 dark:from-zinc-950 dark:via-zinc-900 dark:to-zinc-950 p-6 lg:p-10">
      <div className="max-w-7xl mx-auto space-y-10">
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6">
          <div className="flex items-start gap-5">
            <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-blue-600 to-teal-600 flex items-center justify-center shadow-lg flex-shrink-0">
              <ListPlus className="h-8 w-8 text-white" />
            </div>
            <div>
              <h1 className="text-4xl font-semibold tracking-tighter text-zinc-900 dark:text-white">
                My Appointments
              </h1>
              <p className="text-zinc-600 dark:text-zinc-400 mt-2 text-lg max-w-md">
                Manage your scheduled visits
              </p>
            </div>
          </div>

          <BookAppointmentModal
            doctors={doctors}
            departments={departments}
            minDate={today}
            maxDate={addDaysToDateString(today, MAX_BOOKING_DAYS_AHEAD)}
            defaultOpen={book === "true"}
          />
        </div>

        <Tabs defaultValue="upcoming" className="w-full">
          <TabsList className="grid w-full grid-cols-2 max-w-md">
            <TabsTrigger value="upcoming">Upcoming ({upcoming.length})</TabsTrigger>
            <TabsTrigger value="past">Past</TabsTrigger>
          </TabsList>

          <TabsContent value="upcoming" className="mt-6">
            <AppointmentList
              variant="patient"
              appointments={toAppointmentCards(upcoming, "patient", now)}
              emptyTitle="No upcoming appointments"
              emptyDescription="Book an appointment to get started."
            />
          </TabsContent>

          <TabsContent value="past" className="mt-6">
            <AppointmentList
              variant="patient"
              appointments={toAppointmentCards(past, "patient", now)}
              emptyTitle="No past appointments"
              emptyDescription="Your visit history will appear here."
            />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
