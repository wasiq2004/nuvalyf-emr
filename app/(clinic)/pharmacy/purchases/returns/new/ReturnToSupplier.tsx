"use client";

// Send stock back to a supplier: choose the supplier, the batches and how many
// units, and a debit note is issued at the batch's purchase cost plus GST.
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, PackageMinus, Search } from "lucide-react";
import { buttonClass } from "@/components/app/buttons";
import { Panel } from "@/components/app/page";
import { StatusBadge } from "@/components/app/status-badge";
import { inputClass } from "@/components/app/styles";
import { purchaseReturnAction } from "@/features/pharmacy/returns.actions";
import { purchaseReturnValue } from "@/features/pharmacy/return-rules";
import { formatDate } from "@/lib/format";
import { formatMoney, fromMinor, toMinor } from "@/lib/money";
import { cn } from "@/lib/utils";

export type ReturnBatch = {
  batchId: string;
  drugName: string;
  batchNo: string;
  expiryDate: string;
  expired: boolean;
  onHand: number;
  unitCost: string | null;
  gstRate: string;
  supplierId: string | null;
};

export function ReturnToSupplier({ suppliers, batches, currency }: { suppliers: { id: string; name: string }[]; batches: ReturnBatch[]; currency: string }) {
  const router = useRouter();
  const [supplierId, setSupplierId] = useState("");
  const [everything, setEverything] = useState(false);
  const [expiredOnly, setExpiredOnly] = useState(false);
  const [query, setQuery] = useState("");
  const [qty, setQty] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [key] = useState(() => crypto.randomUUID());
  const [pending, setPending] = useState(false);
  const money = (v: string) => formatMoney(v, currency);

  const shown = useMemo(() => {
    const term = query.trim().toLowerCase();
    return batches.filter(
      (b) =>
        (everything || !supplierId || b.supplierId === supplierId) &&
        (!expiredOnly || b.expired) &&
        (!term || b.drugName.toLowerCase().includes(term) || b.batchNo.toLowerCase().includes(term)),
    );
  }, [batches, supplierId, everything, expiredOnly, query]);

  const picked = batches
    .map((b) => ({ ...b, n: Number(qty[b.batchId] || 0) }))
    .filter((b) => b.n !== 0)
    .map((b) => ({ ...b, ...purchaseReturnValue(toMinor(b.unitCost ?? "0"), Number.isInteger(b.n) ? b.n : 0, Number(b.gstRate)) }));
  const bad = picked.some((b) => !Number.isInteger(b.n) || b.n < 0 || b.n > b.onHand);
  const taxable = picked.reduce((s, b) => s + b.taxable, 0);
  const tax = picked.reduce((s, b) => s + b.tax, 0);

  async function submit() {
    setPending(true);
    const result = await purchaseReturnAction({ supplierId, reason, idempotencyKey: key, lines: picked.map((b) => ({ batchId: b.batchId, quantity: b.n })) });
    setPending(false);
    if (!result.ok) return toast.error(result.fieldErrors ? Object.values(result.fieldErrors)[0] : result.error);
    toast.success(`Debit note ${result.data.number} for ${money(result.data.total)}`);
    router.push(`/pharmacy/purchases/returns/${result.data.returnId}`);
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_20rem]">
      <Panel flush title="Batches on hand" description="Expired stock is listed first. Batches are matched to the supplier whose bill brought them in.">
        <div className="flex flex-wrap items-center gap-3 border-b border-zinc-100 px-6 py-4 dark:border-zinc-800">
          <div className="relative min-w-56 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" aria-hidden />
            <input type="search" aria-label="Filter batches" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Medicine or batch" className={cn(inputClass, "h-10 pl-9")} />
          </div>
          <label className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
            <input type="checkbox" checked={expiredOnly} onChange={(e) => setExpiredOnly(e.target.checked)} className="h-4 w-4 accent-(--accent)" /> Expired only
          </label>
          {supplierId && (
            <label className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
              <input type="checkbox" checked={everything} onChange={(e) => setEverything(e.target.checked)} className="h-4 w-4 accent-(--accent)" /> Other suppliers&apos; batches too
            </label>
          )}
        </div>
        {shown.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-zinc-500">{supplierId ? "Nothing on hand came from this supplier." : "No stock on hand."}</p>
        ) : (
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {shown.map((b) => {
              const n = Number(qty[b.batchId] || 0);
              return (
                <li key={b.batchId} className="grid items-center gap-3 px-6 py-3 sm:grid-cols-[1fr_auto_7rem]">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-zinc-900 dark:text-zinc-100">
                      {b.drugName} {b.expired && <StatusBadge tone="danger">Expired</StatusBadge>}
                    </p>
                    <p className="text-xs text-zinc-500">
                      Batch {b.batchNo} · exp {formatDate(b.expiryDate, "UTC")} · {b.onHand} on hand
                    </p>
                  </div>
                  <p className="text-right text-xs text-zinc-500 tabular-nums">
                    {b.unitCost ? `${money(b.unitCost)} + ${Number(b.gstRate)} %` : "No cost recorded"}
                  </p>
                  <input
                    aria-label={`Units of ${b.drugName} batch ${b.batchNo} to return`}
                    type="number"
                    min={0}
                    max={b.onHand}
                    placeholder="0"
                    value={qty[b.batchId] ?? ""}
                    onChange={(e) => setQty((prev) => ({ ...prev, [b.batchId]: e.target.value }))}
                    className={cn(inputClass, "h-10", (n > b.onHand || n < 0) && "border-red-400")}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <Panel title="Debit note" className="h-fit xl:sticky xl:top-6">
        <div className="space-y-4">
          <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Supplier
            <select
              value={supplierId}
              onChange={(e) => {
                setSupplierId(e.target.value);
                setEverything(false);
              }}
              className={cn(inputClass, "mt-1.5 h-11 pr-8")}
            >
              <option value="">Choose…</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Reason
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Expired, damaged in transit" className={cn(inputClass, "mt-1.5 h-11")} />
          </label>
          <dl className="space-y-1.5 border-t border-zinc-100 pt-4 text-sm dark:border-zinc-800">
            <div className="flex justify-between">
              <dt className="text-zinc-500">Lines</dt>
              <dd className="tabular-nums">{picked.length}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-zinc-500">Taxable value</dt>
              <dd className="tabular-nums">{money(fromMinor(taxable))}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-zinc-500">GST</dt>
              <dd className="tabular-nums">{money(fromMinor(tax))}</dd>
            </div>
            <div className="flex justify-between text-base font-semibold">
              <dt>Total</dt>
              <dd className="tabular-nums">{money(fromMinor(taxable + tax))}</dd>
            </div>
          </dl>
          <button type="button" onClick={submit} disabled={pending || bad || picked.length === 0 || !supplierId || !reason.trim()} className={cn(buttonClass("primary", "md"), "w-full")}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackageMinus className="h-4 w-4" />}
            Return &amp; issue debit note
          </button>
          <p className="text-xs text-zinc-500">The units leave stock now, and the value comes off what is owed to the supplier.</p>
        </div>
      </Panel>
    </div>
  );
}
