"use client";

import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { ActionForm, Field, SelectInput, SubmitButton, TextArea, TextInput, inputClass } from "@/components/app/form";
import { FormDialog } from "@/components/app/dialogs";
import { buttonClass } from "@/components/app/buttons";
import { enterLabParametersAction, enterLabResultAction } from "@/features/clinical/lab.actions";
import type { LabEntryField } from "@/features/clinical/lab.service";
import { LAB_FLAG_LABELS, numericFlag, parseLabNumber, textFlag, type LabFlag } from "@/features/clinical/lab-rules";
import { cn } from "@/lib/utils";

function liveFlag(field: LabEntryField, value: string): LabFlag | null {
  if (!value.trim()) return null;
  if (field.valueType === "text") return textFlag(value, field.normalText);
  const number = parseLabNumber(value);
  return number === null ? null : numericFlag(number, field.range);
}

/** Every parameter of the test on one form; the flag shows as each value is typed. */
export function ParameterResultDialog({ id, testName, patientName, fields }: { id: string; testName: string; patientName: string; fields: LabEntryField[] }) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState("");
  const [pending, setPending] = useState(false);
  const entered = fields.filter((f) => values[f.id]?.trim());
  const notNumbers = fields.filter((f) => f.valueType === "number" && values[f.id]?.trim() && parseLabNumber(values[f.id]) === null);

  return (
    <FormDialog size="sm" wide trigger="Enter result" title={testName} description={`${patientName}. Blank parameters are left off the report. Once saved, the result cannot be edited and goes straight to the ordering doctor.`}>
      {(close) => (
        <div className="space-y-4">
          <div className="grid grid-cols-[1fr_8rem_6rem] items-center gap-x-3 gap-y-2 sm:grid-cols-[1fr_9rem_5rem_7rem]">
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
          <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Notes
            <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional, e.g. sample haemolysed" className={cn(inputClass, "mt-1.5 h-10")} />
          </label>
          {notNumbers.length > 0 && <p className="text-sm text-red-600 dark:text-red-400">{notNumbers[0].name}: enter a number, without the unit.</p>}
          <div className="flex justify-end">
            <button
              type="button"
              disabled={pending || entered.length === 0 || notNumbers.length > 0}
              onClick={async () => {
                setPending(true);
                const result = await enterLabParametersAction({ id, notes, values: entered.map((f) => ({ parameterId: f.id, value: values[f.id] })) });
                setPending(false);
                if (!result.ok) return toast.error(result.fieldErrors ? Object.values(result.fieldErrors)[0] : result.error);
                toast.success("Result sent to the doctor");
                close();
                router.refresh();
              }}
              className={buttonClass("primary", "md")}
            >
              {pending && <Loader2 className="h-4 w-4 animate-spin" />}
              Save result
            </button>
          </div>
        </div>
      )}
    </FormDialog>
  );
}

export function EnterResultDialog({
  id,
  testName,
  patientName,
  unit,
  referenceRange,
}: {
  id: string;
  testName: string;
  patientName: string;
  unit: string | null;
  referenceRange: string | null;
}) {
  return (
    <FormDialog
      size="sm"
      trigger="Enter result"
      title={testName}
      description={`${patientName}. Once saved, the result cannot be edited and goes straight to the ordering doctor.`}
    >
      {(close) => (
        <ActionForm action={enterLabResultAction} successMessage="Result sent to the doctor" onSuccess={close}>
          <input type="hidden" name="id" value={id} />
          <Field
            label={unit ? `Result (${unit})` : "Result"}
            name="value"
            required
            hint={referenceRange ? `Reference range: ${referenceRange}` : undefined}
          >
            <TextArea name="value" rows={unit ? 1 : 4} className={unit ? "min-h-11" : undefined} autoFocus />
          </Field>
          <Field label="Interpretation" name="flag" required>
            <SelectInput
              name="flag"
              defaultValue="normal"
              options={[
                { value: "normal", label: "Within normal limits" },
                { value: "abnormal", label: "Abnormal" },
                { value: "critical", label: "Critical: tell the doctor now" },
              ]}
            />
          </Field>
          <Field label="Notes" name="notes">
            <TextInput name="notes" placeholder="Optional, e.g. sample haemolysed" />
          </Field>
          <div className="flex justify-end">
            <SubmitButton>Save result</SubmitButton>
          </div>
        </ActionForm>
      )}
    </FormDialog>
  );
}
