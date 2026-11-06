"use client";

// Finds any item in the clinic's list by any of its names, in stock or not.
// Used where something is being accounted for rather than bought or sold: a
// batch found during a count, an item coming back on an old bill.
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2, Search, X } from "lucide-react";
import { inputClass } from "@/components/app/form";
import type { ItemOption } from "@/features/catalog/items.service";
import type { ActionResult } from "@/lib/action-result";
import { cn } from "@/lib/utils";

export function ItemSearch({
  label,
  item,
  onPick,
  search,
}: {
  label: string;
  item: ItemOption | null;
  onPick: (item: ItemOption | null) => void;
  search: (input: { query: string }) => Promise<ActionResult<ItemOption[]>>;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ItemOption[] | null>(null);
  const [searching, setSearching] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef(0);

  function type(value: string) {
    setQuery(value);
    clearTimeout(timer.current);
    if (value.trim().length < 2) return setResults(null);
    const request = ++latest.current;
    timer.current = setTimeout(async () => {
      setSearching(true);
      const result = await search({ query: value });
      if (request !== latest.current) return;
      setSearching(false);
      if (result.ok) setResults(result.data);
      else toast.error(result.error);
    }, 250);
  }

  if (item) {
    return (
      <div className="flex items-start justify-between gap-3 rounded-xl border border-(--accent-soft-border) bg-(--accent-soft)/60 px-3 py-2">
        <p className="min-w-0 truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">{[item.name, item.strength].filter(Boolean).join(" ")}</p>
        <button type="button" aria-label={`Clear ${label}`} onClick={() => onPick(null)} className="rounded-lg p-1 text-zinc-500 hover:bg-white dark:hover:bg-zinc-800">
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" aria-hidden />
      <input type="search" aria-label={label} value={query} onChange={(e) => type(e.target.value)} placeholder="Name, generic or other name" className={cn(inputClass, "h-10 pl-9")} />
      {searching && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-zinc-400" aria-hidden />}
      {results && (
        <ul className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-xl border border-zinc-200 bg-white shadow-lg dark:border-zinc-800 dark:bg-zinc-900">
          {results.length === 0 && <li className="px-3 py-2 text-sm text-zinc-500">No item matches</li>}
          {results.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => {
                  onPick(r);
                  setResults(null);
                  setQuery("");
                }}
                className="block w-full px-3 py-2 text-left text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800"
              >
                <span className="font-medium text-zinc-900 dark:text-zinc-100">{[r.name, r.strength].filter(Boolean).join(" ")}</span>
                <span className="block text-xs text-zinc-500">{[r.genericName, r.manufacturer].filter(Boolean).join(" · ")}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
