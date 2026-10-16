import Link from "next/link";
import { Megaphone } from "lucide-react";
import { EmptyState, PageHeader, PageShell, Panel } from "@/components/app/page";
import { DataTable } from "@/components/app/data-table";
import { StatusBadge } from "@/components/app/status-badge";
import { can, requireClinic } from "@/lib/auth/clinic-session";
import { withClinic } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { getConfig, listBroadcasts, listTemplates } from "@/features/messaging/messaging.service";
import { describeAudience, type Audience } from "@/features/messaging/messaging-rules";
import { BroadcastComposer } from "./BroadcastComposer";

export const metadata = { title: "Broadcasts" };

export default async function BroadcastsPage() {
  const ctx = await requireClinic({ permission: "broadcast:send", module: "whatsapp" });
  const data = await withClinic({ clinicId: ctx.clinicId, userId: ctx.userId }, async (tx) => ({
    config: await getConfig(tx, ctx.clinicId),
    templates: (await listTemplates(tx)).filter((t) => t.isActive),
    broadcasts: await listBroadcasts(tx),
  }));
  const ready = Boolean(data.config?.enabled) && data.templates.length > 0;

  return (
    <PageShell>
      <PageHeader
        icon={Megaphone}
        title="Broadcasts"
        description="Clinic updates on WhatsApp, only to patients who agreed to receive them. You see exactly who is left out before you send."
      />

      <Panel title="New broadcast">
        {ready ? (
          <BroadcastComposer templates={data.templates.map((t) => ({ id: t.id, name: t.name, preview: t.preview }))} />
        ) : (
          <EmptyState
            icon={Megaphone}
            title={data.config?.enabled ? "Add an approved template first" : "WhatsApp messaging is off"}
            description={
              can(ctx, "settings:manage") ? (
                <Link href="/settings/messaging" className="text-(--accent-text) hover:underline">
                  Set it up in Messaging settings
                </Link>
              ) : (
                "Ask your Clinic Admin to set it up."
              )
            }
          />
        )}
      </Panel>

      <Panel flush title="Sent broadcasts">
        <DataTable
          rows={data.broadcasts}
          rowKey={(b) => b.id}
          empty={<EmptyState icon={Megaphone} title="No broadcasts yet" />}
          columns={[
            {
              key: "title",
              header: "Broadcast",
              cell: (b) => (
                <div>
                  <p className="font-medium text-zinc-900 dark:text-zinc-100">{b.title}</p>
                  <p className="text-xs text-zinc-500">
                    <span className="font-mono">{b.template}</span> · {describeAudience(b.audience as Audience)}
                  </p>
                </div>
              ),
            },
            { key: "when", header: "Queued", hideOnMobile: true, cell: (b) => `${formatDateTime(b.createdAt, ctx.timezone)} · ${b.createdByName}` },
            { key: "recipients", header: "To", align: "right", cell: (b) => <span title={`${b.excluded} left out`}>{b.recipients}</span> },
            {
              key: "progress",
              header: "",
              align: "right",
              cell: (b) => (
                <span className="flex flex-wrap justify-end gap-1">
                  {b.queued > 0 && <StatusBadge tone="info">{b.queued} sending</StatusBadge>}
                  <StatusBadge tone="success">{b.sent} sent</StatusBadge>
                  {b.failed > 0 && <StatusBadge tone="warning">{b.failed} not sent</StatusBadge>}
                </span>
              ),
            },
          ]}
        />
      </Panel>
    </PageShell>
  );
}
