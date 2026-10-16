import { AppShell } from "@/components/app/app-shell";
import { EmergencyButton } from "@/components/frontdesk/emergency-button";
import { can, requireClinic } from "@/lib/auth/clinic-session";
import { clinicNav } from "@/lib/navigation";
import { clinicSignOutAction } from "@/features/auth/auth.actions";

export default async function ClinicLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireClinic();

  return (
    <AppShell
      accent="clinic"
      title={ctx.clinicName}
      panelLabel={ctx.roleNames.join(" · ") || "Clinic panel"}
      nav={clinicNav(ctx)}
      user={{ name: ctx.displayName, subtitle: ctx.email }}
      signOut={clinicSignOutAction}
      headerSlot={can(ctx, "emergency:admit") ? <EmergencyButton /> : undefined}
    >
      {children}
    </AppShell>
  );
}
