"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Search, Star } from "lucide-react";
import { buttonClass } from "@/components/app/buttons";
import { inputClass } from "@/components/app/form";
import { addDiagnosisAction, searchDiagnosisCodesAction } from "@/features/clinical/clinical.actions";
import type { DiagnosisOption } from "@/features/clinical/diagnoses.service";
import { cn } from "@/lib/utils";

export function DiagnosisPicker({ encounterId, favourites }: { encounterId: string; favourites: DiagnosisOption[] }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<DiagnosisOption[] | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [custom, setCustom] = useState(false);
  const [customCode, setCustomCode] = useState("");
  const [customLabel, setCustomLabel] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef(0);

  function onQuery(value: string) {
    setQuery(value);
    clearTimeout(timer.current);
    if (!value.trim()) {
      setResults(null);
      return;
    }
    const request = ++latest.current;
    timer.current = setTimeout(async () => {
      const result = await searchDiagnosisCodesAction({ query: value });
      if (request !== latest.current) return;
      if (result.ok) setResults(result.data);
      else toast.error(result.error);
    }, 200);
  }

  async function add(code: string, label: string) {
    setPending(code);
    const result = await addDiagnosisAction({ encounterId, code, label });
    setPending(null);
    if (!result.ok) {
      toast.error(result.fieldErrors ? Object.values(result.fieldErrors)[0] : result.error);
      return;
    }
    setQuery("");
    setResults(null);
    setCustom(false);
    setCustomCode("");
    setCustomLabel("");
    startTransition(() => router.refresh());
  }

  const shown = results ?? favourites;

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" aria-hidden />
        <input
          type="search"
          aria-label="Search diagnoses"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="Search ICD-10 by code or name, e.g. J06 or fever"
          className={cn(inputClass, "h-11 pl-10")}
        />
      </div>

      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">{results ? "Matches" : "Clinic favourites"}</p>
        {shown.length === 0 ? (
          <p className="text-sm text-zinc-500">{results ? "No codes match. Add it as a custom code below." : "No favourites set up yet."}</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {shown.map((d) => (
              <li key={d.id} className="max-w-full">
                <button
                  type="button"
                  disabled={pending !== null}
                  onClick={() => add(d.code, d.label)}
                  className="inline-flex max-w-full items-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-left text-sm transition-colors hover:border-(--accent-soft-border) hover:bg-(--accent-soft) disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-950"
                >
                  {d.isFavourite && <Star className="h-3.5 w-3.5 flex-shrink-0 fill-amber-400 text-amber-400" aria-label="Favourite" />}
                  <span className="font-mono text-xs font-semibold text-(--accent-text)">{d.code}</span>
                  <span className="truncate text-zinc-700 dark:text-zinc-300">{d.label}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {custom ? (
        <div className="grid gap-3 rounded-2xl border border-dashed border-zinc-200 p-4 sm:grid-cols-[8rem_1fr_auto] sm:items-end dark:border-zinc-800">
          <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Code
            <input value={customCode} onChange={(e) => setCustomCode(e.target.value)} className={cn(inputClass, "mt-1.5 h-11 font-mono")} />
          </label>
          <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Description
            <input value={customLabel} onChange={(e) => setCustomLabel(e.target.value)} className={cn(inputClass, "mt-1.5 h-11")} />
          </label>
          <button
            type="button"
            disabled={pending !== null || !customCode.trim() || !customLabel.trim()}
            onClick={() => add(customCode, customLabel)}
            className={buttonClass("secondary", "md")}
          >
            Add
          </button>
        </div>
      ) : (
        <button type="button" onClick={() => setCustom(true)} className="inline-flex items-center gap-1.5 text-sm font-medium text-(--accent-text) hover:underline">
          <Plus className="h-4 w-4" /> Custom code
        </button>
      )}
    </div>
  );
}
