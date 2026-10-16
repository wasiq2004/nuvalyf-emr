import { AppShell } from "@/components/app/app-shell";
import { BRAND } from "@/lib/brand";
import { requireOperator } from "@/lib/auth/platform-session";
import { PLATFORM_NAV } from "@/lib/navigation";
import { operatorSignOutAction } from "@/features/platform/platform.actions";

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const operator = await requireOperator();
  const nav =
    operator.role === "platform_admin" ? PLATFORM_NAV : PLATFORM_NAV.filter((item) => item.href !== "/platform/operators");

  return (
    <AppShell
      accent="platform"
      title={BRAND.name}
      panelLabel="Operations console"
      nav={nav}
      user={{ name: operator.name, subtitle: operator.role === "platform_admin" ? "Platform Admin" : "Operator" }}
      signOut={operatorSignOutAction}
    >
      {children}
    </AppShell>
  );
}
