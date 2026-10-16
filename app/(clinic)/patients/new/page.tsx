import { UserPlus } from "lucide-react";
import { PageHeader, PageShell } from "@/components/app/page";
import { requireClinic } from "@/lib/auth/clinic-session";
import RegisterPatientFlow from "./RegisterPatientFlow";

export const metadata = { title: "Register patient" };

export default async function NewPatientPage() {
  await requireClinic({ permission: "patient:write" });
  return (
    <PageShell width="default">
      <PageHeader
        icon={UserPlus}
        title="Register a patient"
        description="Search first: duplicate records are the most common mistake at a busy desk, so registration only opens once a search has run on these details."
      />
      <RegisterPatientFlow />
    </PageShell>
  );
}
