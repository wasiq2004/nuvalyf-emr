"use client";

import { HeartPulse, Phone } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ActionForm, Field, SelectInput, SubmitButton, TextArea, TextInput } from "@/components/app/form";
import { FormDialog } from "@/components/app/dialogs";
import { recordVitalsAction, saveNotesAction, saveTriageNotesAction, addAmendmentAction, savePrivateNoteAction } from "@/features/clinical/clinical.actions";
import { updatePatientContactAction } from "@/features/patients/patients.actions";
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

/** What the nurse writes for the doctor: never the doctor's own notes. */
export function TriageNotesForm({ encounterId, values }: { encounterId: string; values: { chiefComplaint: string; nursingNotes: string } }) {
  return (
    <ActionForm action={saveTriageNotesAction} successMessage="Triage notes saved">
      <input type="hidden" name="encounterId" value={encounterId} />
      <Field label="Chief complaint" name="chiefComplaint">
        <TextArea name="chiefComplaint" rows={2} defaultValue={values.chiefComplaint} placeholder="In the patient's words" className="min-h-16" />
      </Field>
      <Field label="Nursing notes" name="nursingNotes">
        <TextArea name="nursingNotes" rows={3} defaultValue={values.nursingNotes} placeholder="Anything the doctor should know before seeing the patient" />
      </Field>
      <div className="flex justify-end">
        <SubmitButton variant="secondary">Save triage notes</SubmitButton>
      </div>
    </ActionForm>
  );
}

export type ContactValues = { id: string; mobile: string; altPhone: string; email: string; addressLine: string; city: string };

export function PatientContactDialog({ values }: { values: ContactValues }) {
  return (
    <FormDialog
      variant="secondary"
      size="sm"
      trigger={
        <>
          <Phone className="h-4 w-4" /> Update contact
        </>
      }
      title="Contact details"
      description="Name, age and sex are changed at the front desk."
    >
      {(close) => (
        <ActionForm action={updatePatientContactAction} successMessage="Contact details saved" onSuccess={close}>
          <input type="hidden" name="id" value={values.id} />
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Mobile" name="mobile">
              <TextInput name="mobile" type="tel" defaultValue={values.mobile} />
            </Field>
            <Field label="Other phone" name="altPhone">
              <TextInput name="altPhone" type="tel" defaultValue={values.altPhone} />
            </Field>
          </div>
          <Field label="Email" name="email">
            <TextInput name="email" type="email" defaultValue={values.email} />
          </Field>
          <Field label="Address" name="addressLine">
            <TextInput name="addressLine" defaultValue={values.addressLine} />
          </Field>
          <Field label="City" name="city">
            <TextInput name="city" defaultValue={values.city} />
          </Field>
          <div className="flex justify-end">
            <SubmitButton>Save</SubmitButton>
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

export function LabOrderForm({
  encounterId,
  tests,
  frequent,
}: {
  encounterId: string;
  tests: { id: string; name: string; sampleType: string | null }[];
  frequent: { id: string; name: string }[];
}) {
  const router = useRouter();
  async function quickOrder(testId: string, name: string) {
    const result = await orderLabAction({ encounterId, testId });
    if (!result.ok) return toast.error(result.error);
    toast.success(`${name} ordered`);
    router.refresh();
  }
  return (
    <ActionForm action={orderLabAction} successMessage="Test ordered" resetOnSuccess>
      <input type="hidden" name="encounterId" value={encounterId} />
      {frequent.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-zinc-500">Frequently ordered</p>
          <div className="flex flex-wrap gap-2">
            {frequent.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => quickOrder(t.id, t.name)}
                className="rounded-xl border border-zinc-200 bg-white px-3 py-1.5 text-sm font-medium text-zinc-800 transition-colors hover:border-(--accent-soft-border) hover:bg-(--accent-soft) dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200"
              >
                {t.name}
              </button>
            ))}
          </div>
        </div>
      )}
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
