"use client";

// Fill a prescription. This is the pharmacy's copy: the pharmacist can sell
// fewer days than prescribed (the rest stays open for a later visit), change
// the dose, swap or remove a medicine, or add one. The doctor's signed copy is
// never touched, and one submission is one sale, however often it is sent.
import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, MessageCircleQuestion, Plus, Replace, Search, Undo2, X } from "lucide-react";
import { ActionForm, Field, SelectInput, SubmitButton, TextArea, inputClass } from "@/components/app/form";
import { FormDialog } from "@/components/app/dialogs";
import { buttonClass } from "@/components/app/buttons";
import { checkDispenseDrugAction, closePrescriptionAction, dispenseAction, raiseQueryAction, searchDispensableAction } from "@/features/pharmacy/pharmacy.actions";
import { PAYMENT_METHOD_LABELS, PAYMENT_METHODS } from "@/features/billing/billing-rules";
import { needsOverride, type RxWarning } from "@/features/clinical/prescribing-rules";
import { fromMinor, toMinor } from "@/lib/money";
import { packWord, sellingPrice, unitWord, unitsFor, type SoldAs } from "@/features/pharmacy/selling-rules";
import { priceSale, taxModeFor } from "@/features/pharmacy/gst-rules";
import { quantityForDays } from "@/features/pharmacy/dispensing-rules";
import type { SellableDrug } from "@/features/pharmacy/sales.service";
import type { CounterSettings } from "../../sale/CounterSale";
import { cn } from "@/lib/utils";

type StockOption = {
  drugId: string;
  drugName: string;
  form: string;
  price: string | null;
  packPrice: string | null;
  packSize: number;
  gstRate: string | null;
  rack: string | null;
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
  daysLeft: number | null;
  instructions: string | null;
  needed: number | null;
  dispensed: number;
  remaining: number | null;
  stock: StockOption[];
};

type Row = {
  key: string;
  /** The doctor's line; null when the pharmacist added the medicine. */
  item: DispenseItem | null;
  name: string;
  form: string;
  stock: StockOption[];
  batchId: string;
  quantity: string;
  soldAs: SoldAs;
  dose: string;
  frequency: string;
  days: string;
  instructions: string;
  /** Unticked: not being given on this visit. */
  giving: boolean;
  replaced: boolean;
  warnings: RxWarning[];
};

function defaultOption(item: DispenseItem) {
  const want = item.remaining ?? 1;
  const prescribed = item.stock.filter((s) => s.prescribed);
  return (prescribed.find((s) => s.quantity >= want) ?? prescribed[0] ?? item.stock.find((s) => s.quantity >= want) ?? item.stock[0])?.batchId ?? "";
}

function rowFor(item: DispenseItem): Row {
  return {
    key: item.id,
    item,
    name: item.drugName,
    form: item.form,
    stock: item.stock,
    batchId: defaultOption(item),
    quantity: String(item.remaining ?? (item.dispensed > 0 ? 0 : 1)),
    soldAs: "unit",
    dose: item.dose,
    frequency: item.frequency,
    days: item.daysLeft ? String(item.daysLeft) : "",
    instructions: item.instructions ?? "",
    giving: item.remaining !== 0,
    replaced: false,
    warnings: [],
  };
}

function optionsFrom(drug: SellableDrug): StockOption[] {
  return drug.batches.map((b) => ({
    drugId: drug.drugId,
    drugName: drug.name,
    form: drug.form,
    price: drug.price,
    packPrice: drug.packPrice,
    packSize: drug.packSize,
    gstRate: drug.gstRate,
    rack: drug.rack,
    batchId: b.id,
    batchNo: b.batchNo,
    expiryDate: b.expiryDate,
    quantity: b.quantity,
    prescribed: false,
  }));
}

const capitalize = (v: string) => v.charAt(0).toUpperCase() + v.slice(1);

