"use client";

// Upload -> check -> import, like the patient import: the check reports every
// problem by line, the import button only appears for a clean file, and the
// server checks again and imports all rows or none.
//
// Nothing is assumed about the quantity column: the person says whether it
// counts single units or packs before the file can be checked, and sees a few
// lines worked out in words. "Compare" sets the old software's closing stock
// against what is here, line by line, and changes nothing.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2, FileUp, GitCompare, Loader2, TriangleAlert } from "lucide-react";
import { buttonClass } from "@/components/app/buttons";
import { checkStockImportAction, compareStockAction, runStockImportAction } from "@/features/pharmacy/pharmacy.actions";
import type { StockComparison, StockImportReport } from "@/features/pharmacy/stock-import.service";
import type { QuantityBasis } from "@/features/pharmacy/stock-import-rules";
import { MAX_IMPORT_BYTES } from "@/features/import/import-rules";
import { formatMoney } from "@/lib/money";

const FIELD_LABEL: Record<string, string> = {
  itemType: "type",
  genericName: "generic name",
  packSize: "units per pack",
  price: "selling price",
  reorderLevel: "reorder level",
  otherNames: "other names",
  batchNo: "batch",
  expiryDate: "expiry",
  unitCost: "unit cost",
  packCost: "pack cost",
};

const BASES: { value: QuantityBasis; label: string; hint: string }[] = [
  { value: "units", label: "Single units", hint: "300 means 300 tablets" },
  { value: "packs", label: "Packs or strips", hint: "20 means 20 strips; 20:5 means 20 strips and 5 loose" },
];

type Problem = StockImportReport["problems"][number];

