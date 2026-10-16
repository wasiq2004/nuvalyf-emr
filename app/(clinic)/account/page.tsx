import { KeyRound, UserCircle } from "lucide-react";
import { ButtonLink } from "@/components/app/buttons";
import { DetailList, PageHeader, PageShell, Panel } from "@/components/app/page";
import { StatusBadge } from "@/components/app/status-badge";
import { requireClinic } from "@/lib/auth/clinic-session";

export const metadata = { title: "My account" };

export default async function AccountPage() {
  const ctx = await requireClinic();
  const isDoctor = ctx.roleKeys.includes("doctor");

  return (
    <PageShell width="narrow">
      <PageHeader icon={UserCircle} title="My account" description="Your sign-in details. An administrator manages your profile and roles." />

      <Panel title="Profile">
        <DetailList
          items={[
            { label: "Name", value: ctx.displayName },
            { label: "Sign-in email", value: ctx.email },
            { label: "Clinic", value: ctx.clinicName },
            { label: "Clinic code", value: <span className="font-mono">{ctx.clinicCode}</span> },
            {
              label: "Roles",
              value: (
                <span className="flex flex-wrap gap-1">
                  {ctx.roleNames.map((r) => (
                    <StatusBadge key={r} tone="accent">
                      {r}
                    </StatusBadge>
                  ))}
                </span>
              ),
            },
            ...(isDoctor
              ? [
                  {
                    label: "Registration number",
                    value: ctx.registrationNumber ?? (
                      <span className="text-amber-700 dark:text-amber-400">Not on file: ask your administrator to add it before you sign prescriptions</span>
                    ),
                  },
                ]
              : []),
          ]}
        />
      </Panel>

      <Panel title="Password" description="Changing it signs you out on every other device.">
        <ButtonLink href="/change-password" variant="secondary">
          <KeyRound className="h-4 w-4" /> Change password
        </ButtonLink>
      </Panel>
    </PageShell>
  );
}
