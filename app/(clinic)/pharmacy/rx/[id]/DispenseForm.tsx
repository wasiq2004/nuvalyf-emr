"use client";

// Fill a prescription: one batch per line (earliest expiry first by default),
// quantities, payment. One submission = one sale, however often it is sent.
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, MessageCircleQuestion } from "lucide-react";
import { ActionForm, Field, SelectInput, SubmitButton, TextArea, inputClass } from "@/components/app/form";
import { FormDialog } from "@/components/app/dialogs";
import { buttonClass } from "@/components/app/buttons";
import { closePrescriptionAction, dispenseAction, raiseQueryAction } from "@/features/pharmacy/pharmacy.actions";
import { PAYMENT_METHOD_LABELS, PAYMENT_METHODS } from "@/features/billing/billing-rules";
import { fromMinor, toMinor } from "@/lib/money";
import { packWord, sellingPrice, unitWord, unitsFor, type SoldAs } from "@/features/pharmacy/selling-rules";
import { cn } from "@/lib/utils";

type StockOption = {
  drugId: string;
  drugName: string;
  form: string;
  price: string | null;
  packPrice: string | null;
  packSize: number;
  batchId: string;
  batchNo: string;
  expiryDate: string;
  quantity: number;
  prescribed: boolean;
};

export type DispenseItem = {
  id: string;
  drugName: string;
  strength: string | null;
  form: string;
  dose: string;
  frequency: string;
  durationDays: number | null;
  instructions: string | null;
  needed: number | null;
  dispensed: number;
  remaining: number | null;
  stock: StockOption[];
};

function defaultOption(item: DispenseItem) {
  const want = item.remaining ?? 1;
  const prescribed = item.stock.filter((s) => s.prescribed);
  return (prescribed.find((s) => s.quantity >= want) ?? prescribed[0] ?? item.stock.find((s) => s.quantity >= want) ?? item.stock[0])?.batchId ?? "";
}

const capitalize = (v: string) => v.charAt(0).toUpperCase() + v.slice(1);

