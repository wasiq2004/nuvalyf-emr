import { UserCircle } from "lucide-react";
import { requirePageRole } from "@/lib/auth/guards";
import { getPatientProfile } from "@/features/patients/patient.service";
import ProfileForm from "./ProfileForm";

export default async function PatientProfilePage() {
  const user = await requirePageRole("patient");
  const profile = await getPatientProfile(user.id);

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-zinc-50 to-teal-50 dark:from-zinc-950 dark:via-zinc-900 dark:to-zinc-950 p-6 lg:p-10">
      <div className="max-w-3xl mx-auto space-y-10">
        <div className="flex items-start gap-5">
          <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-blue-600 to-teal-600 flex items-center justify-center shadow-lg flex-shrink-0">
            <UserCircle className="h-8 w-8 text-white" />
          </div>
          <div>
            <h1 className="text-4xl font-semibold tracking-tighter text-zinc-900 dark:text-white">
              My Profile
            </h1>
            <p className="text-zinc-600 dark:text-zinc-400 mt-2 text-lg max-w-md">
              Keep your contact details up to date so your care team can reach you.
            </p>
          </div>
        </div>

        <ProfileForm
          email={profile?.email ?? user.email}
          initial={{
            first_name: profile?.firstName ?? "",
            last_name: profile?.lastName ?? "",
            gender: profile?.gender ?? "",
            contact_number: profile?.contactNumber ?? "",
            address: profile?.address ?? "",
          }}
        />
      </div>
    </div>
  );
}
