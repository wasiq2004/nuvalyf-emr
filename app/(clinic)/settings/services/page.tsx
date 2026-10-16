import { ClipboardList } from "lucide-react";
import { EmptyState, PageHeader, PageShell, Panel } from "@/components/app/page";
import { DataTable } from "@/components/app/data-table";
import { StatusBadge } from "@/components/app/status-badge";
import { requireClinic } from "@/lib/auth/clinic-session";
import { withClinic } from "@/lib/db";
import { listServices } from "@/features/scheduling/services.service";
import { getClinicSettings } from "@/features/settings/settings.service";
import { formatMoney } from "@/lib/money";
import { CreateServiceDialog, EditServiceDialog } from "./ServiceForms";

export const metadata = { title: "Services" };

export default async function ServicesPage() {
  const ctx = await requireClinic({ permission: "settings:manage" });
  const [services, settings] = await withClinic({ clinicId: ctx.clinicId, userId: ctx.userId }, (tx) =>
    Promise.all([listServices(tx), getClinicSettings(tx, ctx.clinicId)]),
  );

  return (
    <PageShell>
      <PageHeader
        icon={ClipboardList}
        eyebrow="Administration"
        title="Services"
        description="What the clinic offers and how long each takes. Schedules and booking are built on these."
        actions={<CreateServiceDialog currency={settings.currency} />}
      />

      <Panel flush>
        <DataTable
          rows={services}
          rowKey={(s) => s.id}
          empty={
            <EmptyState
              icon={ClipboardList}
              title="No services yet"
              description="Add at least one, such as a general consultation, before setting up schedules."
            />
          }
          columns={[
            {
              key: "name",
              header: "Service",
              cell: (s) => (
                <div>
                  <p className="font-semibold text-zinc-900 dark:text-zinc-100">{s.name}</p>
                  {s.description && <p className="max-w-md truncate text-xs text-zinc-500">{s.description}</p>}
                </div>
              ),
            },
            { key: "duration", header: "Duration", cell: (s) => `${s.durationMinutes} min` },
            { key: "price", header: "Price", cell: (s) => formatMoney(s.price, settings.currency) },
            {
              key: "status",
              header: "Status",
              cell: (s) => <StatusBadge tone={s.isActive ? "success" : "neutral"}>{s.isActive ? "Bookable" : "Inactive"}</StatusBadge>,
            },
            {
              key: "actions",
              header: "",
              align: "right",
              cell: (s) => (
                <EditServiceDialog
                  currency={settings.currency}
                  values={{
                    id: s.id,
                    name: s.name,
                    description: s.description ?? "",
                    durationMinutes: s.durationMinutes,
                    price: s.price,
                    isActive: s.isActive,
                  }}
                />
              ),
            },
          ]}
        />
      </Panel>
    </PageShell>
  );
}