export function DispenseForm({ prescriptionId, items, currencyFormat }: { prescriptionId: string; items: DispenseItem[]; currencyFormat: { locale: string; currency: string } }) {
  const router = useRouter();
  const [key] = useState(() => crypto.randomUUID());
  const [pending, setPending] = useState(false);
  const [method, setMethod] = useState("cash");
  const [reference, setReference] = useState("");
  const [choice, setChoice] = useState<Record<string, { batchId: string; quantity: string; soldAs: SoldAs }>>(() =>
    Object.fromEntries(items.map((i) => [i.id, { batchId: defaultOption(i), quantity: String(i.remaining ?? (i.dispensed > 0 ? 0 : 1)), soldAs: "unit" as SoldAs }])),
  );
  const set = (id: string, patch: Partial<{ batchId: string; quantity: string; soldAs: SoldAs }>) => setChoice((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));

  const money = (minor: number) => new Intl.NumberFormat(currencyFormat.locale, { style: "currency", currency: currencyFormat.currency }).format(minor / 100);

  const lines = useMemo(
    () =>
      items.flatMap((item) => {
        const c = choice[item.id];
        const qty = Number(c?.quantity);
        const option = item.stock.find((s) => s.batchId === c?.batchId);
        if (!option || !Number.isInteger(qty) || qty <= 0) return [];
        // Packs only for products that come in packs.
        const soldAs: SoldAs = option.packSize > 1 ? c.soldAs : "unit";
        const price = sellingPrice(option, soldAs);
        return [{ item, option, qty, soldAs, units: unitsFor(qty, soldAs, option.packSize), amount: price ? toMinor(price) * qty : 0 }];
      }),
    [items, choice],
  );
  const total = lines.reduce((sum, l) => sum + l.amount, 0);

  async function submit() {
    setPending(true);
    const result = await dispenseAction({
      prescriptionId,
      method,
      reference,
      idempotencyKey: key,
      lines: lines.map((l) => ({ drugId: l.option.drugId, batchId: l.option.batchId, quantity: l.qty, soldAs: l.soldAs, prescriptionItemId: l.item.id })),
    });
    if (!result.ok) {
      setPending(false);
      toast.error(result.fieldErrors ? Object.values(result.fieldErrors)[0] : result.error);
      return;
    }
    toast.success(`Dispensed · ${result.data.number}`);
    router.push(`/pharmacy/sales/${result.data.saleId}`);
  }

  return (
    <div className="space-y-5">
      <ol className="space-y-4">
        {items.map((item, index) => {
          const c = choice[item.id];
          const option = item.stock.find((s) => s.batchId === c?.batchId);
          const done = item.remaining === 0;
          const line = lines.find((l) => l.item.id === item.id);
          const soldAs: SoldAs = option && option.packSize > 1 ? c.soldAs : "unit";
          const price = option ? sellingPrice(option, soldAs) : null;
          const overCourse = line && item.remaining !== null && line.units > item.remaining;
          return (
            <li key={item.id} className={cn("rounded-2xl border p-4 sm:p-5", done ? "border-emerald-200 bg-emerald-50/50 dark:border-emerald-900 dark:bg-emerald-950/20" : "border-zinc-200 dark:border-zinc-800")}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-zinc-900 dark:text-zinc-100">
                    {index + 1}. {item.drugName}
                    <span className="ml-2 text-xs font-normal text-zinc-500">
                      {item.strength ? `${item.strength} · ` : ""}
                      {item.form}
                    </span>
                  </p>
                  <p className="mt-1 text-sm text-zinc-700 dark:text-zinc-300">
                    {item.dose} · {item.frequency}
                    {item.durationDays ? ` · ${item.durationDays} days` : ""}
                    {item.instructions ? ` · ${item.instructions}` : ""}
                  </p>
                  <p className="mt-1 text-xs text-zinc-500">
                    {item.needed !== null ? `Course: ${item.needed}` : "Quantity not stated"}
                    {item.dispensed > 0 ? ` · already given ${item.dispensed}` : ""}
                  </p>
                </div>
                <AskDoctor prescriptionId={prescriptionId} itemId={item.id} itemName={item.drugName} />
              </div>

              {done ? (
                <p className="mt-3 text-sm font-medium text-emerald-700 dark:text-emerald-400">Fully dispensed</p>
              ) : item.stock.length === 0 ? (
                <p className="mt-3 text-sm font-medium text-red-600 dark:text-red-400">Out of stock (no usable batch of this medicine or its generic).</p>
              ) : (
                <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_9rem_6rem_8rem] sm:items-end">
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                    Batch
                    <select
                      aria-label={`Batch for ${item.drugName}`}
                      value={c?.batchId ?? ""}
                      onChange={(e) => set(item.id, { batchId: e.target.value })}
                      className={cn(inputClass, "mt-1.5 h-11")}
                    >
                      {item.stock.map((s) => (
                        <option key={s.batchId} value={s.batchId}>
                          {s.prescribed ? "" : `${s.drugName} · `}
                          {s.batchNo} · exp {s.expiryDate} · {s.quantity} left
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                    Sell as
                    {option && option.packSize > 1 ? (
                      <select aria-label={`Sell ${item.drugName} as`} value={c.soldAs} onChange={(e) => set(item.id, { soldAs: e.target.value as SoldAs })} className={cn(inputClass, "mt-1.5 h-11")}>
                        <option value="unit">{capitalize(unitWord(option.form, 2))}</option>
                        <option value="pack">
                          {capitalize(packWord(option.form, 2))} of {option.packSize}
                        </option>
                      </select>
                    ) : (
                      <span className="mt-1.5 flex h-11 items-center text-sm font-normal text-zinc-500">{capitalize(unitWord(option?.form ?? item.form, 2))}</span>
                    )}
                  </label>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                    Quantity
                    <input
                      aria-label={`Quantity of ${item.drugName}`}
                      type="number"
                      min={0}
                      value={c?.quantity ?? ""}
                      onChange={(e) => set(item.id, { quantity: e.target.value })}
                      className={cn(inputClass, "mt-1.5 h-11")}
                    />
                  </label>
                  <p className="pb-2.5 text-right text-sm tabular-nums text-zinc-700 dark:text-zinc-300">
                    {price ? money(toMinor(price) * (Number(c?.quantity) || 0)) : <span className="text-red-600">No price set</span>}
                  </p>
                  {line && line.soldAs === "pack" && (
                    <p className="text-xs text-zinc-500 sm:col-span-4">
                      = {line.units} {unitWord(line.option.form, line.units)}
                    </p>
                  )}
                  {overCourse && (
                    <p className="text-xs font-medium text-red-600 sm:col-span-4 dark:text-red-400">
                      More than the {item.remaining} left on the course. Sell loose, or ask the doctor.
                    </p>
                  )}
                  {option && !option.prescribed && <p className="text-xs text-amber-700 sm:col-span-4 dark:text-amber-400">Substitute: same generic, different product.</p>}
                </div>
              )}
            </li>
          );
        })}
      </ol>

      <div className="flex flex-col gap-4 rounded-2xl border border-zinc-200 p-4 sm:flex-row sm:items-end sm:justify-between sm:p-5 dark:border-zinc-800">
        <div className="grid flex-1 gap-3 sm:grid-cols-2">
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
        </div>
        <div className="flex items-center justify-between gap-4 sm:justify-end">
          <p className="text-right">
            <span className="block text-xs uppercase tracking-wider text-zinc-500">Total</span>
            <span className="text-2xl font-bold tabular-nums text-zinc-900 dark:text-zinc-50">{money(total)}</span>
          </p>
          <button
            type="button"
            onClick={submit}
            disabled={pending || lines.length === 0 || lines.some((l) => l.item.remaining !== null && l.units > l.item.remaining)}
            className={buttonClass("primary", "lg")}
          >
            {pending && <Loader2 className="h-4 w-4 animate-spin" />}
            Dispense &amp; take {fromMinor(total) === "0.00" ? "payment" : money(total)}
          </button>
        </div>
      </div>
    </div>
  );
}

function AskDoctor({ prescriptionId, itemId, itemName }: { prescriptionId: string; itemId: string; itemName: string }) {
  return (
    <FormDialog
      variant="ghost"
      size="sm"
      trigger={
        <>
          <MessageCircleQuestion className="h-4 w-4" /> Ask doctor
        </>
      }
      title={`Question about ${itemName}`}
      description="Goes to the prescriber's Today screen. The prescription itself is not changed."
    >
      {(close) => (
        <ActionForm action={raiseQueryAction} successMessage="Question sent to the doctor" onSuccess={close}>
          <input type="hidden" name="prescriptionId" value={prescriptionId} />
          <input type="hidden" name="prescriptionItemId" value={itemId} />
          <Field label="Your question" name="message" required>
            <TextArea name="message" rows={3} placeholder="e.g. Only the 500 mg strength is in stock. Give 2 tablets per dose?" />
          </Field>
          <div className="flex justify-end">
            <SubmitButton>Send</SubmitButton>
          </div>
        </ActionForm>
      )}
    </FormDialog>
  );
}

export function ClosePrescriptionDialog({ prescriptionId }: { prescriptionId: string }) {
  const router = useRouter();
  return (
    <FormDialog variant="danger-outline" trigger="Close without dispensing" title="Close this prescription?" description="Use when the patient will not take it from this pharmacy. It leaves the queue; the reason is recorded.">
      {(close) => (
        <ActionForm
          action={closePrescriptionAction}
          successMessage="Prescription closed"
          onSuccess={() => {
            close();
            router.push("/pharmacy");
          }}
        >
          <input type="hidden" name="prescriptionId" value={prescriptionId} />
          <Field label="Reason" name="reason" required>
            <SelectInput
              name="reason"
              placeholder="Choose a reason"
              options={[
                { value: "Patient will buy elsewhere", label: "Patient will buy elsewhere" },
                { value: "Patient declined", label: "Patient declined" },
                { value: "Already has the medicine", label: "Already has the medicine" },
              ]}
            />
          </Field>
          <div className="flex justify-end">
            <SubmitButton variant="danger">Close prescription</SubmitButton>
          </div>
        </ActionForm>
      )}
    </FormDialog>
  );
}

