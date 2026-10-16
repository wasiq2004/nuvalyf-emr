// The compliance panel: its own layout and accent, separate from the clinic
// panel. Everything here reads the audit trail; nothing renders clinical
// content (see features/audit/audit-rules.ts).
import { AppShell } from "@/components/app/app-shell";
import { requireClinic } from "@/lib/auth/clinic-session";
import { complianceNav } from "@/lib/navigation";
import { clinicSignOutAction } from "@/features/auth/auth.actions";

export default async function ComplianceLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireClinic({ permission: "audit:read" });
  return (
    <AppShell
      accent="compliance"
      title={ctx.clinicName}
      panelLabel="Compliance"
      nav={complianceNav(ctx)}
      user={{ name: ctx.displayName, subtitle: ctx.email }}
      signOut={clinicSignOutAction}
    >
      {children}
    </AppShell>
  );
}
