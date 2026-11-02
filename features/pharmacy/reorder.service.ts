import "server-only";

// Reorder suggestions (docs/PHARMACY_DESIGN.md 4.7): what to order, from
// whom, worked out from the last 30 days of sales and dispensing, stock on
// hand, reorder levels and each item's last supplier. Accepting them creates
// draft purchase orders, which still need approval.
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import { drugs, purchaseOrderItems, purchaseOrders, suppliers } from "@/lib/db/schema";
import { AppError } from "@/lib/errors";
import { addDaysToDateString, zonedTimeToUtc } from "@/lib/time";
import { createOrder, setOrderItem } from "./purchasing.service";
import { suggestOrder, type ReorderSuggestion } from "./reorder-rules";
import type { PharmacySettings } from "./settings.service";

const WINDOW_DAYS = 30;

export type ReorderLine = ReorderSuggestion & {
  drugId: string;
  name: string;
  form: string;
  packSize: number;
  onHand: number;
  reorderLevel: number;
  supplierId: string | null;
  supplierName: string | null;
  lastUnitCost: string | null;
};

export async function reorderSuggestions(tx: Tx, today: string, timezone: string, settings: PharmacySettings): Promise<ReorderLine[]> {
  const since = zonedTimeToUtc(addDaysToDateString(today, -WINDOW_DAYS), "00:00", timezone);
  const rows = await tx
    .select({
      drug: drugs,
      onHand: sql<number>`coalesce((select sum(b.quantity) from app.stock_batches b where b.drug_id = ${sql.raw('"drugs"."id"')}), 0)::int`,
      unitsOut: sql<number>`coalesce((
        select -sum(m.change) from app.stock_movements m
        where m.drug_id = ${sql.raw('"drugs"."id"')} and m.created_at >= ${since.toISOString()}::timestamptz and m.reason in ('sale', 'dispense', 'return')
      ), 0)::int`,
      lastSupplier: sql<string | null>`coalesce(
        (select b.supplier_id::text from app.purchase_bill_items i join app.purchase_bills b on b.id = i.bill_id where i.drug_id = ${sql.raw('"drugs"."id"')} order by b.bill_date desc, b.created_at desc limit 1),
        (select o.supplier_id::text from app.purchase_order_items i join app.purchase_orders o on o.id = i.purchase_order_id where i.drug_id = ${sql.raw('"drugs"."id"')} order by o.created_at desc limit 1)
      )`,
      lastUnitCost: sql<string | null>`(select b.unit_cost::text from app.stock_batches b where b.drug_id = ${sql.raw('"drugs"."id"')} and b.unit_cost is not null order by b.created_at desc limit 1)`,
    })
    .from(drugs)
    .where(eq(drugs.isActive, true));

  const supplierIds = [...new Set(rows.map((r) => r.lastSupplier).filter((s): s is string => Boolean(s)))];
  const names = supplierIds.length ? await tx.select({ id: suppliers.id, name: suppliers.name, isActive: suppliers.isActive }).from(suppliers).where(inArray(suppliers.id, supplierIds)) : [];

  const out: ReorderLine[] = [];
  for (const r of rows) {
    const suggestion = suggestOrder({
      onHand: r.onHand,
      reorderLevel: r.drug.reorderLevel,
      unitsOut: Math.max(0, r.unitsOut),
      days: WINDOW_DAYS,
      packSize: r.drug.packSize,
      leadDays: settings.reorderLeadDays,
      coverDays: settings.reorderCoverDays,
    });
    if (!suggestion) continue;
    const supplier = names.find((s) => s.id === r.lastSupplier && s.isActive);
    out.push({
      ...suggestion,
      drugId: r.drug.id,
      name: r.drug.name,
      form: r.drug.form,
      packSize: r.drug.packSize,
      onHand: r.onHand,
      reorderLevel: r.drug.reorderLevel,
      supplierId: supplier?.id ?? null,
      supplierName: supplier?.name ?? null,
      lastUnitCost: r.lastUnitCost,
    });
  }
  // Running out first, then by supplier.
  return out.sort((a, b) => (a.onHand === 0 ? -1 : 0) - (b.onHand === 0 ? -1 : 0) || (a.supplierName ?? "~").localeCompare(b.supplierName ?? "~") || a.name.localeCompare(b.name));
}

/** One draft purchase order per supplier from the chosen suggestions. */
export async function createReorderDrafts(tx: Tx, clinicId: string, picks: { drugId: string; supplierId: string; units: number; unitCost?: string }[], actorId: string) {
  if (picks.length === 0) throw new AppError("Choose at least one item to order.");
  const bySupplier = new Map<string, typeof picks>();
  for (const p of picks) bySupplier.set(p.supplierId, [...(bySupplier.get(p.supplierId) ?? []), p]);
  const orders: { id: string; number: string; lines: number }[] = [];
  for (const [supplierId, lines] of bySupplier) {
    const order = await createOrder(tx, clinicId, supplierId, actorId);
    for (const l of lines) await setOrderItem(tx, clinicId, order.id, { drugId: l.drugId, quantity: l.units, unitCost: l.unitCost });
    orders.push({ ...order, lines: lines.length });
  }
  return orders;
}

/** Items already on an open order, so they are not suggested twice. */
export async function itemsOnOpenOrders(tx: Tx) {
  const rows = await tx
    .select({ drugId: purchaseOrderItems.drugId })
    .from(purchaseOrderItems)
    .innerJoin(purchaseOrders, eq(purchaseOrders.id, purchaseOrderItems.purchaseOrderId))
    .where(and(inArray(purchaseOrders.status, ["draft", "submitted", "approved"])));
  return new Set(rows.map((r) => r.drugId));
}

