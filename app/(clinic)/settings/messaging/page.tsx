import { MessageCircle, Send, TriangleAlert } from "lucide-react";
import { EmptyState, PageHeader, PageShell, Panel, StatCard } from "@/components/app/page";
import { DataTable } from "@/components/app/data-table";
import { StatusBadge } from "@/components/app/status-badge";
import { requireClinic } from "@/lib/auth/clinic-session";
import { withClinic } from "@/lib/db";
import { isEncryptionConfigured } from "@/lib/crypto";
import { whatsappDriver } from "@/lib/messaging/whatsapp";
import { addDaysToDateString, todayInTimeZone, zonedTimeToUtc } from "@/lib/time";
import { getConfig, listTemplates, messageStats } from "@/features/messaging/messaging.service";
import { TemplateDialog, VerifyConnectionButton, WhatsAppConfigForm } from "./MessagingForms";

export const metadata = { title: "Messaging" };

export default async function MessagingSettingsPage() {
  const ctx = await requireClinic({ permission: "settings:manage", module: "whatsapp" });
  const since = zonedTimeToUtc(addDaysToDateString(todayInTimeZone(ctx.timezone), -30), "00:00", ctx.timezone);
  const data = await withClinic({ clinicId: ctx.clinicId, userId: ctx.userId }, async (tx) => ({
    config: await getConfig(tx, ctx.clinicId),
    templates: await listTemplates(tx),
    stats: await messageStats(tx, since),
  }));
  const count = (status: string) => data.stats.filter((s) => s.status === status).reduce((n, s) => n + s.n, 0);
  const testMode = whatsappDriver() === "log";

  return (
    <PageShell width="default">
      <PageHeader
        icon={MessageCircle}
        title="WhatsApp messaging"
        description="Appointment reminders and clinic updates through the Meta WhatsApp Cloud API. Messages only go to patients who agreed, and that is checked again at the moment of sending."
      />

      {testMode && (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
          <TriangleAlert className="mt-0.5 h-5 w-5 flex-shrink-0" />
          <p>
            <span className="font-semibold">Test mode.</span> This server records messages as sent without contacting WhatsApp (WHATSAPP_DRIVER=log).
          </p>
        </div>
      )}

      <div className="grid gap-5 sm:grid-cols-3">
        <StatCard label="Sent (30 days)" value={count("sent")} icon={Send} />
        <StatCard label="Waiting to send" value={count("queued")} icon={MessageCircle} />
        <StatCard label="Failed or skipped" value={count("failed") + count("skipped")} icon={TriangleAlert} hint="Skipped = consent withdrawn or appointment changed" />
      </div>

      <Panel title="Connection and reminders" actions={data.config?.hasToken ? <VerifyConnectionButton /> : undefined}>
        <WhatsAppConfigForm
          canStoreSecrets={isEncryptionConfigured()}
          values={{
            phoneNumberId: data.config?.phoneNumberId ?? "",
            businessAccountId: data.config?.businessAccountId ?? "",
            displayPhone: data.config?.displayPhone ?? "",
            hasToken: data.config?.hasToken ?? false,
            enabled: data.config?.enabled ?? false,
            remindersEnabled: data.config?.remindersEnabled ?? false,
            reminderHoursBefore: data.config?.reminderHoursBefore ?? 24,
            reminderTemplate: data.config?.reminderTemplate ?? "appointment_reminder",
            templateLanguage: data.config?.templateLanguage ?? "en",
          }}
        />
      </Panel>

      <Panel flush title="Broadcast templates" description="Approved in Meta Business Manager, recorded here." actions={<TemplateDialog />}>
        <DataTable
          rows={data.templates}
          rowKey={(t) => t.id}
          empty={<EmptyState icon={MessageCircle} title="No templates yet" description="Add the templates Meta has approved for your number." />}
          columns={[
            {
              key: "name",
              header: "Template",
              cell: (t) => (
                <div className={t.isActive ? undefined : "opacity-60"}>
                  <p className="font-mono text-sm font-medium text-zinc-900 dark:text-zinc-100">{t.name}</p>
                  <p className="mt-0.5 line-clamp-2 text-xs text-zinc-500">{t.preview}</p>
                </div>
              ),
            },
            { key: "lang", header: "Language", hideOnMobile: true, cell: (t) => <span className="font-mono text-xs">{t.language}</span> },
            { key: "category", header: "Category", hideOnMobile: true, cell: (t) => <StatusBadge>{t.category}</StatusBadge> },
            { key: "active", header: "", cell: (t) => (t.isActive ? <StatusBadge tone="success">Active</StatusBadge> : <StatusBadge>Inactive</StatusBadge>) },
            {
              key: "edit",
              header: "",
              align: "right",
              cell: (t) => <TemplateDialog values={{ id: t.id, name: t.name, language: t.language, category: t.category, preview: t.preview, isActive: t.isActive }} />,
            },
          ]}
        />
      </Panel>
    </PageShell>
  );
}
