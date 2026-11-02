"use client";

// Tick the suggestions to order, adjust packs, supplier or cost, and one draft
// purchase order is raised per supplier. The drafts still go through approval.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Truck } from "lucide-react";
import { buttonClass } from "@/components/app/buttons";
import { StatusBadge } from "@/components/app/status-badge";
import { inputClass } from "@/components/app/styles";
import { createReorderDraftsAction } from "@/features/pharmacy/stock-tools.actions";
import { packWord, unitWord } from "@/features/pharmacy/selling-rules";
import { formatMoney, fromMinor, toMinor } from "@/lib/money";
import { cn } from "@/lib/utils";

export type ReorderRow = {
  drugId: string;
  name: string;
  form: string;
  packSize: number;
  onHand: number;
  reorderLevel: number;
  daily: number;
  packs: number;
  reason: "reorder_level" | "running_out";
  supplierId: string | null;
  lastUnitCost: string | null;
  onOrder: boolean;
};

type Choice = { on: boolean; packs: string; supplierId: string; unitCost: string };

export function ReorderPlanner({ rows, suppliers, currency }: { rows: ReorderRow[]; suppliers: { id: string; name: string }[]; currency: string }) {
  const router = useRouter();
  const [choices, setChoices] = useState<Record<string, Choice>>(() =>
    Object.fromEntries(rows.map((r) => [r.drugId, { on: !r.onOrder && r.supplierId !== null, packs: String(r.packs), supplierId: r.supplierId ?? "", unitCost: r.lastUnitCost ?? "" }])),
  );
  const [pending, setPending] = useState(false);
  const set = (id: string, patch: Partial<Choice>) => setChoices((prev) => ({ ...prev, [id]: { ...prev[id]!, ...patch } }));

  const picked = rows
    .filter((r) => choices[r.drugId]?.on)
    .map((r) => {
      const c = choices[r.drugId]!;
      const packs = Number(c.packs);
      return { row: r, c, packs, units: packs * Math.max(1, r.packSize) };
    });
  const invalid = picked.some((p) => !p.c.supplierId || !Number.isInteger(p.packs) || p.packs < 1 || (p.c.unitCost !== "" && !/^\d+(\.\d{1,2})?$/.test(p.c.unitCost)));
  const orders = new Set(picked.map((p) => p.c.supplierId)).size;
  const value = picked.reduce((s, p) => s + (p.c.unitCost ? toMinor(p.c.unitCost) * p.units : 0), 0);

  async function submit() {
    setPending(true);
    const result = await createReorderDraftsAction({
      picks: picked.map((p) => ({ drugId: p.row.drugId, supplierId: p.c.supplierId, units: p.units, unitCost: p.c.unitCost || undefined })),
    });
    setPending(false);
    if (!result.ok) return toast.error(result.fieldErrors ? Object.values(result.fieldErrors)[0] : result.error);
    toast.success(result.data.length === 1 ? `Draft order ${result.data[0]!.number} raised` : `${result.data.length} draft orders raised`);
    router.push(result.data.length === 1 ? `/pharmacy/purchases/${result.data[0]!.id}` : "/pharmacy/purchases");
  }

  return (
    <div className="space-y-4">
      <ul className="divide-y divide-zinc-100 overflow-hidden rounded-3xl border border-zinc-200/70 bg-white/80 shadow-sm dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900/70">
        {rows.map((r) => {
          const c = choices[r.drugId]!;
          return (
            <li key={r.drugId} className={cn("grid items-center gap-3 px-5 py-4 lg:grid-cols-[auto_1fr_6rem_12rem_7rem]", !c.on && "opacity-70")}>
              <input type="checkbox" aria-label={`Order ${r.name}`} checked={c.on} onChange={(e) => set(r.drugId, { on: e.target.checked })} className="h-4 w-4 accent-(--accent)" />
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-zinc-900 dark:text-zinc-100">
                  {r.name}
                  {r.onHand === 0 ? <StatusBadge tone="danger">Out of stock</StatusBadge> : r.reason === "running_out" ? <StatusBadge tone="warning">Running out</StatusBadge> : <StatusBadge tone="warning">Below reorder level</StatusBadge>}
                  {r.onOrder && <StatusBadge tone="info">Already on an order</StatusBadge>}
                </p>
                <p className="text-xs text-zinc-500">
                  {r.onHand} {unitWord(r.form, r.onHand)} on hand · reorder at {r.reorderLevel} · selling {r.daily}/day · suggested {r.packs} {packWord(r.form, r.packs)} of {r.packSize}
                </p>
              </div>
              <label className="text-xs text-zinc-500">
                {packWord(r.form, 2)}
                <input type="number" min={1} value={c.packs} onChange={(e) => set(r.drugId, { packs: e.target.value })} className={cn(inputClass, "mt-1 h-10")} />
              </label>
              <label className="text-xs text-zinc-500">
                Supplier
                <select value={c.supplierId} onChange={(e) => set(r.drugId, { supplierId: e.target.value })} className={cn(inputClass, "mt-1 h-10 pr-8", c.on && !c.supplierId && "border-red-400")}>
                  <option value="">Choose…</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-zinc-500">
                Cost / {unitWord(r.form)}
                <input inputMode="decimal" value={c.unitCost} placeholder="—" onChange={(e) => set(r.drugId, { unitCost: e.target.value })} className={cn(inputClass, "mt-1 h-10")} />
              </label>
            </li>
          );
        })}
      </ul>
      <div className="sticky bottom-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-zinc-200 bg-white/95 px-5 py-3 shadow-lg backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/95">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {picked.length} items · {orders} {orders === 1 ? "order" : "orders"}
          {value > 0 && ` · about ${formatMoney(fromMinor(value), currency)} before GST`}
        </p>
        <button type="button" onClick={submit} disabled={pending || invalid || picked.length === 0} className={buttonClass("primary", "md")}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Truck className="h-4 w-4" />}
          Raise draft orders
        </button>
      </div>
    </div>
  );
}
