import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { HeartPlus, Clock, UserCircle, Plus } from "lucide-react";
import { requirePageRole } from "@/lib/auth/guards";
import {
  getPatientAnalytics,
  listPatientAppointments,
} from "@/features/appointments/appointment.service";
import { toAppointmentCards } from "@/features/appointments/appointment.view";
import { getPatientProfile } from "@/features/patients/patient.service";
import PatientDashboardClient from "./PatientDashboardClient";

export default async function PatientDashboard() {
  const user = await requirePageRole("patient");
  const now = new Date();

  const [upcoming, stats, profile] = await Promise.all([
    listPatientAppointments(user.id, "upcoming", now),
    getPatientAnalytics(user.id),
    getPatientProfile(user.id),
  ]);

  const nextAppointments = toAppointmentCards(
    upcoming.filter((a) => a.status !== "cancelled").slice(0, 2),
    "patient",
    now,
  );
  const profileComplete = Boolean(profile?.gender && profile?.contactNumber);
  const firstName = profile?.firstName || user.name?.split(" ")[0] || "there";

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-zinc-50 to-teal-50 dark:from-zinc-950 dark:via-zinc-900 dark:to-zinc-950 p-6 lg:p-10">
      <div className="max-w-7xl mx-auto space-y-10">
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6">
          <div className="flex items-start gap-5">
            <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-blue-600 to-teal-600 flex items-center justify-center shadow-lg flex-shrink-0">
              <HeartPlus className="h-8 w-8 text-white" />
            </div>
            <div>
              <h1 className="text-4xl font-semibold tracking-tighter text-zinc-900 dark:text-white">
                Welcome back, {firstName}
              </h1>
              <p className="text-zinc-600 dark:text-zinc-400 mt-2 text-lg max-w-md">
                Manage your health journey with MedFlow
              </p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <Card className="hover:shadow-lg transition-all border-teal-200 hover:border-teal-300">
            <CardHeader>
              <div className="flex items-center gap-3">
                <Plus className="h-8 w-8 text-blue-600" />
                <div>
                  <CardTitle className="text-xl">Book Appointment</CardTitle>
                  <CardDescription>Find a doctor and slot instantly</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <Button
                asChild
                size="lg"
                className="w-full text-zinc-100 h-12 px-8 rounded-2xl bg-gradient-to-r from-blue-600 to-teal-600 hover:from-blue-700 hover:to-teal-700 shadow-lg shadow-blue-500/25 transition-all"
              >
                <Link href="/patient/appointments?book=true">Start Booking</Link>
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-5 w-5" /> Upcoming
              </CardTitle>
              <Button variant="outline" size="sm" asChild>
                <Link href="/patient/appointments">View all</Link>
              </Button>
            </CardHeader>
            <CardContent>
              {nextAppointments.length > 0 ? (
                <div className="space-y-4">
                  {nextAppointments.map((apt) => (
                    <div key={apt.id} className="flex justify-between gap-4 text-sm">
                      <div>
                        <p className="font-medium">Dr. {apt.name}</p>
                        <p className="text-blue-600 text-xs">
                          {apt.dayLabel} {apt.monthLabel}
                        </p>
                      </div>
                      <div className="text-right text-xs text-muted-foreground">
                        <p>{apt.timeLabel}</p>
                        <p className="capitalize">{apt.status}</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-muted-foreground text-sm py-8 text-center">
                  No upcoming appointments yet
                </p>
              )}
            </CardContent>
          </Card>

          <Card className="hover:shadow-lg transition-all border-teal-200 hover:border-teal-300">
            <CardHeader>
              <div className="flex items-center gap-3">
                <UserCircle className="h-8 w-8 text-blue-600" />
                <div>
                  <CardTitle className="text-xl">My Profile</CardTitle>
                  <CardDescription>
                    {profileComplete
                      ? "Your contact details are up to date"
                      : "Add your gender and phone number"}
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <Button variant="outline" className="w-full" asChild>
                <Link href="/patient/profile">
                  {profileComplete ? "View Profile" : "Complete Profile"}
                </Link>
              </Button>
            </CardContent>
          </Card>
        </div>

        <PatientDashboardClient stats={stats} />
      </div>
    </div>
  );
}
