"use client";

import { ShieldCheck } from "lucide-react";
import { Count, SuppressionNote } from "@/components/analytics/cells";
import type { CohortRunResult } from "@/features/analytics/analytics.service";

function Breakdown({ title, rows, threshold, suppressed }: { title: string; rows: { label: string; count: number | null }[]; threshold: number; suppressed: number }) {
  return (
    <div className="rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">{title}</p>
      {rows.length === 0 ? (
        <p className="text-sm text-zinc-500">None</p>
      ) : (
        <ul className="space-y-1.5 text-sm">
          {rows.map((r) => (
            <li key={r.label} className="flex justify-between gap-3">
              <span className="truncate text-zinc-800 dark:text-zinc-200">{r.label}</span>
              <Count value={r.count} threshold={threshold} className="font-semibold" />
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3">
        <SuppressionNote suppressed={suppressed} threshold={threshold} />
      </div>
    </div>
  );
}

export function CohortResults({ result }: { result: CohortRunResult }) {
  const t = result.threshold;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-baseline gap-3">
        <p className="text-3xl font-bold text-zinc-900 dark:text-zinc-50">
          <Count value={result.size} threshold={t} />
        </p>
        <p className="text-sm text-zinc-500">patients · version {result.version}</p>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Breakdown
          title="Age and sex"
          threshold={t}
          suppressed={result.ageSex.suppressed}
          rows={result.ageSex.rows.map((r) => ({ label: `${r.band} · ${r.sex}`, count: r.count }))}
        />
        <Breakdown title="Diagnoses" threshold={t} suppressed={result.diagnoses.suppressed} rows={result.diagnoses.rows.map((r) => ({ label: r.code, count: r.count }))} />
        <Breakdown title="Medicines" threshold={t} suppressed={result.medicines.suppressed} rows={result.medicines.rows.map((r) => ({ label: r.generic, count: r.count }))} />
      </div>

      {result.rows.length > 0 ? (
        <div className="overflow-x-auto rounded-2xl border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-sm" aria-label="Cohort members (pseudonymous)">
            <thead>
              <tr className="border-b border-zinc-100 text-left text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:border-zinc-800">
                <th className="px-4 py-2">Pseudonym</th>
                <th className="px-4 py-2">Age band</th>
                <th className="px-4 py-2">Sex</th>
                <th className="px-4 py-2 text-right">Visits</th>
                <th className="px-4 py-2">Diagnoses</th>
                <th className="px-4 py-2">Medicines</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {result.rows.map((r) => (
                <tr key={r.pseudonym}>
                  <td className="px-4 py-2 font-mono text-xs">{r.pseudonym}</td>
                  <td className="px-4 py-2">{r.ageBand}</td>
                  <td className="px-4 py-2">{r.sex}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{r.visits}</td>
                  <td className="px-4 py-2 font-mono text-xs">{r.diagnosisCodes.join(", ") || "—"}</td>
                  <td className="px-4 py-2 text-xs">{r.medicineGenerics.join(", ") || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="flex items-center gap-1.5 border-t border-zinc-100 px-4 py-2 text-xs text-zinc-500 dark:border-zinc-800">
            <ShieldCheck className="h-3.5 w-3.5" /> Pseudonyms belong to this cohort only and cannot be matched with other cohorts. Showing up to 100.
            {result.rowsWithheld > 0 && ` ${result.rowsWithheld} rows in age/sex groups smaller than ${t} are withheld.`}
          </p>
        </div>
      ) : (
        <p className="text-sm text-zinc-500">Row-level results are only shown for cohorts of {t} or more patients.</p>
      )}
    </div>
  );
}
