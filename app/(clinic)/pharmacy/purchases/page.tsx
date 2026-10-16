import Link from "next/link";
import { forbidden } from "next/navigation";
import { Building2, Truck } from "lucide-react";
import { EmptyState, PageHeader, PageShell, Panel } from "@/components/app/page";
import { DataTable } from "@/components/app/data-table";
import { StatusBadge } from "@/components/app/status-badge";
import { can, recordDenied, requireClinic } from "@/lib/auth/clinic-session";
import { withClinic } from "@/lib/db";
import { formatDate } from "@/lib/format";
import { listOrders, listSuppliers } from "@/features/pharmacy/purchasing.service";
import { NewOrderDialog, SupplierDialog } from "./PurchaseForms";
import { ORDER_STATUS } from "@/components/pharmacy/status";

export const metadata = { title: "Purchases" };

export default async function PurchasesPage() {
  const ctx = await requireClinic({ module: "pharmacy" });
  if (!can(ctx, "purchase:create") && !can(ctx, "purchase:approve") && !can(ctx, "stock:manage")) {
    await recordDenied(ctx, "PAGE_ACCESS_DENIED", { required: ["purchase:create", "purchase:approve", "stock:manage"], path: "/pharmacy/purchases" });
    forbidden();
  }
  const data = await withClinic({ clinicId: ctx.clinicId, userId: ctx.userId }, async (tx) => ({
    orders: await listOrders(tx),
    suppliers: await listSuppliers(tx),
  }));
  const canCreate = can(ctx, "purchase:create");
  const awaiting = data.orders.filter((o) => o.status === "submitted").length;

  return (
    <PageShell>
      <PageHeader
        icon={Truck}
        title="Purchases"
        description="Purchase orders go from draft to approval (by someone other than the person who raised them) to receiving, which adds the stock."
        actions={canCreate && data.suppliers.some((s) => s.isActive) ? <NewOrderDialog suppliers={data.suppliers.filter((s) => s.isActive)} /> : undefined}
      />

      <div className="grid gap-6 xl:grid-cols-3">
        <Panel flush title="Orders" description={awaiting ? `${awaiting} awaiting approval` : undefined} className="min-w-0 xl:col-span-2">
          <DataTable
            rows={data.orders}
            rowKey={(o) => o.id}
            empty={<EmptyState icon={Truck} title="No purchase orders yet" description={canCreate ? "Add a supplier, then raise an order." : undefined} />}
            columns={[
              {
                key: "number",
                header: "Order",
                cell: (o) => (
                  <Link href={`/pharmacy/purchases/${o.id}`} className="font-mono text-sm font-semibold text-(--accent-text) hover:underline">
                    {o.number}
                  </Link>
                ),
              },
              { key: "supplier", header: "Supplier", cell: (o) => o.supplierName },
              { key: "date", header: "Raised", hideOnMobile: true, cell: (o) => formatDate(o.createdAt, ctx.timezone) },
              { key: "status", header: "", align: "right", cell: (o) => <StatusBadge tone={ORDER_STATUS[o.status].tone}>{ORDER_STATUS[o.status].label}</StatusBadge> },
            ]}
          />
        </Panel>

        <Panel flush title="Suppliers" actions={canCreate ? <SupplierDialog /> : undefined}>
          {data.suppliers.length === 0 ? (
            <div className="p-6">
              <EmptyState icon={Building2} title="No suppliers yet" />
            </div>
          ) : (
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {data.suppliers.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-2 px-6 py-3">
                  <div className="min-w-0 text-sm">
                    <p className="truncate font-medium text-zinc-900 dark:text-zinc-100">{s.name}</p>
                    <p className="truncate text-xs text-zinc-500">{[s.contactName, s.phone].filter(Boolean).join(" · ") || "—"}</p>
                  </div>
                  {canCreate && (
                    <SupplierDialog values={{ id: s.id, name: s.name, contactName: s.contactName ?? "", phone: s.phone ?? "", email: s.email ?? "", taxId: s.taxId ?? "" }} />
                  )}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </PageShell>
  );
}
