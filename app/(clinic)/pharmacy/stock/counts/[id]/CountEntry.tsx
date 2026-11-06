"use client";

// The blind count: what to look for and a box to write in. The expected
// figure is not on this page, or anywhere in what the browser received.
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, PackageSearch } from "lucide-react";
import { buttonClass } from "@/components/app/buttons";
import { ConfirmAction } from "@/components/app/dialogs";
import { Panel } from "@/components/app/page";
import { inputClass } from "@/components/app/form";
import { ScheduleBadge } from "@/components/pharmacy/badges";
import { ItemSearch } from "@/components/pharmacy/item-search";
import { searchBillItemsAction } from "@/features/pharmacy/pharmacy.actions";
import { addFoundBatchAction, cancelStockCountAction, saveStockCountAction, submitStockCountAction } from "@/features/pharmacy/stock-count.actions";
import type { BlindLine } from "@/features/pharmacy/stock-count.service";
import type { ItemOption } from "@/features/catalog/items.service";
import { unitWord } from "@/features/pharmacy/selling-rules";
import { normalizeExpiry } from "@/features/pharmacy/purchase-rules";
import { cn } from "@/lib/utils";

const NUMBER = /^\d{1,7}$/;

export function CountEntry({ countId, lines }: { countId: string; lines: BlindLine[] }) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(lines.map((l) => [l.id, l.firstCount === null ? "" : String(l.firstCount)])));
  const [rack, setRack] = useState("all");
  const [saving, setSaving] = useState(false);
  const racks = useMemo(() => [...new Set(lines.map((l) => l.rack ?? "No rack"))], [lines]);
  const shown = lines.filter((l) => rack === "all" || (l.rack ?? "No rack") === rack);
  const dirty = lines.some((l) => values[l.id] !== (l.firstCount === null ? "" : String(l.firstCount)));
  const bad = lines.find((l) => values[l.id]?.trim() && !NUMBER.test(values[l.id].trim()));
  const done = lines.filter((l) => values[l.id]?.trim()).length;

  // A half-counted rack must not vanish with a closed tab.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  async function save() {
    setSaving(true);
    const entries = lines.map((l) => ({ lineId: l.id, counted: values[l.id]?.trim() ? Number(values[l.id]) : null }));
    const result = await saveStockCountAction({ countId, entries });
    setSaving(false);
    if (!result.ok) {
      toast.error(result.error);
      return false;
    }
    toast.success("Counts saved");
    router.refresh();
    return true;
  }

  return (
    <div className="space-y-6">
      <Panel
        flush
        title="Count what is on the shelf"
        description="In single units, not strips. Leave blank anything you have not reached. Save as you go: each count is matched against the ledger at that moment."
        actions={
          racks.length > 1 ? (
            <select aria-label="Show rack" value={rack} onChange={(e) => setRack(e.target.value)} className={cn(inputClass, "h-10 w-40")}>
              <option value="all">All racks</option>
              {racks.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          ) : undefined
        }
      >
        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {shown.map((line) => (
            <li key={line.id} className="grid grid-cols-[minmax(0,1fr)_6.5rem] items-center gap-3 px-6 py-3 lg:px-8">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-zinc-900 dark:text-zinc-100">
                  <span className="truncate">{line.name}</span>
                  <ScheduleBadge schedule={line.schedule} />
                </p>
                <p className="text-xs text-zinc-500">
                  {[line.rack ? `Rack ${line.rack}` : null, `Batch ${line.batchNo}`, `exp ${line.expiryDate.slice(0, 7)}`, line.packSize > 1 ? `${line.packSize} per pack` : null, line.found ? "Found on the shelf" : null].filter(Boolean).join(" · ")}
                </p>
              </div>
              <input
                aria-label={`Count of ${line.name} batch ${line.batchNo}`}
                inputMode="numeric"
                placeholder={unitWord(line.form, 2)}
                value={values[line.id] ?? ""}
                onChange={(e) => setValues((prev) => ({ ...prev, [line.id]: e.target.value }))}
                className={cn(inputClass, "h-10 text-right")}
              />
            </li>
          ))}
        </ul>
      </Panel>

      {bad && <p className="text-sm text-red-600 dark:text-red-400">{bad.name}: enter a whole number of units.</p>}

      <FoundBatch
        countId={countId}
        onAdded={() => router.refresh()}
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <p className="text-sm text-zinc-500">
            {done} of {lines.length} counted
          </p>
          <ConfirmAction
            action={cancelStockCountAction}
            input={{ countId }}
            trigger="Cancel count"
            title="Cancel this count?"
            description="Nothing it holds will be applied to stock."
            confirmLabel="Cancel count"
            destructive
            onSuccess={() => router.push("/pharmacy/stock/counts")}
          />
        </div>
        <div className="flex gap-2">
          <button type="button" disabled={saving || Boolean(bad) || !dirty} onClick={save} className={buttonClass("secondary", "md")}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />} Save counts
          </button>
          <FinishButton countId={countId} disabled={saving || Boolean(bad) || done === 0} beforeSubmit={async () => (dirty ? save() : true)} missing={lines.length - done} />
        </div>
      </div>
    </div>
  );
}

