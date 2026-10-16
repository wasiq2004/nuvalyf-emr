"use client";

import { Plus } from "lucide-react";
import { ActionForm, Field, SelectInput, SubmitButton, TextArea, TextInput } from "@/components/app/form";
import { FormDialog, ConfirmAction } from "@/components/app/dialogs";
import { addAllergyAction, correctAllergyAction, noKnownAllergiesAction } from "@/features/clinical/clinical.actions";

const SEVERITY_OPTIONS = [
  { value: "mild", label: "Mild" },
  { value: "moderate", label: "Moderate" },
  { value: "severe", label: "Severe (anaphylaxis, etc.)" },
];

const STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "resolved", label: "Resolved (no longer allergic)" },
  { value: "entered_in_error", label: "Entered in error" },
];

export function AddAllergyDialog({ patientId, classes }: { patientId: string; classes: { id: string; name: string }[] }) {
  return (
    <FormDialog
      variant="secondary"
      size="sm"
      trigger={
        <>
          <Plus className="h-4 w-4" /> Add allergy
        </>
      }
      title="Record an allergy"
      description="Allergies are never deleted. A wrong entry is corrected later with a reason."
    >
      {(close) => (
        <ActionForm action={addAllergyAction} successMessage="Allergy recorded" onSuccess={close}>
          <input type="hidden" name="patientId" value={patientId} />
          <Field label="Substance" name="substance" required hint="The medicine, food or other trigger, e.g. Penicillin, Peanuts.">
            <TextInput name="substance" autoFocus />
          </Field>
          <Field label="Medicine class" name="allergyClassId" hint="Links the allergy to every medicine in the class for prescribing checks.">
            <SelectInput name="allergyClassId" placeholder="Not a medicine class" options={classes.map((c) => ({ value: c.id, label: c.name }))} />
          </Field>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Severity" name="severity" required>
              <SelectInput name="severity" defaultValue="moderate" options={SEVERITY_OPTIONS} />
            </Field>
            <Field label="Reaction" name="reaction">
              <TextInput name="reaction" placeholder="e.g. Rash, swelling" />
            </Field>
          </div>
          <div className="flex justify-end">
            <SubmitButton>Record allergy</SubmitButton>
          </div>
        </ActionForm>
      )}
    </FormDialog>
  );
}

export function CorrectAllergyDialog({
  allergy,
}: {
  allergy: { id: string; substance: string; severity: string; status: string; reaction: string | null };
}) {
  return (
    <FormDialog variant="ghost" size="sm" trigger="Correct" title={`Correct: ${allergy.substance}`} description="The previous version and your reason are kept.">
      {(close) => (
        <ActionForm action={correctAllergyAction} successMessage="Allergy corrected" onSuccess={close}>
          <input type="hidden" name="id" value={allergy.id} />
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Status" name="status" required>
              <SelectInput name="status" defaultValue={allergy.status} options={STATUS_OPTIONS} />
            </Field>
            <Field label="Severity" name="severity" required>
              <SelectInput name="severity" defaultValue={allergy.severity} options={SEVERITY_OPTIONS} />
            </Field>
          </div>
          <Field label="Reaction" name="reaction">
            <TextInput name="reaction" defaultValue={allergy.reaction ?? ""} />
          </Field>
          <Field label="Reason for the correction" name="reason" required>
            <TextArea name="reason" rows={3} placeholder="e.g. Patient clarified it was nausea, not an allergy" />
          </Field>
          <div className="flex justify-end">
            <SubmitButton>Save correction</SubmitButton>
          </div>
        </ActionForm>
      )}
    </FormDialog>
  );
}

export function NoKnownAllergiesButton({ patientId }: { patientId: string }) {
  return (
    <ConfirmAction
      action={noKnownAllergiesAction}
      input={{ patientId }}
      trigger="No known allergies"
      title="Record “no known allergies”?"
      description="Confirm you asked the patient (or their companion) and they know of no allergies."
      confirmLabel="Record"
      successMessage="Recorded: no known allergies"
    />
  );
}
