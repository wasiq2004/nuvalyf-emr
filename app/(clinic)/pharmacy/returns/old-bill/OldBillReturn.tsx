"use client";

// A credit note against the old software's bill. There is no sale here to read
// from, so the paper bill is the source: its number, date and amounts are typed
// in, and the batch comes off the pack. Sent once with its own key.
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { buttonClass } from "@/components/app/buttons";
import { Panel } from "@/components/app/page";
import { inputClass } from "@/components/app/form";
import { CustomerPicker, type PickedCustomer } from "@/components/pharmacy/customer-picker";
import { ItemSearch } from "@/components/pharmacy/item-search";
import { oldBillReturnAction, searchReturnItemsAction } from "@/features/pharmacy/returns.actions";
import { normalizeExpiry } from "@/features/pharmacy/purchase-rules";
import type { ItemOption } from "@/features/catalog/items.service";
import { fromMinor, toMinor } from "@/lib/money";
import { cn } from "@/lib/utils";

type Line = { key: number; item: ItemOption | null; batchNo: string; expiry: string; quantity: string; amount: string; resaleable: boolean };

const MONEY = /^\d{1,8}(\.\d{1,2})?$/;
const blank = (key: number): Line => ({ key, item: null, batchNo: "", expiry: "", quantity: "", amount: "", resaleable: true });

