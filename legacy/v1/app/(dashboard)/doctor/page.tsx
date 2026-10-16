import { LayoutDashboard } from "lucide-react";
import { requirePageRole } from "@/lib/auth/guards";
import { getDoctorAnalytics } from "@/features/appointments/appointment.service";
import DoctorDashboardClient from "./DoctorDashboardClient";

export default async function DoctorPage() {
  const user = await requirePageRole("doctor");
  const stats = await getDoctorAnalytics(user.id);
  const lastName = user.name?.split(" ").slice(-1)[0];

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-zinc-50 to-teal-50 dark:from-zinc-950 dark:via-zinc-900 dark:to-zinc-950 p-6 lg:p-10">
      <div className="max-w-7xl mx-auto space-y-10">
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6">
          <div className="flex items-start gap-5">
            <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-blue-600 to-teal-600 flex items-center justify-center shadow-lg flex-shrink-0">
              <LayoutDashboard className="h-8 w-8 text-white" />
            </div>
            <div>
              <h1 className="text-4xl font-semibold tracking-tighter text-zinc-900 dark:text-white">
                Dashboard Overview
              </h1>
              <p className="text-zinc-600 dark:text-zinc-400 mt-2 text-lg max-w-md">
                Welcome back{lastName ? `, Dr. ${lastName}` : ""}. Here is what&apos;s happening.
              </p>
            </div>
          </div>
        </div>

        <DoctorDashboardClient stats={stats} />
      </div>
    </div>
  );
}
