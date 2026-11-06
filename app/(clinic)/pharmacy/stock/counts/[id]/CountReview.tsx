"use client";

// After counting: only now do the system's figures appear. Differences get a
// recount and a reason, then post through the ledger together.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2, Loader2, PackageMinus, PackagePlus, TriangleAlert } from "lucide-react";
import { buttonClass } from "@/components/app/buttons";
import { ConfirmAction } from "@/components/app/dialogs";
import { Panel, StatCard } from "@/components/app/page";
import { inputClass } from "@/components/app/form";
import { StatusBadge } from "@/components/app/status-badge";
import { cancelStockCountAction, postStockCountAction, saveStockReviewAction } from "@/features/pharmacy/stock-count.actions";
import { COUNT_REASONS, COUNT_REASON_KEYS, type CountReason } from "@/features/pharmacy/stock-count-rules";
import { formatMoney, fromMinor, toMinor } from "@/lib/money";
import { cn } from "@/lib/utils";

export type ReviewLine = {
  id: string;
  name: string;
  rack: string | null;
  batchNo: string;
  expiryDate: string;
  found: boolean;
  firstCount: number | null;
  firstByName: string | null;
  recount: number | null;
  change: number | null;
  reason: string | null;
  note: string | null;
  value: string;
};

const NUMBER = /^\d{1,7}$/;

export function CountReview({ countId, lines, currency }: { countId: string; lines: ReviewLine[]; currency: string }) {
  const router = useRouter();
  const differing = lines.filter((l) => l.change);
  const matched = lines.filter((l) => l.change === 0).length;
  const uncounted = lines.filter((l) => l.change === null).length;
  const [edits, setEdits] = useState<Record<string, { recount: string; reason: string; note: string }>>(() =>
    Object.fromEntries(differing.map((l) => [l.id, { recount: l.recount === null ? "" : String(l.recount), reason: l.reason ?? "", note: l.note ?? "" }])),
  );
  const [busy, setBusy] = useState(false);

  const patch = (id: string, change: Partial<{ recount: string; reason: string; note: string }>) => setEdits((prev) => ({ ...prev, [id]: { ...prev[id], ...change } }));
  const short = differing.filter((l) => (l.change ?? 0) < 0).reduce((s, l) => s + toMinor(l.value), 0);
  const over = differing.filter((l) => (l.change ?? 0) > 0).reduce((s, l) => s + toMinor(l.value), 0);
  const incomplete = differing.some((l) => !edits[l.id]?.reason || (edits[l.id].reason === "other" && !edits[l.id].note.trim()) || (edits[l.id].recount.trim() && !NUMBER.test(edits[l.id].recount.trim())));
  const recounting = differing.some((l) => edits[l.id]?.recount.trim() !== (l.recount === null ? "" : String(l.recount)));

  async function save() {
    const entries = differing.map((l) => {
      const e = edits[l.id];
      return { lineId: l.id, recount: e.recount.trim() ? Number(e.recount) : null, reason: (e.reason || null) as CountReason | null, note: e.note.trim() || null };
    });
    return saveStockReviewAction({ countId, entries });
  }

  async function recountNow() {
    setBusy(true);
    const result = await save();
    setBusy(false);
    if (!result.ok) return toast.error(result.error);
    toast.success("Recounts saved");
    router.refresh();
  }

  async function post() {
    setBusy(true);
    const saved = await save();
    if (!saved.ok) {
      setBusy(false);
      return toast.error(saved.error);
    }
    const result = await postStockCountAction({ countId });
    setBusy(false);
    if (!result.ok) return toast.error(result.error);
    toast.success(result.data.adjusted ? `Posted: ${result.data.adjusted} batches corrected` : "Posted: everything matched");
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-5 sm:grid-cols-4">
        <StatCard label="Matched" value={matched} icon={CheckCircle2} />
        <StatCard label="Differ" value={differing.length} icon={TriangleAlert} hint={uncounted ? `${uncounted} not counted, left as they are` : undefined} />
        <StatCard label="Short, at cost" value={formatMoney(fromMinor(short), currency)} icon={PackageMinus} />
        <StatCard label="Over, at cost" value={formatMoney(fromMinor(over), currency)} icon={PackagePlus} />
      </div>

      {differing.length === 0 ? (
        <Panel title="Everything counted matched the ledger">
          <p className="text-sm text-zinc-500">Post the count to record that these batches were checked.</p>
        </Panel>
      ) : (
        <Panel flush title="Differences" description="Have someone else recount these before accepting them. A recount replaces the first count; both are kept.">
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {differing.map((line) => {
              const e = edits[line.id];
              return (
                <li key={line.id} className="space-y-3 px-6 py-4 lg:px-8">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{line.name}</p>
                      <p className="text-xs text-zinc-500">
                        {[line.rack ? `Rack ${line.rack}` : null, `Batch ${line.batchNo}`, `exp ${line.expiryDate.slice(0, 7)}`, line.firstByName ? `counted by ${line.firstByName}` : null, line.found ? "found on the shelf" : null].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm tabular-nums text-zinc-500">{formatMoney(line.value, currency)}</span>
                      <StatusBadge tone={(line.change ?? 0) < 0 ? "danger" : "success"}>{(line.change ?? 0) > 0 ? `+${line.change}` : line.change}</StatusBadge>
                    </div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-[10rem_6.5rem_12rem_minmax(0,1fr)]">
                    <p className="flex h-10 items-center whitespace-nowrap text-sm tabular-nums text-zinc-600 dark:text-zinc-400">
                      Counted {line.recount ?? line.firstCount}, system {(line.recount ?? line.firstCount ?? 0) - (line.change ?? 0)}
                    </p>
                    <input aria-label={`Recount of ${line.name} batch ${line.batchNo}`} inputMode="numeric" placeholder="Recount" value={e.recount} onChange={(ev) => patch(line.id, { recount: ev.target.value })} className={cn(inputClass, "h-10 text-right")} />
                    <select aria-label={`Why ${line.name} batch ${line.batchNo} differs`} value={e.reason} onChange={(ev) => patch(line.id, { reason: ev.target.value })} className={cn(inputClass, "h-10")}>
                      <option value="">Why does it differ?</option>
                      {COUNT_REASON_KEYS.map((key) => (
                        <option key={key} value={key}>
                          {COUNT_REASONS[key]}
                        </option>
                      ))}
                    </select>
                    <input aria-label={`Note on ${line.name} batch ${line.batchNo}`} placeholder="Note" maxLength={300} value={e.note} onChange={(ev) => patch(line.id, { note: ev.target.value })} className={cn(inputClass, "h-10")} />
                  </div>
                </li>
              );
            })}
          </ul>
        </Panel>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
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
        <div className="flex gap-2">
          {recounting && (
            <button type="button" disabled={busy} onClick={recountNow} className={buttonClass("secondary", "md")}>
              Save recounts
            </button>
          )}
          <button type="button" disabled={busy || incomplete || recounting} onClick={post} className={buttonClass("primary", "md")}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} Post count
          </button>
        </div>
      </div>
    </div>
  );
}
