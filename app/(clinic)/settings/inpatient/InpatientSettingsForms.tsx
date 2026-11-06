"use client";

import { useState } from "react";
import { Pencil, Plus } from "lucide-react";
import { ActionForm, CheckboxCard, Field, SelectInput, SubmitButton, TextArea, TextInput } from "@/components/app/form";
import { FormDialog } from "@/components/app/dialogs";
import { saveBedAction, saveBedCategoryAction, saveInpatientSettingsAction } from "@/features/inpatient/inpatient.actions";
import type { BillingMode } from "@/features/inpatient/bed-billing-rules";
import type { SectionChoice } from "@/features/inpatient/summary-rules";

export function InpatientSettingsForm({
  billingMode,
  minimumHours,
  enabled,
  custom,
  standard,
}: {
  billingMode: BillingMode;
  minimumHours: number;
  enabled: string[];
  custom: string[];
  standard: SectionChoice[];
}) {
  const [hourly, setHourly] = useState(billingMode === "hourly");
  return (
    <ActionForm action={saveInpatientSettingsAction} successMessage="Inpatient settings saved" className="space-y-6">
      <input type="hidden" name="billingMode" value={hourly ? "hourly" : "block"} />
      <CheckboxCard
        name="hourlyBilling"
        value="on"
        label="Charge beds by the hour"
        description={
          hourly
            ? "On: exact hours at the daily rate / 24. A 30-hour stay is charged 30 hours."
            : "Off: whole 24-hour blocks, rounded up. A 26-hour stay is charged 48 hours."
        }
        defaultChecked={hourly}
        onCheckedChange={setHourly}
      />
      <Field label="Minimum hours charged" name="minimumHours" required hint="A shorter stay is charged this much. Applies to patients admitted after you save.">
        <TextInput name="minimumHours" type="number" min={0} max={240} defaultValue={minimumHours} className="max-w-40" />
      </Field>

      <div>
        <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Discharge summary sections</p>
        <p className="mb-3 text-xs text-zinc-500">Filled from the record where it can be. The doctor reviews every section before signing.</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {standard.map((s) => (
            <CheckboxCard key={s.key} name="sections[]" value={s.key} label={s.title} defaultChecked={enabled.includes(s.key)} />
          ))}
        </div>
      </div>
      <Field label="Your own sections" name="customSections" hint="One heading per line. They start empty for the doctor to fill in.">
        <TextArea name="customSections" rows={3} defaultValue={custom.join("\n")} placeholder={"e.g. Diet advice\nWound care"} />
      </Field>
      <div className="flex justify-end">
        <SubmitButton>Save</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function CategoryDialog({ values }: { values?: { id: string; name: string; dailyRate: string } }) {
  return (
    <FormDialog
      variant={values ? "ghost" : "primary"}
      size="sm"
      trigger={
        values ? (
          <Pencil className="h-4 w-4" aria-label={`Edit ${values.name}`} />
        ) : (
          <>
            <Plus className="h-4 w-4" /> Add category
          </>
        )
      }
      title={values ? `Edit ${values.name}` : "Add a bed category"}
    >
      {(close) => (
        <ActionForm action={saveBedCategoryAction} successMessage="Category saved" onSuccess={close}>
          <input type="hidden" name="id" value={values?.id ?? ""} />
          <Field label="Name" name="name" required>
            <TextInput name="name" defaultValue={values?.name} placeholder="e.g. Private room" />
          </Field>
          <Field label="Price per day (₹)" name="dailyRate" required>
            <TextInput name="dailyRate" inputMode="decimal" defaultValue={values?.dailyRate} />
          </Field>
          <div className="flex justify-end">
            <SubmitButton>Save category</SubmitButton>
          </div>
        </ActionForm>
      )}
    </FormDialog>
  );
}

export function BedDialog({ categories, values }: { categories: { value: string; label: string }[]; values?: { id: string; categoryId: string; ward: string; code: string } }) {
  return (
    <FormDialog
      variant={values ? "ghost" : "primary"}
      size="sm"
      trigger={
        values ? (
          <Pencil className="h-4 w-4" aria-label={`Edit bed ${values.code}`} />
        ) : (
          <>
            <Plus className="h-4 w-4" /> Add bed
          </>
        )
      }
      title={values ? `Edit bed ${values.code}` : "Add a bed"}
    >
      {(close) => (
        <ActionForm action={saveBedAction} successMessage="Bed saved" onSuccess={close}>
          <input type="hidden" name="id" value={values?.id ?? ""} />
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Bed number" name="code" required>
              <TextInput name="code" defaultValue={values?.code} placeholder="e.g. A-12" />
            </Field>
            <Field label="Ward" name="ward">
              <TextInput name="ward" defaultValue={values?.ward} placeholder="e.g. Ward A" />
            </Field>
          </div>
          <Field label="Category" name="categoryId" required>
            <SelectInput name="categoryId" defaultValue={values?.categoryId} placeholder="Choose a category" options={categories} />
          </Field>
          <div className="flex justify-end">
            <SubmitButton>Save bed</SubmitButton>
          </div>
        </ActionForm>
      )}
    </FormDialog>
  );
}
