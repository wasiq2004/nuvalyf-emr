"use client";

// Upload -> check -> import, the same way as stock: the totals are shown to be
// set beside the old software's report, and only a clean file can go in.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2, FileUp, Loader2, TriangleAlert } from "lucide-react";
import { buttonClass } from "@/components/app/buttons";
import { checkBalanceImportAction, runBalanceImportAction } from "@/features/pharmacy/accounts.actions";
import type { BalanceReport } from "@/features/pharmacy/opening-balances.service";
import { MAX_IMPORT_BYTES } from "@/features/import/import-rules";
import { formatMoney } from "@/lib/money";

export function BalanceImportFlow({ currency }: { currency: string }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [report, setReport] = useState<BalanceReport | null>(null);
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState<"check" | "import" | null>(null);
  const money = (v: string) => formatMoney(v, currency);

  async function choose(selected: File | undefined) {
    setReport(null);
    if (!selected) return setFile(null);
    if (selected.size > MAX_IMPORT_BYTES) {
      toast.error("The file is larger than 2 MB. Split it into smaller files.");
      return setFile(null);
    }
    setFile({ name: selected.name, text: await selected.text() });
    setKey(crypto.randomUUID());
  }

  async function check() {
    if (!file) return;
    setBusy("check");
    const result = await checkBalanceImportAction({ fileName: file.name, csv: file.text });
    setBusy(null);
    if (!result.ok) return toast.error(result.error);
    setReport(result.data);
  }

  async function run() {
    if (!file) return;
    setBusy("import");
    const result = await runBalanceImportAction({ fileName: file.name, csv: file.text, idempotencyKey: key });
    setBusy(null);
    if (!result.ok) return toast.error(result.error);
    if (result.data.status === "rejected") {
      setReport(result.data.report);
      return toast.error("Nothing was imported. Fix the problems listed and try again.");
    }
    toast.success("Opening balances imported");
    setFile(null);
    setReport(null);
    setKey(crypto.randomUUID());
    startTransition(() => router.refresh());
  }

  const ready = report && report.problems.length === 0 && report.rows > 0;

  return (
    <div className="space-y-5">
      <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-zinc-200 px-6 py-10 text-center transition-colors hover:border-(--accent-soft-border) hover:bg-(--accent-soft) dark:border-zinc-800">
        <FileUp className="h-8 w-8 text-(--accent-text)" aria-hidden />
        <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{file ? file.name : "Choose a CSV file"}</span>
        <span className="text-xs text-zinc-500">Up to 2,000 rows and 2 MB per file. From Excel: Save As → CSV.</span>
        <input type="file" accept=".csv,text/csv" aria-label="CSV file" className="sr-only" onChange={(e) => choose(e.target.files?.[0])} />
      </label>

      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" onClick={check} disabled={!file || busy !== null} className={buttonClass("secondary", "md")}>
          {busy === "check" && <Loader2 className="h-4 w-4 animate-spin" />}
          Check file
        </button>
        {ready && (
          <button type="button" onClick={run} disabled={busy !== null} className={buttonClass("primary", "md")}>
            {busy === "import" && <Loader2 className="h-4 w-4 animate-spin" />}
            Import {report.rows} rows
          </button>
        )}
      </div>

      {report &&
        (report.problems.length === 0 ? (
          <div role="status" className="flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
            <CheckCircle2 className="mt-0.5 h-5 w-5 flex-shrink-0" />
            <p>
              All {report.rows} rows are valid: {report.customers} {report.customers === 1 ? "customer" : "customers"} owing {money(report.customerTotal)}, and {report.suppliers} {report.suppliers === 1 ? "supplier" : "suppliers"} owed {money(report.supplierTotal)}
              {report.newParties ? `. ${report.newParties} will be added to your list` : ""}. Set these totals beside the old software&apos;s outstanding report before importing.
            </p>
          </div>
        ) : (
          <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
            <p className="flex items-center gap-2 font-semibold">
              <TriangleAlert className="h-4 w-4" />
              {report.problems.length} {report.problems.length === 1 ? "problem" : "problems"} in {report.rows} rows. Nothing will be imported until they are fixed.
            </p>
            <ul className="mt-3 max-h-80 space-y-1 overflow-y-auto">
              {report.problems.map((p, i) => (
                <li key={i}>
                  <span className="font-mono font-semibold">Line {p.line}</span>: {p.message}
                </li>
              ))}
            </ul>
          </div>
        ))}
    </div>
  );
}
