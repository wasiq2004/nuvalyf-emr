"use client";

// Picks the catalogue item for a supplier bill line. People type what is
// printed on the bill; search matches the item's name, generic name,
// manufacturer or any other name it is known by, with words in any order.
// Nothing is matched silently: the person picks the item, and a new spelling
// is offered to remember for next time.
import { useEffect, useRef, useState } from "react";
import { Loader2, PackagePlus, Pill, Search, Stethoscope, Syringe, X } from "lucide-react";
import { toast } from "sonner";
import { ActionForm, Field, SelectInput, SubmitButton, TextInput, inputClass } from "@/components/app/form";
import { StatusBadge } from "@/components/app/status-badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { searchBillItemsAction } from "@/features/pharmacy/pharmacy.actions";
import { quickAddItemAction } from "@/features/catalog/catalog.actions";
import { DRUG_FORMS, capitalize } from "@/features/catalog/catalog-options";
import { ITEM_TYPE_LABELS, ITEM_TYPES, type ItemType } from "@/features/catalog/item-rules";
import type { ItemOption } from "@/features/catalog/items.service";
import { cn } from "@/lib/utils";

export const ITEM_ICONS: Record<ItemType, typeof Pill> = { medicine: Pill, consumable: Syringe, instrument: Stethoscope };

export function ItemTypeBadge({ type }: { type: string }) {
  if (type === "medicine") return null;
  return <StatusBadge tone="info">{ITEM_TYPE_LABELS[type as ItemType] ?? type}</StatusBadge>;
}