export function DispenseForm({
  prescriptionId,
  items,
  currencyFormat,
  settings,
  canOverrideDiscount,
  admissionId,
}: {
  admissionId: string | null;
  prescriptionId: string;
  items: DispenseItem[];
  currencyFormat: { locale: string; currency: string };
  settings: CounterSettings;
  canOverrideDiscount: boolean;
}) {
  const router = useRouter();
  const [key] = useState(() => crypto.randomUUID());
  const [pending, setPending] = useState(false);
  const [method, setMethod] = useState("cash");
  const [reference, setReference] = useState("");
  const [discount, setDiscount] = useState("");
  const [note, setNote] = useState("");
  const [checked, setChecked] = useState(false);
  const [rows, setRows] = useState<Row[]>(() => items.map(rowFor));
  const [picking, setPicking] = useState<string | null>(null);

  const patch = (rowKey: string, change: Partial<Row>) => setRows((prev) => prev.map((r) => (r.key === rowKey ? { ...r, ...change } : r)));

  /** Days or dosage changed: work the quantity out again, in loose units. */
  function dosageChange(row: Row, change: Partial<Row>) {
    const next = { ...row, ...change };
    const units = quantityForDays({ form: next.form, dose: next.dose, frequency: next.frequency }, Number(next.days));
    patch(row.key, units === null ? change : { ...change, quantity: String(units), soldAs: "unit" });
  }

  async function pickMedicine(drug: SellableDrug) {
    const target = picking;
    setPicking(null);
    const replacing = target === "add" ? null : rows.find((r) => r.key === target);
    const check = await checkDispenseDrugAction({ prescriptionId, drugId: drug.drugId, replacesItemId: replacing?.item?.id });
    const warnings = check.ok ? check.data.warnings : [];
    if (!check.ok) toast.error(check.error);
    const stock = optionsFrom(drug);
    const fields = { name: drug.name, form: drug.form, stock, batchId: stock[0]?.batchId ?? "", soldAs: "unit" as SoldAs, warnings };
    if (replacing) patch(replacing.key, { ...fields, replaced: true, giving: true });
    else
      setRows((prev) => [...prev, { ...fields, key: crypto.randomUUID(), item: null, quantity: "1", dose: "", frequency: "", days: "", instructions: "", giving: true, replaced: false }]);
  }

  const money = (minor: number) => new Intl.NumberFormat(currencyFormat.locale, { style: "currency", currency: currencyFormat.currency }).format(minor / 100);

  const lines = useMemo(
    () =>
      rows.flatMap((row) => {
        if (!row.giving) return [];
        const qty = Number(row.quantity);
        const option = row.stock.find((s) => s.batchId === row.batchId);
        if (!option || !Number.isInteger(qty) || qty <= 0) return [];
        // Packs only for products that come in packs.
        const soldAs: SoldAs = option.packSize > 1 ? row.soldAs : "unit";
        const price = sellingPrice(option, soldAs);
        const gstRate = option.gstRate !== null ? Number(option.gstRate) : settings.defaultGstRate;
        return [{ row, option, qty, soldAs, gstRate, units: unitsFor(qty, soldAs, option.packSize), amount: price ? toMinor(price) * qty : 0 }];
      }),
    [rows, settings.defaultGstRate],
  );
  const discountMinor = /^\d{1,8}(\.\d{1,2})?$/.test(discount.trim()) ? toMinor(discount.trim()) : 0;
  const totals = priceSale(
    lines.map((l) => ({ gross: l.amount, gstRate: l.gstRate })),
    { discount: discountMinor, roundOff: settings.roundOff, mode: taxModeFor(settings.gstScheme, settings.stateCode, null) },
  );
  const total = totals.total;
  const overLimit = !canOverrideDiscount && totals.gross > 0 && discountMinor * 100 > totals.gross * settings.maxDiscountPercent;
  const warned = lines.flatMap((l) => l.row.warnings);
  const mustCheck = needsOverride(warned);
  const badDays = rows.some((r) => r.giving && r.days !== "" && !(Number.isInteger(Number(r.days)) && Number(r.days) > 0));

  async function submit() {
    setPending(true);
    const result = await dispenseAction({
      prescriptionId,
      method,
      admissionId: method === "inpatient" ? (admissionId ?? "") : "",
      reference,
      discount: discountMinor ? fromMinor(discountMinor) : "",
      dispenseNote: note,
      warningsChecked: checked,
      idempotencyKey: key,
      lines: lines.map((l) => ({
        drugId: l.option.drugId,
        batchId: l.option.batchId,
        quantity: l.qty,
        soldAs: l.soldAs,
        prescriptionItemId: l.row.item?.id,
        dosage: { dose: l.row.dose, frequency: l.row.frequency, durationDays: l.row.days ? Number(l.row.days) : null, instructions: l.row.instructions },
      })),
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
        {rows.map((row, index) => {
          const { item } = row;
          const option = row.stock.find((s) => s.batchId === row.batchId);
          const done = item?.remaining === 0 && !row.replaced;
          const line = lines.find((l) => l.row.key === row.key);
          const soldAs: SoldAs = option && option.packSize > 1 ? row.soldAs : "unit";
          const price = option ? sellingPrice(option, soldAs) : null;
          const short = line && item && item.remaining !== null && line.units < item.remaining;
          const over = line && item && item.remaining !== null && line.units > item.remaining;
          return (
            <li key={row.key} className={cn("rounded-2xl border p-4 sm:p-5", done ? "border-emerald-200 bg-emerald-50/50 dark:border-emerald-900 dark:bg-emerald-950/20" : "border-zinc-200 dark:border-zinc-800", !row.giving && !done && "opacity-60")}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-zinc-900 dark:text-zinc-100">
                    {index + 1}. {row.name}
                    {!item && <span className="ml-2 rounded-md bg-sky-100 px-1.5 py-0.5 text-xs font-medium text-sky-800 dark:bg-sky-950 dark:text-sky-300">Added by pharmacy</span>}
                    {row.replaced && <span className="ml-2 rounded-md bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">Replaces {item?.drugName}</span>}
                  </p>
                  {item && (
                    <>
                      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                        <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">Doctor wrote: </span>
                        {item.drugName}
                        {item.strength ? ` ${item.strength}` : ""} · {item.dose} · {item.frequency}
                        {item.durationDays ? ` · ${item.durationDays} days` : ""}
                        {item.instructions ? ` · ${item.instructions}` : ""}
                      </p>
                      <p className="mt-1 text-xs text-zinc-500">
                        {item.needed !== null ? `Course: ${item.needed}` : "Quantity not stated"}
                        {item.dispensed > 0 ? ` · already given ${item.dispensed}` : ""}
                        {item.remaining !== null && item.dispensed > 0 ? ` · ${item.remaining} left` : ""}
                      </p>
                    </>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  {!done && (
                    <button type="button" onClick={() => setPicking(picking === row.key ? null : row.key)} className={buttonClass("ghost", "sm")}>
                      <Replace className="h-4 w-4" /> Change medicine
                    </button>
                  )}
                  {!done && item && (
                    <button type="button" onClick={() => patch(row.key, { giving: !row.giving })} className={buttonClass("ghost", "sm")}>
                      {row.giving ? <X className="h-4 w-4" /> : <Undo2 className="h-4 w-4" />} {row.giving ? "Not giving" : "Give this"}
                    </button>
                  )}
                  {!item && (
                    <button type="button" onClick={() => setRows((prev) => prev.filter((r) => r.key !== row.key))} className={buttonClass("ghost", "sm")}>
                      <X className="h-4 w-4" /> Remove
                    </button>
                  )}
                  {item && <AskDoctor prescriptionId={prescriptionId} itemId={item.id} itemName={item.drugName} />}
                </div>
              </div>

              {picking === row.key && <MedicinePicker label={`Replace ${row.name}`} onPick={pickMedicine} />}

              {row.warnings.length > 0 && (
                <ul className="mt-3 space-y-1 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
                  {row.warnings.map((w) => (
                    <li key={w.message}>{w.message}</li>
                  ))}
                </ul>
              )}

              {done ? (
                <p className="mt-3 text-sm font-medium text-emerald-700 dark:text-emerald-400">Fully dispensed</p>
              ) : !row.giving ? (
                <p className="mt-3 text-sm text-zinc-500">Not being given today. It stays open on the prescription.</p>
              ) : row.stock.length === 0 ? (
                <p className="mt-3 text-sm font-medium text-red-600 dark:text-red-400">Out of stock (no usable batch of this medicine or its generic). Use Change medicine to give something else.</p>
              ) : (
                <>
                  <div className="mt-4 grid gap-3 sm:grid-cols-4">
                    <SmallField label={`Dose of ${row.name}`} title="Dose" value={row.dose} onChange={(v) => dosageChange(row, { dose: v })} placeholder="1 tablet" />
                    <SmallField label={`Frequency of ${row.name}`} title="Frequency" value={row.frequency} onChange={(v) => dosageChange(row, { frequency: v })} placeholder="BD" />
                    <SmallField label={`Days of ${row.name}`} title="Days" value={row.days} onChange={(v) => dosageChange(row, { days: v })} inputMode="numeric" placeholder="—" />
                    <SmallField label={`Instructions for ${row.name}`} title="Instructions" value={row.instructions} onChange={(v) => patch(row.key, { instructions: v })} placeholder="After food" />
                  </div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_9rem_6rem_8rem] sm:items-end">
                    <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                      Batch
                      <select aria-label={`Batch for ${row.name}`} value={row.batchId} onChange={(e) => patch(row.key, { batchId: e.target.value })} className={cn(inputClass, "mt-1.5 h-11")}>
                        {row.stock.map((s) => (
                          <option key={s.batchId} value={s.batchId}>
                            {s.drugName === row.name ? "" : `${s.drugName} · `}
                            {s.batchNo} · exp {s.expiryDate} · {s.quantity} left
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                      Sell as
                      {option && option.packSize > 1 ? (
                        <select aria-label={`Sell ${row.name} as`} value={row.soldAs} onChange={(e) => patch(row.key, { soldAs: e.target.value as SoldAs })} className={cn(inputClass, "mt-1.5 h-11")}>
                          <option value="unit">{capitalize(unitWord(option.form, 2))}</option>
                          <option value="pack">
                            {capitalize(packWord(option.form, 2))} of {option.packSize}
                          </option>
                        </select>
                      ) : (
                        <span className="mt-1.5 flex h-11 items-center text-sm font-normal text-zinc-500">{capitalize(unitWord(option?.form ?? row.form, 2))}</span>
                      )}
                    </label>
                    <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                      Quantity
                      <input aria-label={`Quantity of ${row.name}`} type="number" min={0} value={row.quantity} onChange={(e) => patch(row.key, { quantity: e.target.value })} className={cn(inputClass, "mt-1.5 h-11")} />
                    </label>
                    <p className="pb-2.5 text-right text-sm tabular-nums text-zinc-700 dark:text-zinc-300">
                      {price ? money(toMinor(price) * (Number(row.quantity) || 0)) : <span className="text-red-600">No price set</span>}
                    </p>
                    {line && line.soldAs === "pack" && (
                      <p className="text-xs text-zinc-500 sm:col-span-4">
                        = {line.units} {unitWord(line.option.form, line.units)}
                      </p>
                    )}
                    {short && item && (
                      <p className="text-xs font-medium text-amber-700 sm:col-span-4 dark:text-amber-400">
                        {item.remaining! - line.units} left on the prescription for a later visit.
                      </p>
                    )}
                    {over && <p className="text-xs font-medium text-amber-700 sm:col-span-4 dark:text-amber-400">More than the {item?.remaining} left on the course.</p>}
                    {option && item && !row.replaced && !option.prescribed && <p className="text-xs text-amber-700 sm:col-span-4 dark:text-amber-400">Substitute: same generic, different product.</p>}
                  </div>
                </>
              )}
            </li>
          );
        })}
      </ol>

      <div>
        <button type="button" onClick={() => setPicking(picking === "add" ? null : "add")} className={buttonClass("secondary", "md")}>
          <Plus className="h-4 w-4" /> Add a medicine
        </button>
        {picking === "add" && <MedicinePicker label="Add a medicine" onPick={pickMedicine} />}
      </div>

      <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
        Note on any change (optional)
        <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="e.g. Patient buying 15 days now, rest next month" className={cn(inputClass, "mt-1.5 h-11")} />
      </label>

      {mustCheck && (
        <label className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} className="mt-0.5 h-4 w-4 accent-red-600" />
          I have checked the warnings above for this patient.
        </label>
      )}

      <div className="flex flex-col gap-4 rounded-2xl border border-zinc-200 p-4 sm:flex-row sm:items-end sm:justify-between sm:p-5 dark:border-zinc-800">
        <div className="grid flex-1 gap-3 sm:grid-cols-3">
          <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Paid by
            <select value={method} onChange={(e) => setMethod(e.target.value)} className={cn(inputClass, "mt-1.5 h-11")}>
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {PAYMENT_METHOD_LABELS[m]}
                </option>
              ))}
              <option value="credit">On the patient&apos;s account</option>
              {admissionId && <option value="inpatient">On the inpatient bill</option>}
            </select>
          </label>
          <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Discount (₹)
            <input value={discount} onChange={(e) => setDiscount(e.target.value)} inputMode="decimal" placeholder="0" className={cn(inputClass, "mt-1.5 h-11", overLimit && "border-red-400")} />
            {overLimit && <span className="mt-1 block text-xs text-red-600 dark:text-red-400">Above {settings.maxDiscountPercent} % needs a manager</span>}
          </label>
          <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Reference
            <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="UPI / card ref (optional)" className={cn(inputClass, "mt-1.5 h-11")} />
          </label>
        </div>
        <div className="flex items-center justify-between gap-4 sm:justify-end">
          <p className="text-right">
            <span className="block text-xs uppercase tracking-wider text-zinc-500">{totals.tax > 0 ? `Total incl. GST ${money(totals.tax)}` : "Total"}</span>
            <span className="text-2xl font-bold tabular-nums text-zinc-900 dark:text-zinc-50">{money(total)}</span>
          </p>
          <button type="button" onClick={submit} disabled={pending || overLimit || lines.length === 0 || badDays || (mustCheck && !checked)} className={buttonClass("primary", "lg")}>
            {pending && <Loader2 className="h-4 w-4 animate-spin" />}
            Dispense &amp; take {fromMinor(total) === "0.00" ? "payment" : money(total)}
          </button>
        </div>
      </div>
    </div>
  );
}

function SmallField({ label, title, value, onChange, placeholder, inputMode }: { label: string; title: string; value: string; onChange: (v: string) => void; placeholder?: string; inputMode?: "numeric" }) {
  return (
    <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
      {title}
      <input aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} inputMode={inputMode} placeholder={placeholder} className={cn(inputClass, "mt-1.5 h-10")} />
    </label>
  );
}

/** Any medicine in stock, not only the prescribed one or its generic. */
function MedicinePicker({ label, onPick }: { label: string; onPick: (drug: SellableDrug) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SellableDrug[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef(0);

  function onQuery(value: string) {
    setQuery(value);
    clearTimeout(timer.current);
    if (!value.trim()) return setResults([]);
    const request = ++latest.current;
    timer.current = setTimeout(async () => {
      const result = await searchDispensableAction({ query: value });
      if (request !== latest.current) return;
      if (result.ok) setResults(result.data);
      else toast.error(result.error);
    }, 200);
  }

  return (
    <div className="relative mt-3">
      <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-zinc-400" aria-hidden />
      <input type="search" aria-label={label} value={query} onChange={(e) => onQuery(e.target.value)} placeholder="Search a medicine in stock" className={cn(inputClass, "h-10 pl-9")} autoFocus />
      {results.length > 0 && (
        <ul className="absolute z-20 mt-2 max-h-72 w-full divide-y divide-zinc-100 overflow-y-auto rounded-2xl border border-zinc-200 bg-white shadow-xl dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
          {results.map((r) => (
            <li key={r.drugId}>
              <button type="button" onClick={() => onPick(r)} className="block w-full px-4 py-2.5 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800/60">
                <span className="block text-sm font-medium text-zinc-900 dark:text-zinc-100">{r.name}</span>
                <span className="block text-xs text-zinc-500">
                  {r.genericName} · {r.batches.reduce((n, b) => n + b.quantity, 0)} in stock
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
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
      description="Optional. Goes to the prescriber's Today screen. The prescription itself is not changed."
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
