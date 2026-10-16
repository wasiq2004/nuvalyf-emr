"use client";

// Cohort definition form. Only the fields a cohort may select on exist here;
// the server refuses anything else.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Archive, Loader2, Pencil, Play, Plus } from "lucide-react";
import { inputClass } from "@/components/app/form";
import { buttonClass } from "@/components/app/buttons";
import { ConfirmAction } from "@/components/app/dialogs";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { archiveCohortAction, createCohortAction, runCohortAction, updateCohortAction } from "@/features/analytics/analytics.actions";
import type { CohortRunResult } from "@/features/analytics/analytics.service";
import type { CohortDefinition } from "@/features/analytics/analytics-rules";
import { cn } from "@/lib/utils";
import { CohortResults } from "./CohortResults";

type Values = { id?: string; name: string; purpose: string; definition: CohortDefinition };

const list = (text: string) =>
  text
    .split(/[,\n]/)
    .map((v) => v.trim())
    .filter(Boolean);

export function CohortDialog({ values, defaults }: { values?: Values; defaults: { from: string; to: string } }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const editing = Boolean(values?.id);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [form, setForm] = useState(() => ({
    name: values?.name ?? "",
    purpose: values?.purpose ?? "",
    from: values?.definition.from ?? defaults.from,
    to: values?.definition.to ?? defaults.to,
    diagnoses: values?.definition.diagnosisPrefixes.join(", ") ?? "",
    generics: values?.definition.drugGenerics.join(", ") ?? "",
    sex: values?.definition.sex ?? "",
    ageMin: values?.definition.ageMin?.toString() ?? "",
    ageMax: values?.definition.ageMax?.toString() ?? "",
  }));
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [key]: e.target.value }));

  async function save() {
    setPending(true);
    setErrors({});
    const definition = {
      from: form.from,
      to: form.to,
      diagnosisPrefixes: list(form.diagnoses),
      drugGenerics: list(form.generics),
      ...(form.sex ? { sex: form.sex } : {}),
      ...(form.ageMin ? { ageMin: Number(form.ageMin) } : {}),
      ...(form.ageMax ? { ageMax: Number(form.ageMax) } : {}),
    };
    const payload = { name: form.name, purpose: form.purpose, definition };
    const result = editing ? await updateCohortAction({ id: values!.id, ...payload }) : await createCohortAction(payload);
    setPending(false);
    if (!result.ok) {
      setErrors(result.fieldErrors ?? {});
      return toast.error(result.error);
    }
    toast.success(editing ? "Cohort saved" : "Cohort created");
    setOpen(false);
    if (!editing && "id" in result.data) router.push(`/analytics/cohorts/${result.data.id}`);
    else startTransition(() => router.refresh());
  }

  const label = "block text-sm font-medium text-zinc-700 dark:text-zinc-300";
  const err = (key: string) => {
    const message = Object.entries(errors).find(([k]) => k === key || k === `definition.${key}`)?.[1];
    return message ? <span className="mt-1 block text-xs font-medium text-red-600">{message}</span> : null;
  };

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={buttonClass(editing ? "secondary" : "primary", "md")}>
        {editing ? <Pencil className="h-4 w-4" /> : <Plus className="h-4 w-4" />} {editing ? "Edit" : "New cohort"}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92vh] overflow-y-auto rounded-3xl sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-xl">{editing ? "Edit cohort" : "New cohort"}</DialogTitle>
            <DialogDescription>A purpose and a window of whole months are required; ages go in 5-year steps. Changing the criteria creates a new version.</DialogDescription>
          </DialogHeader>
          <div className="mt-2 space-y-4">
            <label className={label}>
              Name
              <input value={form.name} onChange={set("name")} className={cn(inputClass, "mt-1.5 h-11")} />
              {err("name")}
            </label>
            <label className={label}>
              Purpose
              <textarea value={form.purpose} onChange={set("purpose")} rows={2} placeholder="e.g. Review blood-sugar control of diabetic patients for the quarterly audit" className={cn(inputClass, "mt-1.5 py-3")} />
              {err("purpose")}
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className={label}>
                Visited from
                <input type="date" value={form.from} onChange={set("from")} className={cn(inputClass, "mt-1.5 h-11")} />
              </label>
              <label className={label}>
                to
                <input type="date" value={form.to} onChange={set("to")} className={cn(inputClass, "mt-1.5 h-11")} />
                {err("to")}
                {err("from")}
              </label>
            </div>
            <label className={label}>
              Diagnosed with (ICD-10 codes or prefixes)
              <input value={form.diagnoses} onChange={set("diagnoses")} placeholder="E11, I10" className={cn(inputClass, "mt-1.5 h-11 font-mono")} />
              {err("diagnosisPrefixes")}
            </label>
            <label className={label}>
              Prescribed (generic names)
              <input value={form.generics} onChange={set("generics")} placeholder="metformin, glimepiride" className={cn(inputClass, "mt-1.5 h-11")} />
              {err("drugGenerics")}
            </label>
            <div className="grid gap-4 sm:grid-cols-3">
              <label className={label}>
                Sex
                <select value={form.sex} onChange={set("sex")} className={cn(inputClass, "mt-1.5 h-11")}>
                  <option value="">Any</option>
                  <option value="female">Female</option>
                  <option value="male">Male</option>
                  <option value="other">Other</option>
                </select>
              </label>
              <label className={label}>
                Age from
                <input type="number" min={0} max={130} step={5} value={form.ageMin} onChange={set("ageMin")} className={cn(inputClass, "mt-1.5 h-11")} />
                {err("ageMin")}
              </label>
              <label className={label}>
                Age to
                <input type="number" min={0} max={130} value={form.ageMax} onChange={set("ageMax")} className={cn(inputClass, "mt-1.5 h-11")} />
                {err("ageMax")}
              </label>
            </div>
            <div className="flex justify-end">
              <button type="button" onClick={save} disabled={pending} className={buttonClass("primary", "md")}>
                {pending && <Loader2 className="h-4 w-4 animate-spin" />}
                {editing ? "Save" : "Create cohort"}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function CohortRunner({ id }: { id: string }) {
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<CohortRunResult | null>(null);
  async function run() {
    setPending(true);
    const response = await runCohortAction({ id });
    setPending(false);
    if (!response.ok) return toast.error(response.error);
    setResult(response.data);
  }
  return (
    <div className="space-y-6">
      <button type="button" onClick={run} disabled={pending} className={buttonClass("primary", "md")}>
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} Run now
      </button>
      {result && <CohortResults result={result} />}
    </div>
  );
}

export function ArchiveCohortButton({ id }: { id: string }) {
  return (
    <ConfirmAction
      action={archiveCohortAction}
      input={{ id }}
      variant="danger-outline"
      size="md"
      trigger={
        <>
          <Archive className="h-4 w-4" /> Archive
        </>
      }
      title="Archive this cohort?"
      description="It can no longer be run or exported. Its run history stays."
      confirmLabel="Archive"
      destructive
      successMessage="Cohort archived"
    />
  );
}
