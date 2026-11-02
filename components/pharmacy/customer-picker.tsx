"use client";

// Choose a named pharmacy customer (credit, B2B) at the counter, or add one.
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Building2, Loader2, Search, UserPlus, X } from "lucide-react";
import { ActionForm, Field, SubmitButton, TextInput, inputClass } from "@/components/app/form";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { saveCustomerAction, searchCustomersAction } from "@/features/pharmacy/accounts.actions";
import { cn } from "@/lib/utils";

export type PickedCustomer = { id: string; name: string; phone: string | null; gstin: string | null; creditLimit: string | null };

export function CustomerPicker({ value, onChange, canSetCredit }: { value: PickedCustomer | null; onChange: (c: PickedCustomer | null) => void; canSetCredit: boolean }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PickedCustomer[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [adding, setAdding] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef(0);

  function search(v: string) {
    setQuery(v);
    clearTimeout(timer.current);
    if (v.trim().length < 2) return setResults(null);
    const request = ++latest.current;
    timer.current = setTimeout(async () => {
      setSearching(true);
      const result = await searchCustomersAction({ query: v });
      if (request !== latest.current) return;
      setSearching(false);
      if (result.ok) setResults(result.data);
      else toast.error(result.error);
    }, 250);
  }

  if (value) {
    return (
      <div className="flex items-start justify-between gap-3 rounded-xl border border-(--accent-soft-border) bg-(--accent-soft)/60 px-3 py-2.5">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            {value.gstin && <Building2 className="h-4 w-4 text-(--accent-text)" aria-hidden />}
            <span className="truncate">{value.name}</span>
          </p>
          <p className="truncate text-xs text-zinc-500">
            {[value.phone, value.gstin ? `GSTIN ${value.gstin}` : null, value.creditLimit ? `credit limit ₹${value.creditLimit}` : null].filter(Boolean).join(" · ") || "Named customer"}
          </p>
        </div>
        <button type="button" onClick={() => onChange(null)} className="rounded-lg p-1 text-zinc-500 hover:bg-white dark:hover:bg-zinc-800" aria-label="Remove customer">
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" aria-hidden />
      <input
        type="search"
        aria-label="Find a customer"
        value={query}
        onChange={(e) => search(e.target.value)}
        placeholder="Named customer (credit, GST buyer)"
        className={cn(inputClass, "h-11 pl-9")}
        autoComplete="off"
      />
      {searching && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-zinc-400" aria-hidden />}
      {results && (
        <ul className="absolute z-20 mt-2 max-h-64 w-full divide-y divide-zinc-100 overflow-y-auto rounded-2xl border border-zinc-200 bg-white shadow-xl dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900" aria-label="Customers">
          {results.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => {
                  onChange(c);
                  setResults(null);
                  setQuery("");
                }}
                className="block w-full px-4 py-2.5 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800/60"
              >
                <span className="block text-sm font-medium text-zinc-900 dark:text-zinc-100">{c.name}</span>
                <span className="block text-xs text-zinc-500">{[c.phone, c.gstin].filter(Boolean).join(" · ") || "—"}</span>
              </button>
            </li>
          ))}
          <li>
            <button type="button" onClick={() => setAdding(true)} className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm font-medium text-(--accent-text) hover:bg-(--accent-soft)">
              <UserPlus className="h-4 w-4" /> New customer “{query.trim()}”
            </button>
          </li>
        </ul>
      )}
      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent className="rounded-3xl sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-xl">New customer</DialogTitle>
            <DialogDescription>For credit sales and GST-registered buyers. Walk-in cash buyers need no record.</DialogDescription>
          </DialogHeader>
          <ActionForm
            action={saveCustomerAction}
            successMessage="Customer added"
            refresh={false}
            onSuccess={(c: PickedCustomer) => {
              setAdding(false);
              setResults(null);
              setQuery("");
              onChange(c);
            }}
          >
            <Field label="Name" name="name" required>
              <TextInput name="name" defaultValue={query.trim()} key={query} />
            </Field>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Phone" name="phone">
                <TextInput name="phone" type="tel" />
              </Field>
              <Field label="GSTIN" name="gstin" hint="For a registered buyer">
                <TextInput name="gstin" className="uppercase placeholder:normal-case" maxLength={15} />
              </Field>
            </div>
            <Field label="Address" name="address">
              <TextInput name="address" />
            </Field>
            {canSetCredit && (
              <Field label="Credit limit (₹)" name="creditLimit" hint="Empty: no limit">
                <TextInput name="creditLimit" inputMode="decimal" />
              </Field>
            )}
            <div className="flex justify-end">
              <SubmitButton>Add customer</SubmitButton>
            </div>
          </ActionForm>
        </DialogContent>
      </Dialog>
    </div>
  );
}
