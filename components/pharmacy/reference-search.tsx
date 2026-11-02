"use client";

// Search the shared Indian medicine list and add entries to the clinic's own
// list. Listed MRPs are shown as a hint only: real prices come from supplier
// bills or are set by the clinic.
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { BookPlus, Check, Loader2, Plus, Search } from "lucide-react";
import { inputClass } from "@/components/app/form";
import { buttonClass } from "@/components/app/buttons";
import { StatusBadge } from "@/components/app/status-badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { addFromReferenceAction, searchReferenceAction } from "@/features/catalog/catalog.actions";
import type { ReferenceHit } from "@/features/catalog/reference.service";
import type { ItemOption } from "@/features/catalog/items.service";
import { cn } from "@/lib/utils";

const rupees = (v: string) => `₹${Number(v).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** One list entry: name, maker, composition, pack and listed MRP. */
export function ReferenceHitText({ hit }: { hit: ReferenceHit }) {
  return (
    <span className="min-w-0">
      <span className="flex flex-wrap items-center gap-2 text-sm font-medium text-zinc-900 dark:text-zinc-100">
        {hit.name}
        {hit.discontinued && <StatusBadge tone="warning">Discontinued</StatusBadge>}
      </span>
      <span className="block truncate text-xs text-zinc-500">{[hit.composition ?? hit.genericName, hit.manufacturer].filter(Boolean).join(" · ")}</span>
      <span className="block text-xs text-zinc-500">
        {hit.packLabel}
        {hit.mrp ? ` · listed MRP ${rupees(hit.mrp)}` : ""}
      </span>
    </span>
  );
}

/** Debounced search over the list; the latest answer wins. */
export function useReferenceSearch() {
  const [results, setResults] = useState<ReferenceHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef(0);
  function search(value: string) {
    clearTimeout(timer.current);
    if (value.trim().length < 3) {
      setResults(null);
      return;
    }
    const request = ++latest.current;
    timer.current = setTimeout(async () => {
      setSearching(true);
      const result = await searchReferenceAction({ query: value });
      if (request !== latest.current) return;
      setSearching(false);
      if (result.ok) setResults(result.data);
      else toast.error(result.error);
    }, 300);
  }
  return { results, searching, search, setResults };
}

export async function addReference(hit: ReferenceHit): Promise<ItemOption | null> {
  const result = await addFromReferenceAction({ referenceId: hit.id });
  if (!result.ok) {
    toast.error(result.error);
    return null;
  }
  return result.data;
}

/** Catalogue: "Add from the Indian medicine list". */
export function ReferenceMedicineDialog({ size }: { size: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState<number | null>(null);
  const [added, setAdded] = useState<Set<number>>(new Set());
  const { results, searching, search } = useReferenceSearch();

  async function add(hit: ReferenceHit) {
    setAdding(hit.id);
    const item = await addReference(hit);
    setAdding(null);
    if (!item) return;
    setAdded((prev) => new Set(prev).add(hit.id));
    toast.success(`${item.name} is in your list`);
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={buttonClass("secondary", "md")}>
        <BookPlus className="h-4 w-4" /> Add from Indian medicine list
      </button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next && added.size) router.refresh();
        }}
      >
        <DialogContent className="max-h-[92vh] overflow-y-auto rounded-3xl sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-xl">Indian medicine list</DialogTitle>
            <DialogDescription>
              {size > 0 ? `${size.toLocaleString("en-IN")} medicines by brand.` : "The list has not been loaded on this server yet."} Adding one copies it into your list, ready to stock, sell and prescribe. Listed MRPs may be out of date: prices are set from supplier bills.
            </DialogDescription>
          </DialogHeader>
          <div className="relative mt-2">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" aria-hidden />
            <input
              type="search"
              aria-label="Search the Indian medicine list"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                search(e.target.value);
              }}
              placeholder="Brand name, e.g. Dolo 650 or Augmentin"
              className={cn(inputClass, "h-12 pl-10 text-base")}
              autoFocus
            />
            {searching && <Loader2 className="absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-zinc-400" aria-hidden />}
          </div>
          {results &&
            (results.length === 0 ? (
              <p className="py-4 text-center text-sm text-zinc-500">Nothing in the list matches “{query.trim()}”. Use Add item to create it yourself.</p>
            ) : (
              <ul className="mt-3 divide-y divide-zinc-100 dark:divide-zinc-800" aria-label="Medicines in the list">
                {results.map((hit) => {
                  const inList = Boolean(hit.clinicDrugId) || added.has(hit.id);
                  return (
                    <li key={hit.id} className="flex items-center justify-between gap-3 py-3">
                      <ReferenceHitText hit={hit} />
                      {inList ? (
                        <span className="inline-flex flex-shrink-0 items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                          <Check className="h-3.5 w-3.5" /> In your list
                        </span>
                      ) : (
                        <button type="button" onClick={() => add(hit)} disabled={adding !== null} className={buttonClass("secondary", "sm", "flex-shrink-0")} aria-label={`Add ${hit.name}`}>
                          {adding === hit.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Add
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            ))}
        </DialogContent>
      </Dialog>
    </>
  );
}
