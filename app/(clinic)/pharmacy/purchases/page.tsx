import Link from "next/link";
import { forbidden } from "next/navigation";
import { Building2, ReceiptText, Truck } from "lucide-react";
import { ButtonLink } from "@/components/app/buttons";
import { EmptyState, PageHeader, PageShell, Panel } from "@/components/app/page";
import { DataTable } from "@/components/app/data-table";
import { StatusBadge } from "@/components/app/status-badge";
import { can, recordDenied, requireClinic } from "@/lib/auth/clinic-session";
import { withClinic } from "@/lib/db";
import { formatDate } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { getClinicSettings } from "@/features/settings/settings.service";
import { listBills } from "@/features/pharmacy/bills.service";
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
    bills: await listBills(tx),
    currency: (await getClinicSettings(tx, ctx.clinicId)).currency,
  }));
  const canCreate = can(ctx, "purchase:create");
  const canEnterBills = can(ctx, "stock:manage");
  const awaiting = data.orders.filter((o) => o.status === "submitted").length;

  return (
    <PageShell>
      <PageHeader
        icon={Truck}
        title="Purchases"
        description="Type in a supplier's bill to add its items to stock, or raise a purchase order that someone else approves before the delivery is received."
        actions={
          <>
            {canCreate && data.suppliers.some((s) => s.isActive) && <NewOrderDialog suppliers={data.suppliers.filter((s) => s.isActive)} />}
            {canEnterBills && (
              <ButtonLink href="/pharmacy/purchases/bills/new">
                <ReceiptText className="h-4 w-4" /> Enter a supplier bill
              </ButtonLink>
            )}
          </>
        }
      />

      <Panel flush title="Supplier bills" description="Bills typed in from suppliers. Each one added its items to stock when it was saved.">
        <DataTable
          rows={data.bills}
          rowKey={(b) => b.id}
          empty={
            <EmptyState
              icon={ReceiptText}
              title="No bills entered yet"
              description={canEnterBills ? "When a delivery arrives with its bill, choose “Enter a supplier bill”." : undefined}
            />
          }
          columns={[
            {
              key: "bill",
              header: "Bill",
              cell: (b) => (
                <Link href={`/pharmacy/purchases/bills/${b.id}`} className="group block">
                  <p className="font-medium text-zinc-900 group-hover:underline dark:text-zinc-100">{b.supplierName}</p>
                  <p className="font-mono text-xs text-zinc-500">
                    {b.billNo} · {b.number}
                  </p>
                </Link>
              ),
            },
            { key: "date", header: "Bill date", hideOnMobile: true, cell: (b) => formatDate(b.billDate, "UTC") },
            { key: "lines", header: "Lines", align: "right", hideOnMobile: true, cell: (b) => b.lineCount },
            { key: "total", header: "Total", align: "right", cell: (b) => <span className="font-semibold tabular-nums">{formatMoney(b.total, data.currency)}</span> },
          ]}
        />
      </Panel>

      <div className="grid gap-6 xl:grid-cols-3">
        <Panel flush title="Purchase orders" description={awaiting ? `${awaiting} awaiting approval` : undefined} className="min-w-0 xl:col-span-2">
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
