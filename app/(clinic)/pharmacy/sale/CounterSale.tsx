"use client";

// Over-the-counter sale: search stock, build a basket (earliest-expiry batch
// by default), loose or by the strip, take payment. The sale is sent once with its own key, so a
// double-click or a retry never sells twice.
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Pill, Search, Trash2 } from "lucide-react";
import { inputClass } from "@/components/app/form";
import { buttonClass } from "@/components/app/buttons";
import { EmptyState } from "@/components/app/page";
import { counterSaleAction, searchSellableAction } from "@/features/pharmacy/pharmacy.actions";
import type { SellableDrug } from "@/features/pharmacy/sales.service";
import { PAYMENT_METHOD_LABELS, PAYMENT_METHODS } from "@/features/billing/billing-rules";
import { toMinor } from "@/lib/money";
import { packWord, sellingPrice, unitWord, unitsFor, type SoldAs } from "@/features/pharmacy/selling-rules";
import { cn } from "@/lib/utils";

type Line = { drug: SellableDrug; batchId: string; quantity: string; soldAs: SoldAs };

const capitalize = (v: string) => v.charAt(0).toUpperCase() + v.slice(1);

export function CounterSale({ locale, currency }: { locale: string; currency: string }) {
  const router = useRouter();
  const [key] = useState(() => crypto.randomUUID());
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SellableDrug[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [method, setMethod] = useState("cash");
  const [reference, setReference] = useState("");
  const [pending, setPending] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef(0);

  const money = (minor: number) => new Intl.NumberFormat(locale, { style: "currency", currency }).format(minor / 100);

  function onQuery(value: string) {
    setQuery(value);
    clearTimeout(timer.current);
    if (!value.trim()) {
      setResults([]);
      return;
    }
    const request = ++latest.current;
    timer.current = setTimeout(async () => {
      const result = await searchSellableAction({ query: value });
      if (request !== latest.current) return;
      if (result.ok) setResults(result.data);
      else toast.error(result.error);
    }, 200);
  }

  function add(drug: SellableDrug) {
    setLines((prev) => [...prev, { drug, batchId: drug.batches[0].id, quantity: "1", soldAs: "unit" }]);
    setQuery("");
    setResults([]);
  }

  const priced = lines.map((l) => {
    const qty = Number(l.quantity);
    const price = sellingPrice(l.drug, l.soldAs);
    const ok = Number.isInteger(qty) && qty > 0;
    const units = ok ? unitsFor(qty, l.soldAs, l.drug.packSize) : 0;
    const inBatch = l.drug.batches.find((b) => b.id === l.batchId)?.quantity ?? 0;
    return { ...l, qty, price, units, short: units > inBatch, amount: price && ok ? toMinor(price) * qty : 0 };
  });
  const total = priced.reduce((sum, l) => sum + l.amount, 0);
  const valid = priced.length > 0 && priced.every((l) => l.price && Number.isInteger(l.qty) && l.qty > 0 && !l.short);

  async function complete() {
    setPending(true);
    const result = await counterSaleAction({
      lines: priced.map((l) => ({ drugId: l.drug.drugId, batchId: l.batchId, quantity: l.qty, soldAs: l.soldAs })),
      customerName,
      customerPhone,
      method,
      reference,
      idempotencyKey: key,
    });
    if (!result.ok) {
      setPending(false);
      toast.error(result.fieldErrors ? Object.values(result.fieldErrors)[0] : result.error);
      return;
    }
    toast.success(`Sale ${result.data.number} complete`);
    router.push(`/pharmacy/sales/${result.data.saleId}`);
  }

  return (
    <div className="grid gap-6 xl:grid-cols-3">
      <div className="min-w-0 space-y-4 xl:col-span-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" aria-hidden />
          <input
            type="search"
            aria-label="Search stock"
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder="Search a medicine in stock"
            className={cn(inputClass, "h-12 pl-10 text-base")}
            autoFocus
          />
          {results.length > 0 && (
            <ul className="absolute z-20 mt-2 max-h-80 w-full divide-y divide-zinc-100 overflow-y-auto rounded-2xl border border-zinc-200 bg-white shadow-xl dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
              {results.map((r) => (
                <li key={r.drugId}>
                  <button type="button" onClick={() => add(r)} className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800/60">
                    <span className="flex min-w-0 items-center gap-3">
                      <Pill className="h-4 w-4 flex-shrink-0 text-(--accent-text)" />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">{r.name}</span>
                        <span className="block truncate text-xs text-zinc-500">
                          {r.genericName} · {r.batches.reduce((n, b) => n + b.quantity, 0)} in stock
                        </span>
                      </span>
                    </span>
                    <span className="text-sm tabular-nums text-zinc-700 dark:text-zinc-300">{r.price ? money(toMinor(r.price)) : "No price"}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {lines.length === 0 ? (
          <EmptyState icon={Pill} title="Basket is empty" description="Search above and pick a medicine to add it." />
        ) : (
          <ul className="space-y-3">
            {priced.map((line, index) => (
              <li key={`${line.drug.drugId}-${index}`} className="space-y-3 rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-zinc-900 dark:text-zinc-100">{line.drug.name}</p>
                    <p className="text-xs text-zinc-500">
                      {line.price ? `${money(toMinor(line.price))} per ${line.soldAs === "pack" ? packWord(line.drug.form) : unitWord(line.drug.form)}` : "No selling price set"}
                      {line.soldAs === "pack" && line.units > 0 ? ` · ${line.units} ${unitWord(line.drug.form, line.units)}` : ""}
                    </p>
                    {line.short && <p className="text-xs font-medium text-red-600 dark:text-red-400">More than this batch holds</p>}
                  </div>
                  <div className="flex items-center gap-2">
                    <p className="text-right text-sm font-semibold tabular-nums">{money(line.amount)}</p>
                    <button
                      type="button"
                      onClick={() => setLines((prev) => prev.filter((_, i) => i !== index))}
                      className={buttonClass("ghost", "sm", "px-2")}
                      aria-label={`Remove ${line.drug.name}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,11rem)_6rem]">
                  <select
                    aria-label={`Batch for ${line.drug.name}`}
                    value={line.batchId}
                    onChange={(e) => setLines((prev) => prev.map((l, i) => (i === index ? { ...l, batchId: e.target.value } : l)))}
                    className={cn(inputClass, "h-10")}
                  >
                    {line.drug.batches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.batchNo} · exp {b.expiryDate} · {b.quantity} {unitWord(line.drug.form, b.quantity)}
                      </option>
                    ))}
                  </select>
                  {line.drug.packSize > 1 ? (
                    <select
                      aria-label={`Sell ${line.drug.name} as`}
                      value={line.soldAs}
                      onChange={(e) => setLines((prev) => prev.map((l, i) => (i === index ? { ...l, soldAs: e.target.value as SoldAs } : l)))}
                      className={cn(inputClass, "h-10")}
                    >
                      <option value="unit">{capitalize(unitWord(line.drug.form, 2))}</option>
                      <option value="pack">
                        {capitalize(packWord(line.drug.form, 2))} of {line.drug.packSize}
                      </option>
                    </select>
                  ) : (
                    <span className="flex h-10 items-center text-sm text-zinc-500">{capitalize(unitWord(line.drug.form, 2))}</span>
                  )}
                  <input
                    aria-label={`Quantity of ${line.drug.name}`}
                    type="number"
                    min={1}
                    value={line.quantity}
                    onChange={(e) => setLines((prev) => prev.map((l, i) => (i === index ? { ...l, quantity: e.target.value } : l)))}
                    className={cn(inputClass, "h-10")}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-4 rounded-3xl border border-zinc-200/70 bg-white/95 p-6 shadow-xl shadow-zinc-200/40 dark:border-zinc-800 dark:bg-zinc-900/90 dark:shadow-none">
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-white">Payment</h2>
        <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Customer name
          <input value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Optional" className={cn(inputClass, "mt-1.5 h-11")} />
        </label>
        <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Phone
          <input value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} placeholder="Optional" className={cn(inputClass, "mt-1.5 h-11")} />
        </label>
        <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Paid by
          <select value={method} onChange={(e) => setMethod(e.target.value)} className={cn(inputClass, "mt-1.5 h-11")}>
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {PAYMENT_METHOD_LABELS[m]}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Reference
          <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="UPI / card ref (optional)" className={cn(inputClass, "mt-1.5 h-11")} />
        </label>
        <div className="flex items-baseline justify-between border-t border-zinc-100 pt-4 dark:border-zinc-800">
          <span className="text-sm text-zinc-500">Total</span>
          <span className="text-3xl font-bold tabular-nums text-zinc-900 dark:text-zinc-50">{money(total)}</span>
        </div>
        <button type="button" onClick={complete} disabled={!valid || pending} className={buttonClass("primary", "lg", "w-full")}>
          {pending && <Loader2 className="h-4 w-4 animate-spin" />}
          Complete sale
        </button>
      </div>
    </div>
  );
}
