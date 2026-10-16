import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { AppSidebar } from "@/components/layout/sidebar";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/login");
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <AppSidebar
        role={session.user.role}
        userName={session.user.name || session.user.email}
      />
      <div className="flex flex-1 flex-col overflow-hidden">
        <main className="flex-1 overflow-auto pt-16 md:pt-0">{children}</main>
      </div>
    </div>
  );
}
