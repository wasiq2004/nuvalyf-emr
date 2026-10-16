import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ListPlus } from "lucide-react";
import { requirePageRole } from "@/lib/auth/guards";
import { listDoctorAppointments } from "@/features/appointments/appointment.service";
import { toAppointmentCards } from "@/features/appointments/appointment.view";
import { AppointmentList } from "@/components/appointments/appointment-list";

export default async function DoctorAppointmentsPage() {
  const user = await requirePageRole("doctor");
  const now = new Date();

  const [upcoming, past] = await Promise.all([
    listDoctorAppointments(user.id, "upcoming", now),
    listDoctorAppointments(user.id, "past", now),
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
                Confirm new bookings and close out completed visits
              </p>
            </div>
          </div>
        </div>

        <Tabs defaultValue="upcoming" className="w-full">
          <TabsList className="grid w-full grid-cols-2 max-w-md">
            <TabsTrigger value="upcoming">Upcoming ({upcoming.length})</TabsTrigger>
            <TabsTrigger value="past">Past</TabsTrigger>
          </TabsList>

          <TabsContent value="upcoming" className="mt-6">
            <AppointmentList
              variant="doctor"
              appointments={toAppointmentCards(upcoming, "doctor", now)}
              emptyTitle="No upcoming appointments"
              emptyDescription="Your schedule is clear for now."
            />
          </TabsContent>

          <TabsContent value="past" className="mt-6">
            <AppointmentList
              variant="doctor"
              appointments={toAppointmentCards(past, "doctor", now)}
              emptyTitle="No past appointments"
              emptyDescription="Completed and missed visits will appear here."
            />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
