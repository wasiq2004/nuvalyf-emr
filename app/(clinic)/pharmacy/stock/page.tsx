import Link from "next/link";
import { Boxes, FileUp } from "lucide-react";
import { ButtonLink } from "@/components/app/buttons";
import { ItemTypeBadge } from "@/components/pharmacy/item-picker";
import { packWord } from "@/features/pharmacy/selling-rules";
import { EmptyState, PageHeader, PageShell, Panel } from "@/components/app/page";
import { DataTable } from "@/components/app/data-table";
import { StatusBadge } from "@/components/app/status-badge";
import { TabNav } from "@/components/app/tabs";
import { can, requireClinic } from "@/lib/auth/clinic-session";
import { withClinic } from "@/lib/db";
import { formatDate } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { todayInTimeZone } from "@/lib/time";
import { getClinicSettings } from "@/features/settings/settings.service";
import { listStock, type StockRow } from "@/features/pharmacy/stock.service";
import type { StockFlag } from "@/features/pharmacy/stock-rules";

export const metadata = { title: "Stock" };

const FILTERS = [
  { key: "all", label: "All" },
  { key: "low", label: "Low / out" },
  { key: "expiring", label: "Expiring" },
  { key: "slow", label: "Slow moving" },
] as const;

const FLAG_BADGE: Record<StockFlag, { label: string; tone: "danger" | "warning" | "neutral" }> = {
  out: { label: "Out", tone: "danger" },
  low: { label: "Low", tone: "warning" },
  expired: { label: "Expired stock", tone: "danger" },
  expiring: { label: "Expiring", tone: "warning" },
  slow: { label: "Slow", tone: "neutral" },
};

function matches(row: StockRow, filter: string) {
  if (filter === "low") return row.flags.includes("low") || row.flags.includes("out");
  if (filter === "expiring") return row.flags.includes("expiring") || row.flags.includes("expired");
  if (filter === "slow") return row.flags.includes("slow");
  return true;
}

export default async function StockPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const ctx = await requireClinic({ permission: "stock:manage", module: "pharmacy" });
  const { show } = await searchParams;
  const filter = FILTERS.find((f) => f.key === show)?.key ?? "all";
  const today = todayInTimeZone(ctx.timezone);
  const data = await withClinic({ clinicId: ctx.clinicId, userId: ctx.userId }, async (tx) => ({
    stock: await listStock(tx, today),
    currency: (await getClinicSettings(tx, ctx.clinicId)).currency,
  }));
  const rows = data.stock.filter((r) => matches(r, filter));
  const count = (key: string) => data.stock.filter((r) => matches(r, key)).length;

  return (
    <PageShell>
      <PageHeader
        icon={Boxes}
        title="Stock"
        description="On hand per item, from the movement ledger. Open an item to add stock, write off expired or damaged units, or set its reorder level."
        actions={
          can(ctx, "medicine:manage") ? (
            <ButtonLink href="/pharmacy/stock/import" variant="secondary">
              <FileUp className="h-4 w-4" /> Import items &amp; stock
            </ButtonLink>
          ) : undefined
        }
      />
      <TabNav
        label="Stock filter"
        active={filter}
        tabs={FILTERS.map((f) => ({
          key: f.key,
          label: f.label,
          href: `/pharmacy/stock?show=${f.key}`,
          badge: f.key !== "all" && count(f.key) > 0 ? <span className="rounded-full bg-amber-400 px-1.5 text-[10px] font-bold text-amber-950">{count(f.key)}</span> : undefined,
        }))}
      />
      <Panel flush>
        <DataTable
          rows={rows}
          rowKey={(r) => r.drugId}
          empty={<EmptyState icon={Boxes} title="Nothing here" />}
          columns={[
            {
              key: "name",
              header: "Item",
              cell: (r) => (
                <Link href={`/pharmacy/stock/${r.drugId}`} className="group block">
                  <p className="flex flex-wrap items-center gap-2 font-medium text-zinc-900 group-hover:underline dark:text-zinc-100">
                    {r.name} <ItemTypeBadge type={r.itemType} />
                  </p>
                  <p className="text-xs text-zinc-500">{r.itemType === "medicine" ? `${r.genericName} · ${r.form}` : (r.manufacturer ?? "—")}</p>
                </Link>
              ),
            },
            { key: "onHand", header: "On hand", align: "right", cell: (r) => <span className="font-semibold tabular-nums">{r.onHand}</span> },
            { key: "reorder", header: "Reorder at", align: "right", hideOnMobile: true, cell: (r) => r.reorderLevel || "—" },
            { key: "expiry", header: "Next expiry", hideOnMobile: true, cell: (r) => (r.nearestExpiry ? formatDate(r.nearestExpiry, "UTC") : "—") },
            {
              key: "price",
              header: "Price",
              align: "right",
              hideOnMobile: true,
              cell: (r) => (
                <span className="tabular-nums">
                  {r.price ? formatMoney(r.price, data.currency) : "—"}
                  {r.packSize > 1 && r.packPrice && (
                    <span className="block text-xs text-zinc-500">
                      {formatMoney(r.packPrice, data.currency)} / {packWord(r.form)}
                    </span>
                  )}
                </span>
              ),
            },
            {
              key: "flags",
              header: "",
              align: "right",
              cell: (r) => (
                <span className="flex flex-wrap justify-end gap-1">
                  {r.flags.map((f) => (
                    <StatusBadge key={f} tone={FLAG_BADGE[f].tone}>
                      {FLAG_BADGE[f].label}
                    </StatusBadge>
                  ))}
                </span>
              ),
            },
          ]}
        />
      </Panel>
    </PageShell>
  );
}
