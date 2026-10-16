import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ArrowLeft, Boxes, History, Layers } from "lucide-react";
import { EmptyState, PageHeader, PageShell, Panel, StatCard } from "@/components/app/page";
import { DataTable } from "@/components/app/data-table";
import { StatusBadge } from "@/components/app/status-badge";
import { requireClinic } from "@/lib/auth/clinic-session";
import { withClinic } from "@/lib/db";
import { formatDate, formatDateTime } from "@/lib/format";
import { todayInTimeZone } from "@/lib/time";
import { getDrugStock } from "@/features/pharmacy/stock.service";
import { EXPIRY_WARNING_DAYS, expiresWithin, isExpired } from "@/features/pharmacy/stock-rules";
import { AdjustBatchDialog, ReceiveStockDialog, ReorderLevelForm } from "./StockForms";

export const metadata = { title: "Stock" };

const REASON: Record<string, string> = {
  opening: "Opening stock",
  receipt: "Received",
  sale: "Counter sale",
  dispense: "Dispensed",
  adjustment: "Adjustment",
  expired: "Expired",
  damaged: "Damaged",
  return: "Customer return",
};

export default async function DrugStockPage({ params }: { params: Promise<{ drugId: string }> }) {
  const ctx = await requireClinic({ permission: "stock:manage", module: "pharmacy" });
  const { drugId } = await params;
  if (!z.uuid().safeParse(drugId).success) notFound();
  const today = todayInTimeZone(ctx.timezone);
  const data = await withClinic({ clinicId: ctx.clinicId, userId: ctx.userId }, (tx) => getDrugStock(tx, drugId));
  if (!data) notFound();
  const { drug, batches, movements } = data;
  const onHand = batches.reduce((n, b) => n + b.quantity, 0);
  const usable = batches.filter((b) => b.quantity > 0 && !isExpired(b.expiryDate, today)).reduce((n, b) => n + b.quantity, 0);

  return (
    <PageShell width="default">
      <Link href="/pharmacy/stock" className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-white">
        <ArrowLeft className="h-4 w-4" /> Stock
      </Link>
      <PageHeader
        icon={Boxes}
        title={drug.name}
        description={`${drug.genericName} · ${drug.form}${drug.strength ? ` · ${drug.strength}` : ""}`}
        actions={<ReceiveStockDialog drugId={drug.id} drugName={drug.name} />}
      />

      <div className="grid gap-5 sm:grid-cols-3">
        <StatCard label="On hand" value={onHand} icon={Boxes} hint={usable !== onHand ? `${usable} usable (not expired)` : undefined} />
        <StatCard label="Batches in stock" value={batches.filter((b) => b.quantity > 0).length} icon={Layers} />
        <div className="rounded-2xl border border-zinc-200 bg-white/70 p-5 shadow-sm backdrop-blur-xl dark:border-zinc-800 dark:bg-zinc-900/50">
          <ReorderLevelForm drugId={drug.id} level={drug.reorderLevel} />
        </div>
      </div>

      <Panel flush title="Batches" description="Earliest expiry first. Empty batches stay for the record.">
        <DataTable
          rows={batches}
          rowKey={(b) => b.id}
          empty={<EmptyState icon={Boxes} title="No stock received yet" />}
          columns={[
            { key: "batch", header: "Batch", cell: (b) => <span className="font-mono text-sm">{b.batchNo}</span> },
            {
              key: "expiry",
              header: "Expiry",
              cell: (b) => (
                <span className="flex flex-wrap items-center gap-2">
                  {formatDate(b.expiryDate, "UTC")}
                  {b.quantity > 0 && isExpired(b.expiryDate, today) && <StatusBadge tone="danger">Expired</StatusBadge>}
                  {b.quantity > 0 && expiresWithin(b.expiryDate, today, EXPIRY_WARNING_DAYS) && <StatusBadge tone="warning">Expiring</StatusBadge>}
                </span>
              ),
            },
            { key: "qty", header: "On hand", align: "right", cell: (b) => <span className="font-semibold tabular-nums">{b.quantity}</span> },
            { key: "adjust", header: "", align: "right", cell: (b) => <AdjustBatchDialog batchId={b.id} batchNo={b.batchNo} quantity={b.quantity} /> },
          ]}
        />
      </Panel>

      <Panel flush title="Ledger" description="Every movement, newest first. Nothing here can be edited or deleted.">
        <DataTable
          rows={movements}
          rowKey={(m) => m.id}
          empty={<EmptyState icon={History} title="No movements yet" />}
          columns={[
            { key: "when", header: "When", cell: (m) => formatDateTime(m.createdAt, ctx.timezone) },
            {
              key: "what",
              header: "What",
              cell: (m) => (
                <span>
                  {REASON[m.reason] ?? m.reason}
                  {m.note ? <span className="block text-xs text-zinc-500">{m.note}</span> : null}
                </span>
              ),
            },
            { key: "batch", header: "Batch", hideOnMobile: true, cell: (m) => <span className="font-mono text-xs">{m.batchNo}</span> },
            { key: "who", header: "By", hideOnMobile: true, cell: (m) => m.actorName },
            {
              key: "change",
              header: "Change",
              align: "right",
              cell: (m) => (
                <span className={m.change > 0 ? "font-semibold tabular-nums text-emerald-600" : "font-semibold tabular-nums text-red-600"}>
                  {m.change > 0 ? `+${m.change}` : m.change}
                </span>
              ),
            },
          ]}
        />
      </Panel>
    </PageShell>
  );
}