export function OldBillReturn({ today, canSetCredit }: { today: string; canSetCredit: boolean }) {
  const router = useRouter();
  const nextKey = useRef(1);
  const key = useRef(crypto.randomUUID());
  const [oldBillNo, setOldBillNo] = useState("");
  const [oldBillDate, setOldBillDate] = useState("");
  const [customer, setCustomer] = useState<PickedCustomer | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [refundMethod, setRefundMethod] = useState("cash");
  const [reason, setReason] = useState("");
  const [lines, setLines] = useState<Line[]>([blank(0)]);
  const [confirmRepeat, setConfirmRepeat] = useState(false);
  const [repeat, setRepeat] = useState(false);
  const [busy, setBusy] = useState(false);

  const set = (k: number, patch: Partial<Line>) => setLines((rows) => rows.map((r) => (r.key === k ? { ...r, ...patch } : r)));
  const parsed = lines.map((l) => ({ ...l, expiryDate: normalizeExpiry(l.expiry) }));
  const lineOk = (l: (typeof parsed)[number]) => l.item && l.batchNo.trim() && /^\d{4}-\d{2}-\d{2}$/.test(l.expiryDate) && /^[1-9]\d{0,5}$/.test(l.quantity.trim()) && MONEY.test(l.amount.trim());
  const total = parsed.reduce((s, l) => s + (MONEY.test(l.amount.trim()) ? toMinor(l.amount.trim()) : 0), 0);
  const ready = oldBillNo.trim() && oldBillDate && reason.trim() && parsed.every(lineOk) && (refundMethod !== "account" || customer);

  async function submit() {
    setBusy(true);
    const result = await oldBillReturnAction({
      oldBillNo,
      oldBillDate,
      customerId: customer?.id,
      customerName,
      refundMethod,
      reason,
      confirmRepeat,
      idempotencyKey: key.current,
      lines: parsed.map((l) => ({ drugId: l.item!.id, batchNo: l.batchNo, expiryDate: l.expiryDate, quantity: l.quantity, amount: l.amount.trim(), resaleable: l.resaleable })),
    });
    setBusy(false);
    if (!result.ok) {
      if (result.error.includes("further return")) setRepeat(true);
      // A refused form did nothing, so the next try is a new attempt.
      key.current = crypto.randomUUID();
      return toast.error(result.fieldErrors ? Object.values(result.fieldErrors)[0] : result.error);
    }
    toast.success(`Credit note ${result.data.number}`);
    router.push(`/pharmacy/returns/${result.data.returnId}`);
  }

  return (
    <div className="space-y-6">
      <Panel title="The old bill">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Bill number
            <input value={oldBillNo} maxLength={60} onChange={(e) => setOldBillNo(e.target.value)} className={cn(inputClass, "mt-1.5 h-10 uppercase")} />
          </label>
          <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Bill date
            <input type="date" max={today} value={oldBillDate} onChange={(e) => setOldBillDate(e.target.value)} className={cn(inputClass, "mt-1.5 h-10")} />
          </label>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            <p className="mb-1.5">Named customer</p>
            <CustomerPicker value={customer} onChange={setCustomer} canSetCredit={canSetCredit} />
          </div>
          {!customer && (
            <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Or their name
              <input value={customerName} maxLength={200} onChange={(e) => setCustomerName(e.target.value)} placeholder="Optional" className={cn(inputClass, "mt-1.5 h-10")} />
            </label>
          )}
        </div>
      </Panel>

      <Panel title="What came back" description="Enter the amount paid for these units, including GST, from the bill. Read the batch and expiry off the pack.">
        <ul className="space-y-4">
          {lines.map((line) => (
            <li key={line.key} className="space-y-3 rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <ItemSearch label="Item returned" item={line.item} onPick={(item) => set(line.key, { item })} search={searchReturnItemsAction} />
                </div>
                {lines.length > 1 && (
                  <button type="button" aria-label="Remove this line" onClick={() => setLines((rows) => rows.filter((r) => r.key !== line.key))} className={buttonClass("ghost", "sm")}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
              <div className="grid gap-3 sm:grid-cols-4">
                <input aria-label="Batch" placeholder="Batch" value={line.batchNo} onChange={(e) => set(line.key, { batchNo: e.target.value })} className={cn(inputClass, "h-10 uppercase placeholder:normal-case")} />
                <input aria-label="Expiry" placeholder="Expiry MM/YY" value={line.expiry} onChange={(e) => set(line.key, { expiry: e.target.value })} className={cn(inputClass, "h-10")} />
                <input aria-label="Units returned" inputMode="numeric" placeholder="Single units" value={line.quantity} onChange={(e) => set(line.key, { quantity: e.target.value })} className={cn(inputClass, "h-10 text-right")} />
                <input aria-label="Amount refunded" inputMode="decimal" placeholder="Amount" value={line.amount} onChange={(e) => set(line.key, { amount: e.target.value })} className={cn(inputClass, "h-10 text-right")} />
              </div>
              <label className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
                <input type="checkbox" checked={line.resaleable} onChange={(e) => set(line.key, { resaleable: e.target.checked })} className="h-4 w-4 accent-(--accent)" /> Fit to sell again
              </label>
              {!line.resaleable && <p className="text-xs text-zinc-500">It will be recorded and written off as damaged, so it cannot be sold.</p>}
            </li>
          ))}
        </ul>
        <button type="button" onClick={() => setLines((rows) => [...rows, blank(nextKey.current++)])} className={cn(buttonClass("secondary", "sm"), "mt-4")}>
          <Plus className="h-4 w-4" /> Add another item
        </button>
      </Panel>

      <Panel title="The refund">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            How it goes back
            <select value={refundMethod} onChange={(e) => setRefundMethod(e.target.value)} className={cn(inputClass, "mt-1.5 h-10")}>
              <option value="cash">Cash</option>
              <option value="upi">UPI</option>
              <option value="card">Card</option>
              <option value="other">Other</option>
              <option value="account">Credit their account</option>
            </select>
          </label>
          <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Reason
            <input value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} className={cn(inputClass, "mt-1.5 h-10")} />
          </label>
        </div>
        {refundMethod === "account" && !customer && <p className="mt-3 text-sm text-amber-700 dark:text-amber-400">Choose the named customer to credit.</p>}
        {repeat && (
          <label className="mt-3 flex items-center gap-2 text-sm text-amber-700 dark:text-amber-400">
            <input type="checkbox" checked={confirmRepeat} onChange={(e) => setConfirmRepeat(e.target.checked)} className="h-4 w-4 accent-(--accent)" /> This is a further return on the same bill
          </label>
        )}
      </Panel>

      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-zinc-500">
          Refund <span className="font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">₹{fromMinor(total)}</span>
        </p>
        <button type="button" disabled={!ready || busy} onClick={submit} className={buttonClass("primary", "md")}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" />} Issue credit note
        </button>
      </div>
    </div>
  );
}
