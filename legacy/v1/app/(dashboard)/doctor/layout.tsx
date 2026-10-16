import { requirePageRole } from "@/lib/auth/guards";

export default async function DoctorLayout({ children }: { children: React.ReactNode }) {
  await requirePageRole("doctor");
  return children;
}
