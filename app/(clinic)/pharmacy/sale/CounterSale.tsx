"use client";

// Over-the-counter sale: search or scan stock, build a basket (earliest-expiry
// batch by default), loose or by the strip; discount, named customer (credit,
// GST buyer) and Schedule H/H1 details when needed; totals with GST exactly as
// the invoice will show them. Sent once with its own key, so a double-click or
// a retry never sells twice.
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, MapPin, Pill, ScanLine, Search, ShieldAlert, Trash2 } from "lucide-react";
import { inputClass } from "@/components/app/form";
import { buttonClass } from "@/components/app/buttons";
import { EmptyState } from "@/components/app/page";
import { ScheduleBadge } from "@/components/pharmacy/badges";
import { CustomerPicker, type PickedCustomer } from "@/components/pharmacy/customer-picker";
import { counterSaleAction, searchSellableAction } from "@/features/pharmacy/pharmacy.actions";
import type { SellableDrug } from "@/features/pharmacy/sales.service";
import { PAYMENT_METHOD_LABELS, PAYMENT_METHODS } from "@/features/billing/billing-rules";
import { fromMinor, toMinor } from "@/lib/money";
import { batchPrice, packWord, unitWord, unitsFor, type SoldAs } from "@/features/pharmacy/selling-rules";
import { priceSale, stateOfGstin, taxModeFor } from "@/features/pharmacy/gst-rules";
import { requiredDetails } from "@/features/pharmacy/schedule-rules";
import { cn } from "@/lib/utils";

type Line = { drug: SellableDrug; batchId: string; quantity: string; soldAs: SoldAs };

export type CounterSettings = {
  roundOff: boolean;
  gstScheme: string;
  stateCode: string | null;
  defaultGstRate: number;
  maxDiscountPercent: number;
};

const capitalize = (v: string) => v.charAt(0).toUpperCase() + v.slice(1);
const MONEY = /^\d{1,8}(\.\d{1,2})?$/;