export function ItemPicker({
  label,
  typed,
  item,
  canAddItems,
  onTyped,
  onPick,
}: {
  /** Accessible name, e.g. "Item, line 2". */
  label: string;
  typed: string;
  item: ItemOption | null;
  canAddItems: boolean;
  onTyped: (value: string) => void;
  /** null clears the choice. */
  onPick: (item: ItemOption | null) => void;
}) {
  const [results, setResults] = useState<ItemOption[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef(0);

  useEffect(() => () => clearTimeout(timer.current), []);

  function search(value: string) {
    onTyped(value);
    clearTimeout(timer.current);
    if (value.trim().length < 2) {
      setResults(null);
      return;
    }
    const request = ++latest.current;
    timer.current = setTimeout(async () => {
      setSearching(true);
      const result = await searchBillItemsAction({ query: value });
      if (request !== latest.current) return;
      setSearching(false);
      if (result.ok) {
        setResults(result.data);
        setOpen(true);
      } else toast.error(result.error);
    }, 250);
  }

  function pick(option: ItemOption) {
    onPick(option);
    setOpen(false);
    setResults(null);
  }

  if (item) {
    const Icon = ITEM_ICONS[item.itemType] ?? Pill;
    return (
      <div className="flex min-w-0 items-center justify-between gap-3 rounded-xl border border-(--accent-soft-border) bg-(--accent-soft)/60 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <Icon className="h-4 w-4 flex-shrink-0 text-(--accent-text)" aria-hidden />
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              <span className="truncate">{item.name}</span> <ItemTypeBadge type={item.itemType} />
            </p>
            <p className="truncate text-xs text-zinc-500">
              {typed && typed.trim().toLowerCase() !== item.name.toLowerCase() ? `On the bill: “${typed}”` : [item.genericName, item.strength].filter(Boolean).join(" · ")}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            onPick(null);
            setOpen(Boolean(results?.length));
          }}
          className="rounded-lg p-1.5 text-zinc-500 hover:bg-white hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          aria-label={`Change item for ${label.toLowerCase()}`}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="relative min-w-0">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" aria-hidden />
      <input
        type="search"
        aria-label={label}
        value={typed}
        onChange={(e) => search(e.target.value)}
        onFocus={() => results && setOpen(true)}
        placeholder="Item as printed on the bill"
        className={cn(inputClass, "h-10 pl-9")}
        autoComplete="off"
      />
      {searching && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-zinc-400" aria-hidden />}
      {open && results && (
        <div className="absolute z-30 mt-2 w-full overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-900">
          {results.length > 0 ? (
            <ul className="max-h-72 divide-y divide-zinc-100 overflow-y-auto dark:divide-zinc-800" role="listbox" aria-label={`Matches for ${label.toLowerCase()}`}>
              {results.map((r) => {
                const Icon = ITEM_ICONS[r.itemType] ?? Pill;
                return (
                  <li key={r.id}>
                    <button type="button" role="option" aria-selected={false} onClick={() => pick(r)} className="flex w-full items-start gap-3 px-4 py-2.5 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800/60">
                      <Icon className="mt-0.5 h-4 w-4 flex-shrink-0 text-(--accent-text)" aria-hidden />
                      <span className="min-w-0">
                        <span className="flex flex-wrap items-center gap-2 text-sm font-medium text-zinc-900 dark:text-zinc-100">
                          {r.name} <ItemTypeBadge type={r.itemType} />
                        </span>
                        <span className="block truncate text-xs text-zinc-500">
                          {r.matchedAlias ? `Known as “${r.matchedAlias}”` : [r.genericName !== r.name ? r.genericName : null, r.strength, r.manufacturer].filter(Boolean).join(" · ") || ITEM_TYPE_LABELS[r.itemType]}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="px-4 py-3 text-sm text-zinc-500">No item matches “{typed.trim()}”.</p>
          )}
          {canAddItems && (
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setAdding(true);
              }}
              className="flex w-full items-center gap-2 border-t border-zinc-100 px-4 py-2.5 text-left text-sm font-medium text-(--accent-text) hover:bg-(--accent-soft) dark:border-zinc-800"
            >
              <PackagePlus className="h-4 w-4" /> Add “{typed.trim()}” as a new item
            </button>
          )}
        </div>
      )}
      <NewItemDialog
        open={adding}
        onOpenChange={setAdding}
        name={typed.trim()}
        onCreated={(created) => {
          setAdding(false);
          pick(created);
        }}
      />
    </div>
  );
}

/** A new catalogue item, created without leaving the bill. */
export function NewItemDialog({
  open,
  onOpenChange,
  name,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  onCreated: (item: ItemOption) => void;
}) {
  const [type, setType] = useState<ItemType>("medicine");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto rounded-3xl sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-xl">Add a new item</DialogTitle>
          <DialogDescription>It joins your clinic&apos;s list. Medicines can also be prescribed; consumables and instruments are only stocked and sold.</DialogDescription>
        </DialogHeader>
        <ActionForm action={quickAddItemAction} successMessage="Item added" refresh={false} onSuccess={onCreated}>
          <Field label="Name" name="name" required>
            <TextInput name="name" defaultValue={name} key={name} />
          </Field>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Type" name="itemType" required>
              <SelectInput name="itemType" value={type} onChange={(e) => setType(e.target.value as ItemType)} options={ITEM_TYPES.map((t) => ({ value: t, label: ITEM_TYPE_LABELS[t] }))} />
            </Field>
            <Field label="Units per pack" name="packSize" required hint="A strip of 10 = 10">
              <TextInput name="packSize" type="number" min={1} defaultValue={1} />
            </Field>
            {type === "medicine" && (
              <>
                <Field label="Generic name" name="genericName" required>
                  <TextInput name="genericName" />
                </Field>
                <Field label="Form" name="form" required>
                  <SelectInput name="form" defaultValue="tablet" options={DRUG_FORMS.map((f) => ({ value: f, label: capitalize(f) }))} />
                </Field>
                <Field label="Strength" name="strength">
                  <TextInput name="strength" placeholder="e.g. 500 mg" />
                </Field>
              </>
            )}
            <Field label="Manufacturer" name="manufacturer">
              <TextInput name="manufacturer" />
            </Field>
            <Field label="Price per unit" name="price">
              <TextInput name="price" inputMode="decimal" />
            </Field>
            <Field label="Price per pack" name="packPrice" hint="Optional: a strip's MRP">
              <TextInput name="packPrice" inputMode="decimal" />
            </Field>
          </div>
          <div className="flex justify-end">
            <SubmitButton>Add item</SubmitButton>
          </div>
        </ActionForm>
      </DialogContent>
    </Dialog>
  );
}
