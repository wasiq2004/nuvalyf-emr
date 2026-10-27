"use client";

// Type in a supplier's bill as printed: per line the item, batch, expiry,
// packs, free packs, units per pack, rate, MRP and GST. Totals update as you
// type; saving books everything into stock in one step, once.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, PackageCheck, Plus, Trash2 } from "lucide-react";
import { inputClass } from "@/components/app/form";
import { buttonClass } from "@/components/app/buttons";
import { Panel } from "@/components/app/page";
import { ItemPicker } from "@/components/pharmacy/item-picker";
import { SupplierDialog } from "../../PurchaseForms";
import { enterBillAction } from "@/features/pharmacy/pharmacy.actions";
import { GST_RATES, billTotals, lineTotals, normalizeExpiry } from "@/features/pharmacy/purchase-rules";
import { isNewAlias } from "@/features/catalog/item-rules";
import type { ItemOption } from "@/features/catalog/items.service";
import { isValidDateString } from "@/lib/time";
import { cn } from "@/lib/utils";

type Line = {
  key: string;
  typed: string;
  item: ItemOption | null;
  rememberName: boolean;
  batchNo: string;
  expiry: string;
  quantity: string;
  freeQuantity: string;
  packSize: string;
  rate: string;
  mrp: string;
  gstRate: string;
};

const MONEY = /^\d{1,8}(\.\d{1,2})?$/;
const blankLine = (): Line => ({
  key: crypto.randomUUID(),
  typed: "",
  item: null,
  rememberName: false,
  batchNo: "",
  expiry: "",
  quantity: "",
  freeQuantity: "0",
  packSize: "1",
  rate: "",
  mrp: "",
  gstRate: "12",
});

const whole = (v: string, min: number) => /^\d+$/.test(v.trim()) && Number(v) >= min;

/** The line's problem, or null when it can be saved. */
function lineProblem(line: Line, today: string): string | null {
  if (!line.item) return "choose the item";
  if (!line.batchNo.trim()) return "enter the batch";
  const expiry = normalizeExpiry(line.expiry);
  if (!isValidDateString(expiry)) return "enter the expiry (MM/YY)";
  if (expiry < today) return "this batch has expired";
  if (!whole(line.quantity, 1)) return "enter the quantity";
  if (!whole(line.freeQuantity || "0", 0)) return "free must be a whole number";
  if (!whole(line.packSize, 1)) return "units per pack must be 1 or more";
  if (!MONEY.test(line.rate.trim())) return "enter the rate";
  if (line.mrp.trim() && !MONEY.test(line.mrp.trim())) return "MRP should be an amount";
  return null;
}

function asInput(line: Line) {
  return {
    quantity: Number(line.quantity) || 0,
    freeQuantity: Number(line.freeQuantity) || 0,
    packSize: Number(line.packSize) || 1,
    rate: MONEY.test(line.rate.trim()) ? line.rate.trim() : "0",
    mrp: MONEY.test(line.mrp.trim()) ? line.mrp.trim() : undefined,
    gstRate: Number(line.gstRate),
  };
}