export function CounterSale({
  locale,
  currency,
  settings,
  canOverrideDiscount,
  canSetCredit,
  admissions,
}: {
  locale: string;
  currency: string;
  settings: CounterSettings;
  canOverrideDiscount: boolean;
  canSetCredit: boolean;
  admissions: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [key] = useState(() => crypto.randomUUID());
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SellableDrug[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [customer, setCustomer] = useState<PickedCustomer | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [prescriberName, setPrescriberName] = useState("");
  const [prescriberRegNo, setPrescriberRegNo] = useState("");
  const [patientAddress, setPatientAddress] = useState("");
  const [discount, setDiscount] = useState("");
  const [method, setMethod] = useState("cash");
  const [reference, setReference] = useState("");
  const [admissionId, setAdmissionId] = useState("");
  const [pending, setPending] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef(0);

  const money = (minor: number) => new Intl.NumberFormat(locale, { style: "currency", currency }).format(minor / 100);

  function runSearch(value: string, request: number, addOnScan: boolean) {
    return searchSellableAction({ query: value }).then((result) => {
      if (request !== latest.current) return;
      if (!result.ok) return toast.error(result.error);
      // A scanner types the code and Enter: add the item straight away.
      const scanned = result.data.find((r) => r.barcodeMatch);
      if (addOnScan && scanned) add(scanned);
      else setResults(result.data);
    });
  }

  function onQuery(value: string) {
    setQuery(value);
    clearTimeout(timer.current);
    if (!value.trim()) return setResults([]);
    const request = ++latest.current;
    timer.current = setTimeout(() => void runSearch(value, request, false), 200);
  }

  function onEnter() {
    if (!query.trim()) return;
    clearTimeout(timer.current);
    void runSearch(query, ++latest.current, true);
  }

  function add(drug: SellableDrug) {
    setLines((prev) => {
      // Scanning the same pack again adds one more instead of a new line.
      const same = prev.findIndex((l) => l.drug.drugId === drug.drugId && l.soldAs === "unit");
      if (same >= 0 && drug.barcodeMatch) return prev.map((l, i) => (i === same ? { ...l, quantity: String(Number(l.quantity) + 1) } : l));
      return [...prev, { drug, batchId: drug.batches[0].id, quantity: "1", soldAs: "unit" }];
    });
    setQuery("");
    setResults([]);
  }

  const set = (index: number, patch: Partial<Line>) => setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));

  const priced = lines.map((l) => {
    const qty = Number(l.quantity);
    const chosen = l.drug.batches.find((b) => b.id === l.batchId);
    const price = batchPrice(l.drug, chosen, l.soldAs);
    const ok = Number.isInteger(qty) && qty > 0;
    const units = ok ? unitsFor(qty, l.soldAs, l.drug.packSize) : 0;
    const inBatch = chosen?.quantity ?? 0;
    const gstRate = l.drug.gstRate !== null ? Number(l.drug.gstRate) : settings.defaultGstRate;
    return { ...l, qty, price, units, gstRate, short: units > inBatch, gross: price && ok ? toMinor(price) * qty : 0 };
  });
  const mode = taxModeFor(settings.gstScheme, settings.stateCode, stateOfGstin(customer?.gstin));
  const discountMinor = MONEY.test(discount.trim()) ? toMinor(discount.trim()) : 0;
  const totals = priceSale(
    priced.map((l) => ({ gross: l.gross, gstRate: l.gstRate })),
    { discount: discountMinor, roundOff: settings.roundOff, mode },
  );
  const discountPercent = totals.gross > 0 ? (discountMinor * 100) / totals.gross : 0;
  const overLimit = !canOverrideDiscount && discountPercent > settings.maxDiscountPercent;

  const needs = requiredDetails(priced.map((l) => l.drug.schedule));
  const details = { prescriberName, prescriberRegNo, patientName: customerName || customer?.name || "", patientAddress };
  const missing = needs.filter((f) => !details[f].trim());

  const problem = (() => {
    if (priced.length === 0) return "Add a medicine";
    if (priced.some((l) => !l.price)) return "An item has no selling price";
    if (priced.some((l) => !Number.isInteger(l.qty) || l.qty <= 0)) return "Check the quantities";
    if (priced.some((l) => l.short)) return "More than a batch holds";
    if (discount.trim() && !MONEY.test(discount.trim())) return "The discount should be an amount like 20 or 20.50";
    if (discountMinor > totals.gross) return "The discount is more than the bill";
    if (overLimit) return `Discounts above ${settings.maxDiscountPercent} % need a manager`;
    if (method === "credit" && !customer) return "Choose the customer to put it on account";
    if (method === "inpatient" && !admissionId) return "Choose the admitted patient";
    if (missing.length) return "Fill in the prescription details";
    return null;
  })();

  async function complete() {
    setPending(true);
    const result = await counterSaleAction({
      lines: priced.map((l) => ({ drugId: l.drug.drugId, batchId: l.batchId, quantity: l.qty, soldAs: l.soldAs })),
      customerName: customerName || customer?.name || "",
      customerPhone,
      customerId: customer?.id ?? "",
      method,
      admissionId: method === "inpatient" ? admissionId : "",
      reference,
      discount: discountMinor ? fromMinor(discountMinor) : "",
      prescriberName,
      prescriberRegNo,
      patientAddress,
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
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onEnter();
              }
            }}
            placeholder="Search a medicine in stock, or scan its barcode"
            className={cn(inputClass, "h-12 pl-10 pr-10 text-base")}
            autoFocus
          />
          <ScanLine className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" aria-hidden />
          {results.length > 0 && (
            <ul className="absolute z-20 mt-2 max-h-80 w-full divide-y divide-zinc-100 overflow-y-auto rounded-2xl border border-zinc-200 bg-white shadow-xl dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
              {results.map((r) => (
                <li key={r.drugId}>
                  <button type="button" onClick={() => add(r)} className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800/60">
                    <span className="flex min-w-0 items-center gap-3">
                      <Pill className="h-4 w-4 flex-shrink-0 text-(--accent-text)" />
                      <span className="min-w-0">
                        <span className="flex flex-wrap items-center gap-2 text-sm font-medium text-zinc-900 dark:text-zinc-100">
                          {r.name} <ScheduleBadge schedule={r.schedule} />
                        </span>
                        <span className="block truncate text-xs text-zinc-500">
                          {r.genericName} · {r.batches.reduce((n, b) => n + b.quantity, 0)} in stock{r.rack ? ` · rack ${r.rack}` : ""}
                        </span>
                      </span>
                    </span>
                    <span className="text-sm tabular-nums text-zinc-700 dark:text-zinc-300">{batchPrice(r, r.batches[0], "unit") ? money(toMinor(batchPrice(r, r.batches[0], "unit")!)) : "No price"}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {lines.length === 0 ? (
          <EmptyState icon={Pill} title="Basket is empty" description="Search above and pick a medicine, or scan its barcode." />
        ) : (
          <ul className="space-y-3">
            {priced.map((line, index) => (
              <li key={`${line.drug.drugId}-${index}`} className="space-y-3 rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 font-medium text-zinc-900 dark:text-zinc-100">
                      <span className="truncate">{line.drug.name}</span> <ScheduleBadge schedule={line.drug.schedule} />
                    </p>
                    <p className="text-xs text-zinc-500">
                      {line.price ? `${money(toMinor(line.price))} per ${line.soldAs === "pack" ? packWord(line.drug.form) : unitWord(line.drug.form)}` : "No selling price set"}
                      {line.soldAs === "pack" && line.units > 0 ? ` · ${line.units} ${unitWord(line.drug.form, line.units)}` : ""}
                      {` · GST ${line.gstRate} %`}
                      {line.drug.rack && (
                        <span className="ml-1 inline-flex items-center gap-0.5">
                          · <MapPin className="h-3 w-3" aria-hidden /> {line.drug.rack}
                        </span>
                      )}
                    </p>
                    {line.short && <p className="text-xs font-medium text-red-600 dark:text-red-400">More than this batch holds</p>}
                  </div>
                  <div className="flex items-center gap-2">
                    <p className="text-right text-sm font-semibold tabular-nums">{money(line.gross)}</p>
                    <button type="button" onClick={() => setLines((prev) => prev.filter((_, i) => i !== index))} className={buttonClass("ghost", "sm", "px-2")} aria-label={`Remove ${line.drug.name}`}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,11rem)_6rem]">
                  <select aria-label={`Batch for ${line.drug.name}`} value={line.batchId} onChange={(e) => set(index, { batchId: e.target.value })} className={cn(inputClass, "h-10")}>
                    {line.drug.batches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.batchNo} · exp {b.expiryDate} · {b.quantity} {unitWord(line.drug.form, b.quantity)}
                        {b.mrp ? ` · MRP ${b.mrp}` : ""}
                      </option>
                    ))}
                  </select>
                  {line.drug.packSize > 1 ? (
                    <select aria-label={`Sell ${line.drug.name} as`} value={line.soldAs} onChange={(e) => set(index, { soldAs: e.target.value as SoldAs })} className={cn(inputClass, "h-10")}>
                      <option value="unit">{capitalize(unitWord(line.drug.form, 2))}</option>
                      <option value="pack">
                        {capitalize(packWord(line.drug.form, 2))} of {line.drug.packSize}
                      </option>
                    </select>
                  ) : (
                    <span className="flex h-10 items-center text-sm text-zinc-500">{capitalize(unitWord(line.drug.form, 2))}</span>
                  )}
                  <input aria-label={`Quantity of ${line.drug.name}`} type="number" min={1} value={line.quantity} onChange={(e) => set(index, { quantity: e.target.value })} className={cn(inputClass, "h-10")} />
                </div>
              </li>
            ))}
          </ul>
        )}

        {needs.length > 0 && (
          <section className="space-y-3 rounded-2xl border border-amber-200 bg-amber-50/60 p-4 dark:border-amber-900 dark:bg-amber-950/20" aria-label="Prescription details">
            <p className="flex items-center gap-2 text-sm font-semibold text-amber-900 dark:text-amber-200">
              <ShieldAlert className="h-4 w-4" /> Scheduled medicine: {needs.includes("patientAddress") ? "the Schedule H1 register needs these details" : "sold on prescription only"}
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Detail label="Prescribing doctor" value={prescriberName} onChange={setPrescriberName} required />
              {needs.includes("prescriberRegNo") && <Detail label="Doctor's registration no." value={prescriberRegNo} onChange={setPrescriberRegNo} required />}
              {needs.includes("patientName") && <Detail label="Patient's name" value={customerName} onChange={setCustomerName} required placeholder={customer?.name} />}
              {needs.includes("patientAddress") && <Detail label="Patient's address" value={patientAddress} onChange={setPatientAddress} required />}
            </div>
          </section>
        )}
      </div>

      <div className="space-y-4 rounded-3xl border border-zinc-200/70 bg-white/95 p-6 shadow-xl shadow-zinc-200/40 dark:border-zinc-800 dark:bg-zinc-900/90 dark:shadow-none">
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-white">Payment</h2>
        <div className="space-y-1.5">
          <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Customer</p>
          <CustomerPicker
            value={customer}
            onChange={(c) => {
              setCustomer(c);
              if (!c && method === "credit") setMethod("cash");
            }}
            canSetCredit={canSetCredit}
          />
        </div>
        {!customer && !needs.includes("patientName") && (
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Customer name
              <input value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Optional" className={cn(inputClass, "mt-1.5 h-11")} />
            </label>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Phone
              <input value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} placeholder="Optional" className={cn(inputClass, "mt-1.5 h-11")} />
            </label>
          </div>
        )}
        <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Discount (₹)
          <input value={discount} onChange={(e) => setDiscount(e.target.value)} inputMode="decimal" placeholder="0" className={cn(inputClass, "mt-1.5 h-11", overLimit && "border-red-400")} />
          <span className={cn("mt-1 block text-xs", overLimit ? "text-red-600 dark:text-red-400" : "text-zinc-500")}>
            {discountMinor > 0 ? `${discountPercent.toFixed(1)} % of the bill` : ""}
            {canOverrideDiscount ? "" : `${discountMinor > 0 ? " · " : ""}up to ${settings.maxDiscountPercent} %`}
          </span>
        </label>
        {method === "inpatient" && (
          <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Admitted patient
            <select value={admissionId} onChange={(e) => setAdmissionId(e.target.value)} className={cn(inputClass, "mt-1.5 h-11")}>
              <option value="">Choose…</option>
              {admissions.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Paid by
            <select value={method} onChange={(e) => setMethod(e.target.value)} className={cn(inputClass, "mt-1.5 h-11")}>
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {PAYMENT_METHOD_LABELS[m]}
                </option>
              ))}
              {customer && <option value="credit">On account</option>}
              {admissions.length > 0 && <option value="inpatient">Inpatient bill</option>}
            </select>
          </label>
          <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Reference
            <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="UPI / card ref" className={cn(inputClass, "mt-1.5 h-11")} />
          </label>
        </div>

        <dl className="space-y-1.5 border-t border-zinc-100 pt-4 text-sm dark:border-zinc-800">
          <Row label="Items" value={money(totals.gross)} />
          {totals.discount > 0 && <Row label="Discount" value={`− ${money(totals.discount)}`} />}
          {mode !== "none" && <Row label="Taxable value" value={money(totals.taxable)} muted />}
          {mode === "intra" && totals.tax > 0 && (
            <>
              <Row label="CGST" value={money(totals.lines.reduce((s, l) => s + l.cgst, 0))} muted />
              <Row label="SGST" value={money(totals.lines.reduce((s, l) => s + l.sgst, 0))} muted />
            </>
          )}
          {mode === "inter" && totals.tax > 0 && <Row label="IGST" value={money(totals.tax)} muted />}
          {totals.roundOff !== 0 && <Row label="Round-off" value={`${totals.roundOff > 0 ? "+" : "−"} ${money(Math.abs(totals.roundOff))}`} muted />}
        </dl>
        <div className="flex items-baseline justify-between border-t border-zinc-100 pt-4 dark:border-zinc-800">
          <span className="text-sm text-zinc-500">{method === "credit" ? "To the account" : "Total"}</span>
          <span className="text-3xl font-bold tabular-nums text-zinc-900 dark:text-zinc-50">{money(totals.total)}</span>
        </div>
        <button type="button" onClick={complete} disabled={Boolean(problem) || pending} className={buttonClass("primary", "lg", "w-full")}>
          {pending && <Loader2 className="h-4 w-4 animate-spin" />}
          Complete sale
        </button>
        {problem && lines.length > 0 && <p className="text-center text-xs text-zinc-500">{problem}</p>}
      </div>
    </div>
  );
}

function Detail({ label, value, onChange, required, placeholder }: { label: string; value: string; onChange: (v: string) => void; required?: boolean; placeholder?: string }) {
  return (
    <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
      {label}
      {required && <span className="ml-0.5 text-red-500">*</span>}
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={cn(inputClass, "mt-1.5 h-10")} />
    </label>
  );
}

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex justify-between">
      <dt className={muted ? "text-zinc-400" : "text-zinc-500"}>{label}</dt>
      <dd className={cn("tabular-nums", muted ? "text-zinc-500" : "font-medium text-zinc-900 dark:text-zinc-100")}>{value}</dd>
    </div>
  );
}
