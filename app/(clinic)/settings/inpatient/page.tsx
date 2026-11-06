import { BedDouble } from "lucide-react";
import { EmptyState, PageHeader, PageShell, Panel } from "@/components/app/page";
import { DataTable } from "@/components/app/data-table";
import { StatusBadge } from "@/components/app/status-badge";
import { requireClinic } from "@/lib/auth/clinic-session";
import { withClinic } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { todayInTimeZone } from "@/lib/time";
import { getClinicSettings } from "@/features/settings/settings.service";
import { bedBoard, getInpatientSettings, listBedCategories } from "@/features/inpatient/inpatient.service";
import { STANDARD_SECTIONS } from "@/features/inpatient/summary-rules";
import { BedDialog, CategoryDialog, InpatientSettingsForm } from "./InpatientSettingsForms";

export const metadata = { title: "Beds & inpatient" };

export default async function InpatientSettingsPage() {
  const ctx = await requireClinic({ permission: "settings:manage", module: "inpatient" });
  const data = await withClinic({ clinicId: ctx.clinicId, userId: ctx.userId }, async (tx) => ({
    settings: await getInpatientSettings(tx, ctx.clinicId),
    categories: await listBedCategories(tx),
    beds: await bedBoard(tx, todayInTimeZone(ctx.timezone)),
    currency: (await getClinicSettings(tx, ctx.clinicId)).currency,
  }));
  const categories = data.categories.filter((c) => c.isActive).map((c) => ({ value: c.id, label: c.name }));
  const custom = data.settings.sections.filter((s) => !STANDARD_SECTIONS.some((std) => std.key === s.key)).map((s) => s.title);

  return (
    <PageShell>
      <PageHeader icon={BedDouble} title="Beds & inpatient" description="Bed categories and their daily price, the beds themselves, how stays are charged, and what a discharge summary contains." />

      <Panel title="Billing and discharge summary">
        <InpatientSettingsForm
          billingMode={data.settings.billingMode}
          minimumHours={data.settings.minimumHours}
          enabled={data.settings.sections.map((s) => s.key)}
          custom={custom}
          standard={STANDARD_SECTIONS}
        />
      </Panel>

      <Panel flush title="Bed categories" description="The price per 24 hours. A patient already in a bed keeps the rate they started on." actions={<CategoryDialog />}>
        <DataTable
          rows={data.categories}
          rowKey={(c) => c.id}
          empty={<EmptyState icon={BedDouble} title="No categories yet" description="For example General, Semi-private, Private, ICU." />}
          columns={[
            { key: "name", header: "Category", cell: (c) => <span className="font-medium text-zinc-900 dark:text-zinc-100">{c.name}</span> },
            { key: "beds", header: "Beds", align: "right", cell: (c) => data.beds.filter((b) => b.categoryId === c.id).length },
            { key: "rate", header: "Per day", align: "right", cell: (c) => <span className="tabular-nums">{formatMoney(c.dailyRate, data.currency)}</span> },
            { key: "edit", header: "", align: "right", cell: (c) => <CategoryDialog values={{ id: c.id, name: c.name, dailyRate: c.dailyRate }} /> },
          ]}
        />
      </Panel>

      <Panel flush title="Beds" actions={categories.length > 0 ? <BedDialog categories={categories} /> : undefined}>
        <DataTable
          rows={data.beds}
          rowKey={(b) => b.id}
          empty={<EmptyState icon={BedDouble} title="No beds yet" description={categories.length ? "Add each bed with its ward and number." : "Add a category first."} />}
          columns={[
            { key: "code", header: "Bed", cell: (b) => <span className="font-mono font-semibold">{b.code}</span> },
            { key: "ward", header: "Ward", cell: (b) => b.ward ?? "—" },
            { key: "category", header: "Category", cell: (b) => b.categoryName },
            { key: "state", header: "", cell: (b) => (b.admissionId ? <StatusBadge tone="accent">{b.patientName}</StatusBadge> : <StatusBadge tone="success">Free</StatusBadge>) },
            { key: "edit", header: "", align: "right", cell: (b) => <BedDialog categories={categories} values={{ id: b.id, categoryId: b.categoryId, ward: b.ward ?? "", code: b.code }} /> },
          ]}
        />
      </Panel>
    </PageShell>
  );
}
