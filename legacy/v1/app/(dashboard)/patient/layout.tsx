import { requirePageRole } from "@/lib/auth/guards";

export default async function PatientLayout({ children }: { children: React.ReactNode }) {
  await requirePageRole("patient");
  return children;
}