function Problems({ problems, rows }: { problems: Problem[]; rows: number }) {
  return (
    <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
      <p className="flex items-center gap-2 font-semibold">
        <TriangleAlert className="h-4 w-4" />
        {problems.length} {problems.length === 1 ? "problem" : "problems"}{rows ? ` in ${rows} rows` : ""}. Fix {problems.length === 1 ? "it" : "them"} and check the file again.
      </p>
      <ul className="mt-3 max-h-80 space-y-1 overflow-y-auto">
        {problems.map((p, i) => (
          <li key={i}>
            <span className="font-mono font-semibold">Line {p.line}</span>
            {p.field !== "row" && p.field !== "file" && p.field !== "header" ? ` · ${FIELD_LABEL[p.field] ?? p.field}` : ""}: {p.message}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Totals({ report, currency }: { report: StockImportReport; currency: string }) {
  const money = (v: string) => formatMoney(v, currency);
  return (
    <div role="status" className="space-y-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
      <p className="flex items-center gap-2 font-semibold">
        <CheckCircle2 className="h-5 w-5 flex-shrink-0" /> All {report.rows} rows are valid. Set these totals beside the old software&apos;s closing stock before importing.
      </p>
      <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
        <div className="flex justify-between gap-3">
          <dt>New items</dt>
          <dd className="font-semibold tabular-nums">{report.newItems}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt>Already in your list</dt>
          <dd className="font-semibold tabular-nums">{report.existingItems}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt>Batches</dt>
          <dd className="font-semibold tabular-nums">{report.batches}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt>Single units</dt>
          <dd className="font-semibold tabular-nums">{report.units}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt>Value at cost</dt>
          <dd className="font-semibold tabular-nums">{money(report.costValue)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt>Value at MRP</dt>
          <dd className="font-semibold tabular-nums">{money(report.mrpValue)}</dd>
        </div>
      </dl>
      {report.examples.length > 0 && (
        <div>
          <p className="font-medium">Is this how the quantities read?</p>
          <ul className="mt-1 list-disc pl-5">
            {report.examples.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}
      {report.expiredBatches > 0 && (
        <p>
          {report.expiredBatches} expired {report.expiredBatches === 1 ? "batch" : "batches"} ({report.expiredUnits} units) will be recorded so they can go back to the supplier or be written off. They cannot be sold.
        </p>
      )}
      {(report.missingCost > 0 || report.missingMrp > 0) && (
        <p>
          {report.missingCost > 0 ? `${report.missingCost} ${report.missingCost === 1 ? "batch has" : "batches have"} no cost` : ""}
          {report.missingCost > 0 && report.missingMrp > 0 ? " and " : ""}
          {report.missingMrp > 0 ? `${report.missingMrp} no MRP` : ""}, and {report.missingCost + report.missingMrp === 1 ? "is" : "are"} left out of the values above. A batch with no MRP sells at the item&apos;s price.
        </p>
      )}
    </div>
  );
}

function Comparison({ result, currency }: { result: StockComparison; currency: string }) {
  const money = (v: string) => formatMoney(v, currency);
  const clean = result.different.length + result.missing.length + result.extra.length === 0;
  const row = (l: { name: string; batchNo: string; expiryDate: string }, detail: string, i: number) => (
    <li key={i} className="flex flex-wrap justify-between gap-x-4">
      <span>
        {l.name} <span className="font-mono text-xs">{l.batchNo}</span> <span className="text-xs">exp {l.expiryDate.slice(0, 7)}</span>
      </span>
      <span className="font-medium tabular-nums">{detail}</span>
    </li>
  );
  return (
    <div className={clean ? "rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200" : "rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200"} role="status">
      <p className="font-semibold">{clean ? `Every batch matches: ${result.matched} batches.` : `${result.matched} batches match. ${result.different.length + result.missing.length + result.extra.length} do not.`}</p>
      <dl className="mt-2 grid gap-x-6 gap-y-1 sm:grid-cols-2">
        <div className="flex justify-between gap-3">
          <dt>Units in the file</dt>
          <dd className="font-semibold tabular-nums">{result.fileUnits}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt>Units here</dt>
          <dd className="font-semibold tabular-nums">{result.systemUnits}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt>At cost in the file</dt>
          <dd className="font-semibold tabular-nums">{money(result.fileCost)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt>At cost here</dt>
          <dd className="font-semibold tabular-nums">{money(result.systemCost)}</dd>
        </div>
      </dl>
      {result.different.length > 0 && (
        <div className="mt-3">
          <p className="font-medium">Different quantity</p>
          <ul className="mt-1 max-h-60 space-y-1 overflow-y-auto">{result.different.map((l, i) => row(l, `file ${l.file}, here ${l.system}`, i))}</ul>
        </div>
      )}
      {result.missing.length > 0 && (
        <div className="mt-3">
          <p className="font-medium">In the file, not here</p>
          <ul className="mt-1 max-h-60 space-y-1 overflow-y-auto">{result.missing.map((l, i) => row(l, `${l.file} units`, i))}</ul>
        </div>
      )}
      {result.extra.length > 0 && (
        <div className="mt-3">
          <p className="font-medium">Here, not in the file</p>
          <ul className="mt-1 max-h-60 space-y-1 overflow-y-auto">{result.extra.map((l, i) => row(l, `${l.system} units`, i))}</ul>
        </div>
      )}
    </div>
  );
}

export function StockImportFlow({ currency }: { currency: string }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [basis, setBasis] = useState<QuantityBasis | null>(null);
  const [report, setReport] = useState<StockImportReport | null>(null);
  const [comparison, setComparison] = useState<StockComparison | null>(null);
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState<"check" | "import" | "compare" | null>(null);

  const clear = () => {
    setReport(null);
    setComparison(null);
  };

  async function choose(selected: File | undefined) {
    clear();
    if (!selected) return setFile(null);
    if (selected.size > MAX_IMPORT_BYTES) {
      toast.error("The file is larger than 2 MB. Split it into smaller files.");
      return setFile(null);
    }
    setFile({ name: selected.name, text: await selected.text() });
    setKey(crypto.randomUUID());
  }

  async function check() {
    if (!file || !basis) return;
    clear();
    setBusy("check");
    const result = await checkStockImportAction({ fileName: file.name, csv: file.text, basis });
    setBusy(null);
    if (!result.ok) return toast.error(result.error);
    setReport(result.data);
  }

  async function compare() {
    if (!file || !basis) return;
    clear();
    setBusy("compare");
    const result = await compareStockAction({ fileName: file.name, csv: file.text, basis });
    setBusy(null);
    if (!result.ok) return toast.error(result.error);
    setComparison(result.data);
  }

  async function runImport() {
    if (!file || !basis) return;
    setBusy("import");
    const result = await runStockImportAction({ fileName: file.name, csv: file.text, basis, idempotencyKey: key });
    setBusy(null);
    if (!result.ok) return toast.error(result.error);
    if (result.data.status === "rejected") {
      setReport(result.data.report);
      return toast.error("Nothing was imported. Fix the problems listed and try again.");
    }
    toast.success(`Imported: ${result.data.newItems} new items, ${result.data.batches} batches, ${result.data.units} units`);
    setFile(null);
    setBasis(null);
    clear();
    setKey(crypto.randomUUID());
    startTransition(() => router.refresh());
  }

  const ready = report && report.problems.length === 0 && report.rows > 0;

  return (
    <div className="space-y-5">
      <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-zinc-200 px-6 py-10 text-center transition-colors hover:border-(--accent-soft-border) hover:bg-(--accent-soft) dark:border-zinc-800">
        <FileUp className="h-8 w-8 text-(--accent-text)" aria-hidden />
        <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{file ? file.name : "Choose a CSV file"}</span>
        <span className="text-xs text-zinc-500">Up to 3,000 rows and 2 MB per file. From Excel: Save As → CSV.</span>
        <input type="file" accept=".csv,text/csv" aria-label="CSV file" className="sr-only" onChange={(e) => choose(e.target.files?.[0])} />
      </label>

      <fieldset>
        <legend className="text-sm font-medium text-zinc-700 dark:text-zinc-300">What does the quantity column count?</legend>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          {BASES.map((b) => (
            <label key={b.value} className="flex cursor-pointer items-start gap-3 rounded-xl border border-zinc-200 px-4 py-3 has-[:checked]:border-(--accent-soft-border) has-[:checked]:bg-(--accent-soft) dark:border-zinc-800">
              <input
                type="radio"
                name="basis"
                checked={basis === b.value}
                onChange={() => {
                  setBasis(b.value);
                  clear();
                }}
                className="mt-0.5 h-4 w-4 accent-(--accent)"
              />
              <span>
                <span className="block text-sm font-medium text-zinc-900 dark:text-zinc-100">{b.label}</span>
                <span className="block text-xs text-zinc-500">{b.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" onClick={compare} disabled={!file || !basis || busy !== null} className={buttonClass("ghost", "md")}>
          {busy === "compare" ? <Loader2 className="h-4 w-4 animate-spin" /> : <GitCompare className="h-4 w-4" />}
          Compare with stock here
        </button>
        <button type="button" onClick={check} disabled={!file || !basis || busy !== null} className={buttonClass("secondary", "md")}>
          {busy === "check" && <Loader2 className="h-4 w-4 animate-spin" />}
          Check file
        </button>
        {ready && (
          <button type="button" onClick={runImport} disabled={busy !== null} className={buttonClass("primary", "md")}>
            {busy === "import" && <Loader2 className="h-4 w-4 animate-spin" />}
            Import {report.rows} rows
          </button>
        )}
      </div>

      {report && (report.problems.length === 0 ? <Totals report={report} currency={currency} /> : <Problems problems={report.problems} rows={report.rows} />)}
      {comparison && (comparison.problems.length > 0 ? <Problems problems={comparison.problems} rows={0} /> : <Comparison result={comparison} currency={currency} />)}
    </div>
  );
}
