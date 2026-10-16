import Link from "next/link";
import { forbidden, notFound } from "next/navigation";
import { z } from "zod";
import { asc, eq } from "drizzle-orm";
import { ArrowLeft, Truck } from "lucide-react";
import { DetailList, EmptyState, PageHeader, PageShell, Panel } from "@/components/app/page";
import { DataTable } from "@/components/app/data-table";
import { StatusBadge } from "@/components/app/status-badge";
import { can, recordDenied, requireClinic } from "@/lib/auth/clinic-session";
import { withClinic } from "@/lib/db";
import { drugs } from "@/lib/db/schema";
import { formatDateTime } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { getClinicSettings } from "@/features/settings/settings.service";
import { getOrder } from "@/features/pharmacy/purchasing.service";
import { ORDER_STATUS } from "@/components/pharmacy/status";
import { CancelOrderButton, DecideOrderButtons, OrderLineForm, ReceiveOrderDialog, RemoveOrderLine, SubmitOrderButton } from "../PurchaseForms";

export const metadata = { title: "Purchase order" };

export default async function PurchaseOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireClinic({ module: "pharmacy" });
  if (!can(ctx, "purchase:create") && !can(ctx, "purchase:approve") && !can(ctx, "stock:manage")) {
    await recordDenied(ctx, "PAGE_ACCESS_DENIED", { required: ["purchase:create", "purchase:approve", "stock:manage"], path: "/pharmacy/purchases/[id]" });
    forbidden();
  }
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const data = await withClinic({ clinicId: ctx.clinicId, userId: ctx.userId }, async (tx) => {
    const order = await getOrder(tx, id);
    if (!order) return null;
    const drugOptions = order.status === "draft" ? await tx.select({ id: drugs.id, name: drugs.name }).from(drugs).where(eq(drugs.isActive, true)).orderBy(asc(drugs.name)) : [];
    return { order, drugOptions, currency: (await getClinicSettings(tx, ctx.clinicId)).currency };
  });
  if (!data) notFound();
  const { order } = data;
  const money = (v: string) => formatMoney(v, data.currency);
  const draft = order.status === "draft";
  const canCreate = can(ctx, "purchase:create");
  const status = ORDER_STATUS[order.status];

  return (
    <PageShell width="default">
      <Link href="/pharmacy/purchases" className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-white">
        <ArrowLeft className="h-4 w-4" /> Purchases
      </Link>
      <PageHeader
        icon={Truck}
        eyebrow={<span className="font-mono normal-case tracking-normal">{order.number}</span>}
        title={order.supplier.name}
        description={[order.supplier.contactName, order.supplier.phone].filter(Boolean).join(" · ") || undefined}
        actions={
          <>
            <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
            {canCreate && ["draft", "submitted", "approved"].includes(order.status) && <CancelOrderButton orderId={order.id} />}
            {canCreate && draft && order.items.length > 0 && <SubmitOrderButton orderId={order.id} />}
            {can(ctx, "purchase:approve") && order.status === "submitted" && order.createdBy !== ctx.userId && <DecideOrderButtons orderId={order.id} />}
            {can(ctx, "stock:manage") && order.status === "approved" && (
              <ReceiveOrderDialog orderId={order.id} items={order.items.map((i) => ({ id: i.id, drugName: i.drugName, quantity: i.quantity, unitCost: i.unitCost }))} />
            )}
          </>
        }
      />

      {order.status === "submitted" && order.createdBy === ctx.userId && (
        <p className="text-sm text-zinc-500">Waiting for someone else to approve. You raised this order, so you cannot approve it yourself.</p>
      )}

      <Panel flush title="Lines" description={`Estimated cost ${money(order.estimatedTotal)}`}>
        <DataTable
          rows={order.items}
          rowKey={(i) => i.id}
          empty={<EmptyState icon={Truck} title="No lines yet" />}
          columns={[
            { key: "drug", header: "Medicine", cell: (i) => <span className="font-medium text-zinc-900 dark:text-zinc-100">{i.drugName}</span> },
            { key: "qty", header: "Ordered", align: "right", cell: (i) => i.quantity },
            { key: "cost", header: "Cost / unit", align: "right", hideOnMobile: true, cell: (i) => (i.unitCost ? money(i.unitCost) : "—") },
            ...(order.status === "received" ? [{ key: "received", header: "Received", align: "right" as const, cell: (i: (typeof order.items)[number]) => i.receivedQuantity }] : []),
            ...(draft && canCreate ? [{ key: "remove", header: "", align: "right" as const, cell: (i: (typeof order.items)[number]) => <RemoveOrderLine id={i.id} name={i.drugName} /> }] : []),
          ]}
        />
        {draft && canCreate && (
          <div className="border-t border-zinc-100 px-6 py-5 lg:px-8 dark:border-zinc-800">
            <OrderLineForm orderId={order.id} drugs={data.drugOptions} />
          </div>
        )}
      </Panel>

      <Panel title="History">
        <DetailList
          items={[
            { label: "Raised", value: `${order.createdByName} · ${formatDateTime(order.createdAt, ctx.timezone)}` },
            { label: "Submitted", value: order.submittedAt ? formatDateTime(order.submittedAt, ctx.timezone) : "—" },
            {
              label: order.status === "rejected" ? "Rejected" : "Approved",
              value: order.decidedAt ? `${order.decidedByName} · ${formatDateTime(order.decidedAt, ctx.timezone)}${order.decisionNote ? ` · “${order.decisionNote}”` : ""}` : "—",
            },
            { label: "Received", value: order.receivedAt ? `${order.receivedByName} · ${formatDateTime(order.receivedAt, ctx.timezone)}` : "—" },
          ]}
        />
      </Panel>
    </PageShell>
  );
}
