"use client";

// Choose items and how many labels each; items without a barcode can be given
// a clinic code first so their labels scan at the counter.
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Barcode, Loader2, Printer, Search } from "lucide-react";
import { buttonClass } from "@/components/app/buttons";
import { inputClass } from "@/components/app/styles";
import { assignBarcodesAction } from "@/features/pharmacy/stock-tools.actions";
import { cn } from "@/lib/utils";

export type LabelRow = { id: string; name: string; detail: string; rack: string | null; barcode: string | null; onHand: number };

const MAX_ITEMS = 150;

export function LabelPicker({ rows, canAssign }: { rows: LabelRow[]; canAssign: boolean }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [rack, setRack] = useState("");
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [assigning, setAssigning] = useState(false);

  const racks = useMemo(() => [...new Set(rows.map((r) => r.rack).filter((r): r is string => Boolean(r)))].sort(), [rows]);
  const shown = rows.filter((r) => (!rack || r.rack === rack) && (!query.trim() || `${r.name} ${r.barcode ?? ""}`.toLowerCase().includes(query.trim().toLowerCase())));
  const chosen = rows.filter((r) => picked[r.id] !== undefined);
  const missing = chosen.filter((r) => !r.barcode);
  const labels = chosen.reduce((s, r) => s + Math.max(1, Math.floor(Number(picked[r.id]) || 1)), 0);
  const allShown = shown.length > 0 && shown.every((r) => picked[r.id] !== undefined);

  function toggle(id: string, on: boolean) {
    setPicked((prev) => {
      const next = { ...prev };
      if (on) next[id] = prev[id] ?? "1";
      else delete next[id];
      return next;
    });
  }

  async function assign() {
    setAssigning(true);
    const result = await assignBarcodesAction({ drugIds: missing.map((r) => r.id) });
    setAssigning(false);
    if (!result.ok) return toast.error(result.error);
    toast.success(`${result.data.assigned} items given a clinic barcode`);
    router.refresh();
  }

  const href = `/pharmacy/stock/labels/pdf?items=${chosen.map((r) => `${r.id}.${Math.max(1, Math.floor(Number(picked[r.id]) || 1))}`).join(",")}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" aria-hidden />
          <input type="search" aria-label="Filter items" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Item or barcode" className={cn(inputClass, "h-10 pl-9")} />
        </div>
        {racks.length > 0 && (
          <select aria-label="Rack" value={rack} onChange={(e) => setRack(e.target.value)} className={cn(inputClass, "h-10 w-40 pr-8")}>
            <option value="">All racks</option>
            {racks.map((r) => (
              <option key={r} value={r}>
                Rack {r}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="overflow-hidden rounded-3xl border border-zinc-200/70 bg-white/80 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/70">
        <label className="flex items-center gap-3 border-b border-zinc-100 px-5 py-3 text-sm font-medium text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
          <input type="checkbox" checked={allShown} onChange={(e) => shown.slice(0, MAX_ITEMS).forEach((r) => toggle(r.id, e.target.checked))} className="h-4 w-4 accent-(--accent)" />
          {shown.length} items{rack ? ` on rack ${rack}` : ""}
        </label>
        <ul className="max-h-[60vh] divide-y divide-zinc-100 overflow-y-auto dark:divide-zinc-800">
          {shown.map((r) => {
            const on = picked[r.id] !== undefined;
            return (
              <li key={r.id} className="grid items-center gap-3 px-5 py-3 sm:grid-cols-[auto_1fr_auto_5rem]">
                <input type="checkbox" aria-label={`Label ${r.name}`} checked={on} onChange={(e) => toggle(r.id, e.target.checked)} className="h-4 w-4 accent-(--accent)" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">{r.name}</p>
                  <p className="truncate text-xs text-zinc-500">
                    {r.detail} · {r.onHand} on hand{r.rack ? ` · rack ${r.rack}` : ""}
                  </p>
                </div>
                <span className={cn("font-mono text-xs", r.barcode ? "text-zinc-600 dark:text-zinc-300" : "text-amber-700 dark:text-amber-400")}>{r.barcode ?? "No barcode"}</span>
                <input
                  type="number"
                  min={1}
                  max={50}
                  aria-label={`Copies of ${r.name}`}
                  disabled={!on}
                  value={picked[r.id] ?? ""}
                  placeholder="—"
                  onChange={(e) => setPicked((prev) => ({ ...prev, [r.id]: e.target.value }))}
                  className={cn(inputClass, "h-9")}
                />
              </li>
            );
          })}
        </ul>
      </div>

      <div className="sticky bottom-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-zinc-200 bg-white/95 px-5 py-3 shadow-lg backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/95">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {chosen.length} items · {labels} labels ({Math.max(1, Math.ceil(labels / 24))} {labels > 24 ? "sheets" : "sheet"} of 24)
          {chosen.length > MAX_ITEMS && <span className="text-red-600"> · at most {MAX_ITEMS} items at a time</span>}
        </p>
        <div className="flex flex-wrap gap-2">
          {canAssign && missing.length > 0 && (
            <button type="button" onClick={assign} disabled={assigning} className={buttonClass("secondary", "md")}>
              {assigning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Barcode className="h-4 w-4" />}
              Give {missing.length} a clinic barcode
            </button>
          )}
          <a
            href={chosen.length && chosen.length <= MAX_ITEMS ? href : undefined}
            target="_blank"
            rel="noopener"
            aria-disabled={chosen.length === 0 || chosen.length > MAX_ITEMS}
            className={cn(buttonClass("primary", "md"), (chosen.length === 0 || chosen.length > MAX_ITEMS) && "pointer-events-none opacity-50")}
          >
            <Printer className="h-4 w-4" /> Labels PDF
          </a>
        </div>
      </div>
    </div>
  );
}
