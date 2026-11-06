"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Plus, X } from "lucide-react";
import { inputClass } from "@/components/app/form";
import { buttonClass } from "@/components/app/buttons";
import { saveLabResultAction } from "@/features/clinical/lab.actions";
import type { LabEntryField } from "@/features/clinical/lab.service";
import { CHOSEN_LAB_FLAGS, LAB_FLAG_LABELS, addedLineFlag, numericFlag, parseLabNumber, parseReference, textFlag, type ChosenLabFlag, type LabFlag } from "@/features/clinical/lab-rules";
import { cn } from "@/lib/utils";

function liveFlag(field: LabEntryField, value: string): LabFlag | null {
  if (!value.trim()) return null;
  if (field.valueType === "text") return textFlag(value, field.normalText);
  const number = parseLabNumber(value);
  return number === null ? null : numericFlag(number, field.range);
}

type AddedRow = { key: number; name: string; value: string; unit: string; reference: string; flag: ChosenLabFlag };

const FLAG_OPTION: Record<ChosenLabFlag, string> = { normal: "Normal", low: "Low", high: "High", abnormal: "Abnormal", critical: "Critical" };

/** What the select shows: the computed flag wins when the value is outside the typed range. */
function shownFlag(row: AddedRow): ChosenLabFlag {
  const flag = addedLineFlag(row.value, row.reference, row.flag);
  return (CHOSEN_LAB_FLAGS as readonly string[]).includes(flag) ? (flag as ChosenLabFlag) : row.flag;
}