function FinishButton({ countId, disabled, beforeSubmit, missing }: { countId: string; disabled: boolean; beforeSubmit: () => Promise<boolean>; missing: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [warned, setWarned] = useState(false);
  async function finish() {
    // Uncounted batches are left as they are, which should be a choice, not a slip.
    if (missing > 0 && !warned) return setWarned(true);
    setBusy(true);
    const saved = await beforeSubmit();
    if (!saved) return setBusy(false);
    const result = await submitStockCountAction({ countId });
    setBusy(false);
    if (!result.ok) return toast.error(result.error);
    router.refresh();
  }
  return (
    <>
      {warned && missing > 0 && <p className="self-center text-sm text-amber-700 dark:text-amber-400">{missing} not counted will be left as they are.</p>}
      <button type="button" disabled={disabled || busy} onClick={finish} className={buttonClass("primary", "md")}>
        {busy && <Loader2 className="h-4 w-4 animate-spin" />} {warned && missing > 0 ? "Finish anyway" : "Finish counting"}
      </button>
    </>
  );
}

function FoundBatch({ countId, onAdded }: { countId: string; onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [item, setItem] = useState<ItemOption | null>(null);
  const [batchNo, setBatchNo] = useState("");
  const [expiry, setExpiry] = useState("");
  const [counted, setCounted] = useState("");
  const [busy, setBusy] = useState(false);

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={buttonClass("ghost", "sm")}>
        <PackageSearch className="h-4 w-4" /> Found something not listed
      </button>
    );
  }

  const expiryDate = normalizeExpiry(expiry);
  const ready = item && batchNo.trim() && /^\d{4}-\d{2}-\d{2}$/.test(expiryDate) && NUMBER.test(counted.trim());
  async function add() {
    if (!item) return;
    setBusy(true);
    const result = await addFoundBatchAction({ countId, drugId: item.id, batchNo, expiryDate, counted: Number(counted) });
    setBusy(false);
    if (!result.ok) return toast.error(result.error);
    toast.success(`${result.data.name} batch ${result.data.batchNo} added`);
    setItem(null);
    setBatchNo("");
    setExpiry("");
    setCounted("");
    setOpen(false);
    onAdded();
  }

  return (
    <Panel title="Found on the shelf" description="A batch this count did not list. Read the batch and expiry off the pack.">
      <div className="grid items-end gap-3 sm:grid-cols-[minmax(0,1.5fr)_8rem_7rem_6rem_auto]">
        <ItemSearch label="Item found" item={item} onPick={setItem} search={searchBillItemsAction} />
        <input aria-label="Batch" placeholder="Batch" value={batchNo} onChange={(e) => setBatchNo(e.target.value)} className={cn(inputClass, "h-10 uppercase placeholder:normal-case")} />
        <input aria-label="Expiry" placeholder="MM/YY" value={expiry} onChange={(e) => setExpiry(e.target.value)} className={cn(inputClass, "h-10")} />
        <input aria-label="Count" inputMode="numeric" placeholder="Units" value={counted} onChange={(e) => setCounted(e.target.value)} className={cn(inputClass, "h-10 text-right")} />
        <button type="button" disabled={!ready || busy} onClick={add} className={buttonClass("secondary", "md")}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" />} Add
        </button>
      </div>
    </Panel>
  );
}
