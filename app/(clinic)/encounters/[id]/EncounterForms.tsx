"use client";

import { HeartPulse } from "lucide-react";
import { toast } from "sonner";
import { ActionForm, Field, SelectInput, SubmitButton, TextArea, TextInput } from "@/components/app/form";
import { FormDialog } from "@/components/app/dialogs";
import { recordVitalsAction, saveNotesAction, addAmendmentAction, savePrivateNoteAction } from "@/features/clinical/clinical.actions";
import { orderLabAction } from "@/features/clinical/lab.actions";
import { FLAG_LABELS, VITAL_FIELDS, VITAL_LABELS, type VitalFlag, type VitalKey } from "@/features/clinical/vital-rules";

export function VitalsDialog({ encounterId, primary = false }: { encounterId: string; primary?: boolean }) {
  return (
    <FormDialog
      variant={primary ? "primary" : "secondary"}
      size="sm"
      wide
      trigger={
        <>
          <HeartPulse className="h-4 w-4" /> Record vitals
        </>
      }
      title="Record vitals"
      description="Fill in what you measured. Readings are checked against the clinic's ranges for the patient's age."
    >
      {(close) => (
        <ActionForm
          action={recordVitalsAction}
          onSuccess={(data: { flags: Partial<Record<VitalKey, VitalFlag>> }) => {
            const flagged = Object.entries(data.flags) as [VitalKey, VitalFlag][];
            if (flagged.length === 0) toast.success("Vitals recorded");
            else toast.warning(`Vitals recorded. Flagged: ${flagged.map(([k, f]) => `${VITAL_LABELS[k]} ${FLAG_LABELS[f].toLowerCase()}`).join(", ")}`);
            close();
          }}
        >
          <input type="hidden" name="encounterId" value={encounterId} />
          <div className="grid gap-4 sm:grid-cols-4">
            {VITAL_FIELDS.map((f) => (
              <Field key={f.key} label={`${f.label} (${f.unit})`} name={f.key}>
                <TextInput name={f.key} inputMode="decimal" type="number" step={f.step} min={f.min} max={f.max} />
              </Field>
            ))}
          </div>
          <Field label="Notes" name="notes">
            <TextInput name="notes" placeholder="e.g. Measured after rest, left arm" />
          </Field>
          <div className="flex justify-end">
            <SubmitButton>Save vitals</SubmitButton>
          </div>
        </ActionForm>
      )}
    </FormDialog>
  );
}

export type NotesValues = {
  chiefComplaint: string;
  history: string;
  examination: string;
  plan: string;
  followUp: string;
};

export function NotesForm({ encounterId, values }: { encounterId: string; values: NotesValues }) {
  return (
    <ActionForm action={saveNotesAction} successMessage="Notes saved">
      <input type="hidden" name="encounterId" value={encounterId} />
      <Field label="Chief complaint" name="chiefComplaint">
        <TextArea name="chiefComplaint" rows={2} defaultValue={values.chiefComplaint} placeholder="In the patient's words" className="min-h-16" />
      </Field>
      <div className="grid gap-5 lg:grid-cols-2">
        <Field label="History" name="history">
          <TextArea name="history" rows={5} defaultValue={values.history} />
        </Field>
        <Field label="Examination" name="examination">
          <TextArea name="examination" rows={5} defaultValue={values.examination} />
        </Field>
      </div>
      <Field label="Plan and advice" name="plan" hint="Printed on the prescription as advice.">
        <TextArea name="plan" rows={3} defaultValue={values.plan} />
      </Field>
      <Field label="Follow-up" name="followUp">
        <TextInput name="followUp" defaultValue={values.followUp} placeholder="e.g. Review in 5 days, or earlier if fever persists" />
      </Field>
      <div className="flex justify-end">
        <SubmitButton variant="secondary">Save notes</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function AmendmentForm({ encounterId }: { encounterId: string }) {
  return (
    <ActionForm action={addAmendmentAction} successMessage="Amendment added" resetOnSuccess>
      <input type="hidden" name="encounterId" value={encounterId} />
      <Field label="Add an amendment" name="text" hint="The original record stays as signed; amendments are added below it with your name and the time.">
        <TextArea name="text" rows={3} />
      </Field>
      <div className="flex justify-end">
        <SubmitButton variant="secondary">Add amendment</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function PrivateNoteForm({ encounterId, text }: { encounterId: string; text: string }) {
  return (
    <ActionForm action={savePrivateNoteAction} successMessage="Private note saved">
      <input type="hidden" name="encounterId" value={encounterId} />
      <Field label="Only you can see this" name="text" hint="Not part of the clinical record and never printed. Clear it to delete.">
        <TextArea name="text" rows={4} defaultValue={text} />
      </Field>
      <div className="flex justify-end">
        <SubmitButton variant="secondary" size="sm">
          Save private note
        </SubmitButton>
      </div>
    </ActionForm>
  );
}

export function LabOrderForm({ encounterId, tests }: { encounterId: string; tests: { id: string; name: string; sampleType: string | null }[] }) {
  return (
    <ActionForm action={orderLabAction} successMessage="Test ordered" resetOnSuccess>
      <input type="hidden" name="encounterId" value={encounterId} />
      <div className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <Field label="Test" name="testId" required>
          <SelectInput
            name="testId"
            placeholder="Choose a test"
            options={tests.map((t) => ({ value: t.id, label: t.sampleType ? `${t.name} · ${t.sampleType}` : t.name }))}
          />
        </Field>
        <Field label="Note for the lab" name="notes">
          <TextInput name="notes" placeholder="Optional" />
        </Field>
        <SubmitButton variant="secondary">Order</SubmitButton>
      </div>
    </ActionForm>
  );
}
