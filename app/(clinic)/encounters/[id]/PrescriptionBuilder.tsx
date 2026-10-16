"use client";

// Choose a medicine, see the allergy / interaction check immediately, fill in
// the dose with the clinic's presets, add it. The server runs the same check
// again when the item is saved.
import { useRef, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Pill, Search, ShieldAlert, X } from "lucide-react";
import { ActionForm, Field, SubmitButton, TextArea, TextInput, inputClass } from "@/components/app/form";
import { StatusBadge } from "@/components/app/status-badge";
import { addPrescriptionItemAction, checkDrugAction, searchDrugsAction } from "@/features/clinical/clinical.actions";
import type { DrugOption, PrescriptionPresets } from "@/features/clinical/prescriptions.service";
import { SEVERITY_LABELS, type RxWarning } from "@/features/clinical/prescribing-rules";
import { cn } from "@/lib/utils";

export function WarningList({ warnings }: { warnings: RxWarning[] }) {
  if (warnings.length === 0) return null;
  return (
    <ul className="space-y-1.5">
      {warnings.map((w, i) => {
        const serious = w.severity === "allergy" || w.severity === "major" || w.severity === "contraindicated";
        return (
          <li
            key={i}
            className={cn(
              "flex items-start gap-2 rounded-xl border px-3 py-2 text-sm",
              serious
                ? "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
                : "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300",
            )}
          >
            {w.kind === "allergy" ? <ShieldAlert className="mt-0.5 h-4 w-4 flex-shrink-0" /> : <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />}
            <span>
              <span className="font-semibold">{SEVERITY_LABELS[w.severity]}:</span> {w.message}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function Chips({ options, onPick, active }: { options: { label: string; value: string }[]; onPick: (value: string) => void; active: string }) {
  if (options.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={o.label}
          type="button"
          onClick={() => onPick(o.value)}
          title={o.label}
          className={cn(
            "rounded-lg border px-2 py-1 text-xs font-medium transition-colors",
            active === o.value
              ? "border-(--accent-soft-border) bg-(--accent-soft) text-(--accent-text)"
              : "border-zinc-200 text-zinc-600 hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800",
          )}
        >
          {o.value.length <= 6 ? o.value : o.label}
        </button>
      ))}
    </div>
  );
}

export function PrescriptionBuilder({ encounterId, presets }: { encounterId: string; presets: PrescriptionPresets }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<DrugOption[]>([]);
  const [drug, setDrug] = useState<DrugOption | null>(null);
  const [check, setCheck] = useState<{ warnings: RxWarning[]; needsOverride: boolean } | null>(null);
  const [dose, setDose] = useState("");
  const [frequency, setFrequency] = useState("");
  const [duration, setDuration] = useState("");
  const [instructions, setInstructions] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef(0);

  function onQuery(value: string) {
    setQuery(value);
    clearTimeout(timer.current);
    if (!value.trim()) {
      setResults([]);
      return;
    }
    const request = ++latest.current;
    timer.current = setTimeout(async () => {
      const result = await searchDrugsAction({ query: value });
      if (request !== latest.current) return;
      if (result.ok) setResults(result.data);
      else toast.error(result.error);
    }, 200);
  }

  async function choose(option: DrugOption) {
    setDrug(option);
    setResults([]);
    setQuery("");
    setDose(option.defaultDose ?? "");
    setFrequency(option.defaultFrequency ?? "");
    setDuration(option.defaultDurationDays ? String(option.defaultDurationDays) : "");
    setInstructions(option.defaultInstructions ?? "");
    setCheck(null);
    const result = await checkDrugAction({ encounterId, drugId: option.id });
    if (result.ok) setCheck(result.data);
    else {
      toast.error(result.error);
      setDrug(null);
    }
  }

  function reset() {
    setDrug(null);
    setCheck(null);
  }

  if (!drug) {
    return (
      <div className="space-y-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" aria-hidden />
          <input
            type="search"
            aria-label="Search medicines"
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder="Add a medicine: type a brand or generic name"
            className={cn(inputClass, "h-11 pl-10")}
          />
        </div>
        {results.length > 0 && (
          <ul className="max-h-72 divide-y divide-zinc-100 overflow-y-auto rounded-2xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {results.map((r) => (
              <li key={r.id}>
                <button type="button" onClick={() => choose(r)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800/60">
                  <Pill className="h-4 w-4 flex-shrink-0 text-(--accent-text)" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">{r.name}</span>
                    <span className="block truncate text-xs text-zinc-500">
                      {r.genericName} · {r.form}
                      {r.strength ? ` · ${r.strength}` : ""}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {query.trim() && results.length === 0 && <p className="px-1 text-xs text-zinc-500">No medicine in the clinic&apos;s list matches.</p>}
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-2xl border border-(--accent-soft-border) bg-(--accent-soft)/40 p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-zinc-900 dark:text-zinc-100">{drug.name}</p>
          <p className="text-xs text-zinc-500">
            {drug.genericName} · {drug.form}
            {drug.strength ? ` · ${drug.strength}` : ""}
          </p>
        </div>
        <button type="button" onClick={reset} className="rounded-lg p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800" aria-label="Choose another medicine">
          <X className="h-4 w-4" />
        </button>
      </div>

      {check === null ? (
        <p className="text-sm text-zinc-500">Checking allergies and interactions…</p>
      ) : check.warnings.length === 0 ? (
        <StatusBadge tone="success">No allergy or interaction found</StatusBadge>
      ) : (
        <WarningList warnings={check.warnings} />
      )}

      <ActionForm
        action={addPrescriptionItemAction}
        successMessage={`${drug.name} added`}
        onSuccess={reset}
      >
        <input type="hidden" name="encounterId" value={encounterId} />
        <input type="hidden" name="drugId" value={drug.id} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Dose" name="dose" required>
            <TextInput name="dose" value={dose} onChange={(e) => setDose(e.target.value)} placeholder="e.g. 1 tablet" />
          </Field>
          <Field label="Frequency" name="frequency" required>
            <TextInput name="frequency" value={frequency} onChange={(e) => setFrequency(e.target.value)} placeholder="e.g. BD" />
          </Field>
        </div>
        <Chips options={presets.frequency} active={frequency} onPick={setFrequency} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Duration (days)" name="durationDays">
            <TextInput name="durationDays" type="number" min={1} max={365} value={duration} onChange={(e) => setDuration(e.target.value)} />
          </Field>
          <Field label="Quantity" name="quantity" hint="Optional: units to dispense.">
            <TextInput name="quantity" type="number" min={1} />
          </Field>
        </div>
        <Chips options={presets.duration} active={duration} onPick={setDuration} />
        <Field label="Instructions" name="instructions">
          <TextInput name="instructions" value={instructions} onChange={(e) => setInstructions(e.target.value)} />
        </Field>
        <Chips options={presets.instruction} active={instructions} onPick={setInstructions} />
        {check?.needsOverride && (
          <Field label="Reason to prescribe despite the warning" name="overrideReason" required>
            <TextArea name="overrideReason" rows={2} placeholder="Recorded on the prescription item and in the audit trail" />
          </Field>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={reset} className="rounded-xl px-4 py-2.5 text-sm font-semibold text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800">
            Cancel
          </button>
          <SubmitButton variant={check?.needsOverride ? "danger" : "primary"}>{check?.needsOverride ? "Prescribe anyway" : "Add to prescription"}</SubmitButton>
        </div>
      </ActionForm>
    </div>
  );
}