export function BillEntry({
  suppliers,
  today,
  locale,
  currency,
  canAddItems,
  canAddSuppliers,
}: {
  suppliers: { id: string; name: string }[];
  today: string;
  locale: string;
  currency: string;
  canAddItems: boolean;
  canAddSuppliers: boolean;
}) {
  const router = useRouter();
  const [key] = useState(() => crypto.randomUUID());
  const [supplierId, setSupplierId] = useState(suppliers.length === 1 ? suppliers[0].id : "");
  const [billNo, setBillNo] = useState("");
  const [billDate, setBillDate] = useState(today);
  const [notes, setNotes] = useState("");
  const [updatePrices, setUpdatePrices] = useState(true);
  const [lines, setLines] = useState<Line[]>(() => [blankLine()]);
  const [pending, setPending] = useState(false);

  const money = (amount: string) => new Intl.NumberFormat(locale, { style: "currency", currency }).format(Number(amount));
  const set = (index: number, patch: Partial<Line>) => setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));

  const problems = lines.map((l) => lineProblem(l, today));
  const totals = billTotals(lines.map(asInput));
  const headerProblem = !supplierId ? "Choose the supplier" : !billNo.trim() ? "Enter the bill number" : !billDate ? "Enter the bill date" : null;
  const firstLineProblem = problems.findIndex(Boolean);
  const ready = !headerProblem && firstLineProblem === -1;

  async function save() {
    setPending(true);
    const result = await enterBillAction({
      supplierId,
      billNo,
      billDate,
      notes,
      updatePrices,
      idempotencyKey: key,
      lines: lines.map((l) => ({
        drugId: l.item!.id,
        description: l.typed.trim() || l.item!.name,
        batchNo: l.batchNo,
        expiryDate: normalizeExpiry(l.expiry),
        quantity: l.quantity,
        freeQuantity: l.freeQuantity || "0",
        packSize: l.packSize,
        rate: l.rate.trim(),
        mrp: l.mrp.trim(),
        gstRate: l.gstRate,
        rememberName: l.rememberName,
      })),
    });
    if (!result.ok) {
      setPending(false);
      toast.error(result.fieldErrors ? `Check the bill: ${Object.values(result.fieldErrors)[0]}` : result.error);
      return;
    }
    toast.success(`Bill ${result.data.number} saved: ${result.data.units} units added to stock`);
    if (result.data.learned.length) toast.info(`Remembered: ${result.data.learned.join(", ")}`);
    router.push(`/pharmacy/purchases/bills/${result.data.billId}`);
  }

  return (
    <div className="space-y-6">
      <Panel title="Bill" description="As printed at the top of the supplier's bill.">
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
          <div>
            <label htmlFor="bill-supplier" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Supplier
            </label>
            <div className="mt-1.5 flex flex-wrap gap-2">
              <select id="bill-supplier" value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className={cn(inputClass, "h-11 min-w-[12rem] flex-1")}>
                <option value="">Choose a supplier</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              {canAddSuppliers && <SupplierDialog />}
            </div>
          </div>
          <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Bill number
            <input value={billNo} onChange={(e) => setBillNo(e.target.value)} placeholder="e.g. GST/2425/1187" className={cn(inputClass, "mt-1.5 h-11 uppercase placeholder:normal-case")} />
          </label>
          <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Bill date
            <input type="date" value={billDate} max={today} onChange={(e) => setBillDate(e.target.value)} className={cn(inputClass, "mt-1.5 h-11")} />
          </label>
        </div>
      </Panel>

      <Panel
        title="Items"
        description="Quantities, rate and MRP per pack, as on the bill. Stock is counted in units: (quantity + free) × units per pack."
        actions={
          <button type="button" onClick={() => setLines((prev) => [...prev, blankLine()])} className={buttonClass("secondary", "sm")}>
            <Plus className="h-4 w-4" /> Add line
          </button>
        }
      >
        <ol className="space-y-4">
          {lines.map((line, index) => {
            const n = index + 1;
            const t = lineTotals(asInput(line));
            const offerName = line.item && isNewAlias(line.typed, line.item.name, line.item.aliases);
            return (
              <li key={line.key} className="space-y-3 rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800">
                <div className="flex items-start gap-3">
                  <span className="mt-2 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-(--accent-soft) text-xs font-bold text-(--accent-text)">{n}</span>
                  <div className="min-w-0 flex-1 space-y-2">
                    <ItemPicker
                      label={`Item, line ${n}`}
                      typed={line.typed}
                      item={line.item}
                      canAddItems={canAddItems}
                      onTyped={(typed) => set(index, { typed })}
                      onPick={(item) =>
                        set(index, item ? { item, packSize: String(item.packSize), rememberName: isNewAlias(line.typed, item.name, item.aliases) } : { item: null, rememberName: false })
                      }
                    />
                    {offerName && (
                      <label className="flex items-start gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                        <input
                          type="checkbox"
                          checked={line.rememberName}
                          onChange={(e) => set(index, { rememberName: e.target.checked })}
                          className="mt-0.5 h-4 w-4 rounded border-zinc-300 accent-(--accent-solid)"
                        />
                        <span>
                          Remember “{line.typed.trim()}” as another name for <strong>{line.item!.name}</strong>
                        </span>
                      </label>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => setLines((prev) => (prev.length === 1 ? [blankLine()] : prev.filter((_, i) => i !== index)))}
                    className={buttonClass("ghost", "sm", "px-2")}
                    aria-label={`Remove line ${n}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
                  <Small label="Batch">
                    <input aria-label={`Batch, line ${n}`} value={line.batchNo} onChange={(e) => set(index, { batchNo: e.target.value })} className={cn(inputClass, "h-10 uppercase")} />
                  </Small>
                  <Small label="Expiry">
                    <input aria-label={`Expiry, line ${n}`} value={line.expiry} onChange={(e) => set(index, { expiry: e.target.value })} placeholder="MM/YY" className={cn(inputClass, "h-10")} />
                  </Small>
                  <Small label="Qty (packs)">
                    <input aria-label={`Quantity, line ${n}`} type="number" min={1} value={line.quantity} onChange={(e) => set(index, { quantity: e.target.value })} className={cn(inputClass, "h-10")} />
                  </Small>
                  <Small label="Free">
                    <input aria-label={`Free, line ${n}`} type="number" min={0} value={line.freeQuantity} onChange={(e) => set(index, { freeQuantity: e.target.value })} className={cn(inputClass, "h-10")} />
                  </Small>
                  <Small label="Units / pack">
                    <input aria-label={`Units per pack, line ${n}`} type="number" min={1} value={line.packSize} onChange={(e) => set(index, { packSize: e.target.value })} className={cn(inputClass, "h-10")} />
                  </Small>
                  <Small label="Rate / pack">
                    <input aria-label={`Rate, line ${n}`} inputMode="decimal" value={line.rate} onChange={(e) => set(index, { rate: e.target.value })} className={cn(inputClass, "h-10")} />
                  </Small>
                  <Small label="MRP / pack">
                    <input aria-label={`MRP, line ${n}`} inputMode="decimal" value={line.mrp} onChange={(e) => set(index, { mrp: e.target.value })} placeholder="Optional" className={cn(inputClass, "h-10")} />
                  </Small>
                  <Small label="GST %">
                    <select aria-label={`GST, line ${n}`} value={line.gstRate} onChange={(e) => set(index, { gstRate: e.target.value })} className={cn(inputClass, "h-10")}>
                      {GST_RATES.map((r) => (
                        <option key={r} value={r}>
                          {r}%
                        </option>
                      ))}
                    </select>
                  </Small>
                </div>

                <p className="flex flex-wrap justify-between gap-x-4 gap-y-1 text-xs text-zinc-500">
                  <span>
                    {t.units > 0 ? `${t.units} units into stock` : "—"}
                    {t.units > 0 && Number(t.unitCost) > 0 ? ` · cost ${money(t.unitCost)} per unit` : ""}
                    {t.unitMrp ? ` · MRP ${money(t.unitMrp)} per unit` : ""}
                  </span>
                  <span className="font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
                    {money(t.amount)}
                    {Number(t.taxAmount) > 0 ? ` + ${money(t.taxAmount)} GST` : ""}
                  </span>
                </p>
                {problems[index] && (line.item || line.batchNo || line.quantity) && (
                  <p className="text-xs font-medium text-amber-700 dark:text-amber-400">Line {n}: {problems[index]}</p>
                )}
              </li>
            );
          })}
        </ol>
      </Panel>

      <Panel>
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-4">
            <label className="flex items-start gap-2 text-sm text-zinc-700 dark:text-zinc-300">
              <input type="checkbox" checked={updatePrices} onChange={(e) => setUpdatePrices(e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-zinc-300 accent-(--accent-solid)" />
              <span>
                Set selling prices from the MRP
                <span className="block text-xs text-zinc-500">Each item&apos;s price per unit becomes its MRP ÷ units per pack, for lines with an MRP.</span>
              </span>
            </label>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Notes
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={500} placeholder="Optional" className={cn(inputClass, "mt-1.5 min-h-16 py-2.5")} />
            </label>
          </div>
          <div className="space-y-2 text-sm">
            <Row label="Before tax" value={money(totals.subtotal)} />
            <Row label="GST" value={money(totals.tax)} />
            <div className="flex items-baseline justify-between border-t border-zinc-100 pt-3 dark:border-zinc-800">
              <span className="text-zinc-500">Bill total</span>
              <span className="text-3xl font-bold tabular-nums text-zinc-900 dark:text-zinc-50">{money(totals.total)}</span>
            </div>
            <p className="text-right text-xs text-zinc-500">{totals.units} units into stock</p>
            <button type="button" onClick={save} disabled={!ready || pending} className={buttonClass("primary", "lg", "mt-2 w-full")}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackageCheck className="h-4 w-4" />}
              Save bill &amp; add to stock
            </button>
            {!ready && (
              <p className="text-center text-xs text-zinc-500">{headerProblem ?? `Line ${firstLineProblem + 1}: ${problems[firstLineProblem]}`}</p>
            )}
          </div>
        </div>
      </Panel>
    </div>
  );
}

function Small({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 space-y-1">
      <p className="text-xs font-medium text-zinc-500" aria-hidden>
        {label}
      </p>
      {children}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-zinc-500">{label}</span>
      <span className="font-medium tabular-nums text-zinc-900 dark:text-zinc-100">{value}</span>
    </div>
  );
}