export function ResultEntryForm({
  id,
  testName,
  fields,
  unit,
  referenceRange,
  documentCount,
}: {
  id: string;
  testName: string;
  fields: LabEntryField[];
  unit: string | null;
  referenceRange: string | null;
  documentCount: number;
}) {
  const router = useRouter();
  const nextKey = useRef(1);
  const [values, setValues] = useState<Record<string, string>>({});
  // A test with no parameter list starts with one row for the test itself.
  const [added, setAdded] = useState<AddedRow[]>(fields.length ? [] : [{ key: 0, name: testName, value: "", unit: unit ?? "", reference: referenceRange ?? "", flag: "normal" }]);
  const [notes, setNotes] = useState("");
  const [documentFlag, setDocumentFlag] = useState("");
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);

  const entered = fields.filter((f) => values[f.id]?.trim());
  const filled = added.filter((r) => r.value.trim());
  const typing = entered.length > 0 || filled.length > 0 || notes.trim() !== "";
  const notNumbers = fields.filter((f) => f.valueType === "number" && values[f.id]?.trim() && parseLabNumber(values[f.id]) === null);
  const unnamed = filled.find((r) => !r.name.trim());
  const empty = added.find((r) => r.name.trim() && !r.value.trim() && added.length > 1);
  const documentOnly = entered.length === 0 && filled.length === 0 && documentCount > 0;
  const problem = notNumbers.length ? `${notNumbers[0].name}: enter a number, without the unit. To report something else, add it as a new parameter.` : unnamed ? "Give each added parameter a name." : empty ? `${empty.name}: enter a result, or remove the row.` : null;
  const canSave = !pending && !problem && (documentOnly ? documentFlag !== "" : entered.length + filled.length > 0);
  const unchecked = fields.filter((f) => f.valueType === "number" && !f.range);

  // Closing the tab should not lose a half-entered panel of results.
  useEffect(() => {
    if (!typing || saved) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [typing, saved]);

  const change = (key: number, patch: Partial<AddedRow>) => setAdded((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  async function save() {
    setPending(true);
    const result = await saveLabResultAction({
      id,
      notes,
      values: entered.map((f) => ({ parameterId: f.id, value: values[f.id] })),
      added: filled.map((r) => ({ name: r.name, value: r.value, unit: r.unit, reference: r.reference, flag: shownFlag(r) })),
      documentFlag: documentOnly ? documentFlag : undefined,
    });
    setPending(false);
    if (!result.ok) {
      toast.error(result.fieldErrors ? Object.values(result.fieldErrors)[0] : result.error);
      return;
    }
    setSaved(true);
    toast.success("Result sent to the doctor");
    router.refresh();
  }

  return (
    <div className="space-y-5">
      {unchecked.length > 0 && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
          {unchecked.length === 1 ? `${unchecked[0].name} has` : `${unchecked.length} parameters have`} no reference range for this patient, so nothing will be flagged automatically. This usually means the patient&apos;s age or sex is not recorded. Tell the doctor about any concerning value.
        </p>
      )}
      {fields.length > 0 && (
        <div className="grid grid-cols-[1fr_7rem_5rem] items-center gap-x-3 gap-y-2 sm:grid-cols-[1fr_10rem_6rem_7rem]">
          {fields.map((field, index) => {
            const flag = liveFlag(field, values[field.id] ?? "");
            const off = flag && flag !== "normal";
            return (
              <Fragment key={field.id}>
                {field.section && field.section !== fields[index - 1]?.section && <p className="col-span-full pt-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">{field.section}</p>}
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-zinc-800 dark:text-zinc-200">{field.name}</span>
                  {field.reference && <span className="block text-xs text-zinc-500">{field.reference}</span>}
                </span>
                <input
                  aria-label={`${field.name} result`}
                  value={values[field.id] ?? ""}
                  onChange={(e) => setValues((prev) => ({ ...prev, [field.id]: e.target.value }))}
                  inputMode={field.valueType === "number" ? "decimal" : undefined}
                  className={cn(inputClass, "h-9", off && "border-amber-400")}
                />
                <span className="hidden text-xs text-zinc-500 sm:block">{field.unit}</span>
                <span className={cn("text-xs font-semibold", off ? "text-amber-700 dark:text-amber-400" : "text-zinc-400")}>{flag ? LAB_FLAG_LABELS[flag] : ""}</span>
              </Fragment>
            );
          })}
        </div>
      )}

      {added.length > 0 && (
        <div className="space-y-3">
          {fields.length > 0 && <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Additional</p>}
          {added.map((row) => (
            <div key={row.key} className="grid gap-2 rounded-xl border border-zinc-200 p-3 sm:grid-cols-[1.4fr_1.2fr_0.7fr_0.9fr_7rem_auto] sm:border-0 sm:p-0 dark:border-zinc-800">
              <input aria-label="Parameter name" placeholder="Parameter" maxLength={120} value={row.name} onChange={(e) => change(row.key, { name: e.target.value })} className={cn(inputClass, "h-9")} />
              <input aria-label={`${row.name || "New parameter"} result`} placeholder="Result" maxLength={500} value={row.value} onChange={(e) => change(row.key, { value: e.target.value })} className={cn(inputClass, "h-9")} />
              <input aria-label="Unit" placeholder="Unit" maxLength={40} value={row.unit} onChange={(e) => change(row.key, { unit: e.target.value })} className={cn(inputClass, "h-9")} />
              <input
                aria-label="Reference range"
                placeholder="e.g. 10 - 20"
                title={row.reference && !parseReference(row.reference) ? "This will print as typed. It can't be checked automatically, so choose the flag yourself." : undefined}
                maxLength={80}
                value={row.reference}
                onChange={(e) => change(row.key, { reference: e.target.value })}
                className={cn(inputClass, "h-9")}
              />
              <select aria-label="Flag" value={shownFlag(row)} onChange={(e) => change(row.key, { flag: e.target.value as ChosenLabFlag })} className={cn(inputClass, "h-9")}>
                {CHOSEN_LAB_FLAGS.map((flag) => (
                  <option key={flag} value={flag}>
                    {FLAG_OPTION[flag]}
                  </option>
                ))}
              </select>
              <button type="button" aria-label={`Remove ${row.name || "this parameter"}`} onClick={() => setAdded((rows) => rows.filter((r) => r.key !== row.key))} className={buttonClass("ghost", "sm")}>
                <X className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      <button type="button" onClick={() => setAdded((rows) => [...rows, { key: nextKey.current++, name: "", value: "", unit: "", reference: "", flag: "normal" }])} className={buttonClass("secondary", "sm")}>
        <Plus className="h-4 w-4" /> Add parameter
      </button>

      <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
        Notes
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} rows={2} placeholder="Optional, e.g. sample haemolysed" className={cn(inputClass, "mt-1.5 h-auto py-2")} />
      </label>

      {documentOnly && (
        <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Interpretation of the attached report
          <select value={documentFlag} onChange={(e) => setDocumentFlag(e.target.value)} className={cn(inputClass, "mt-1.5 h-10")}>
            <option value="">Choose</option>
            <option value="normal">Within normal limits</option>
            <option value="abnormal">Abnormal</option>
            <option value="critical">Critical: tell the doctor now</option>
          </select>
        </label>
      )}

      {problem && <p className="text-sm text-red-600 dark:text-red-400">{problem}</p>}
      <div className="flex justify-end">
        <button type="button" disabled={!canSave} onClick={save} className={buttonClass("primary", "md")}>
          {pending && <Loader2 className="h-4 w-4 animate-spin" />}
          Save result
        </button>
      </div>
    </div>
  );
}
