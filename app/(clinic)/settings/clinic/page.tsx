import { Settings } from "lucide-react";
import { PageHeader, PageShell, Panel } from "@/components/app/page";
import { hasModule, requireClinic } from "@/lib/auth/clinic-session";
import { withClinic } from "@/lib/db";
import { getClinicSettings } from "@/features/settings/settings.service";
import { timezoneOptions } from "@/lib/timezones";
import ClinicSettingsForm from "./ClinicSettingsForm";

export const metadata = { title: "Clinic settings" };

export default async function ClinicSettingsPage() {
  const ctx = await requireClinic({ permission: "settings:manage" });
  const settings = await withClinic({ clinicId: ctx.clinicId, userId: ctx.userId }, (tx) => getClinicSettings(tx, ctx.clinicId));

  return (
    <PageShell width="default">
      <PageHeader
        icon={Settings}
        eyebrow="Administration"
        title="Clinic settings"
        description="Name, address and letterhead print on every prescription and invoice. The timezone decides what '9:00' means in schedules."
      />
      <Panel>
        <ClinicSettingsForm
          timezones={timezoneOptions(settings.timezone)}
          values={{
            displayName: settings.displayName,
            addressLine: settings.addressLine ?? "",
            city: settings.city ?? "",
            phone: settings.phone ?? "",
            email: settings.email ?? "",
            website: settings.website ?? "",
            timezone: settings.timezone,
            letterheadText: settings.letterheadText ?? "",
            footerText: settings.footerText ?? "",
            slotMinutes: settings.slotMinutes,
            currency: settings.currency,
            analyticsMinCell: settings.analyticsMinCell,
          }}
          showAnalytics={hasModule(ctx, "analytics")}
        />
      </Panel>
    </PageShell>
  );
}
