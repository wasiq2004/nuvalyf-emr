"use client";

import { Pencil, Plus } from "lucide-react";
import type { ActionResult } from "@/lib/action-result";
import { ActionForm, CheckboxCard, Field, SubmitButton, TextArea, TextInput } from "@/components/app/form";
import { FormDialog } from "@/components/app/dialogs";
import { createServiceAction, updateServiceAction } from "@/features/scheduling/scheduling.actions";

type ServiceValues = {
  id?: string;
  name: string;
  description: string;
  durationMinutes: number;
  price: string;
  isActive: boolean;
};

function ServiceFields({ values, currency }: { values: ServiceValues; currency: string }) {
  return (
    <>
      {values.id && <input type="hidden" name="id" value={values.id} />}
      <Field label="Name" name="name" required>
        <TextInput name="name" defaultValue={values.name} placeholder="General consultation" required />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Duration (minutes)" name="durationMinutes" required>
          <TextInput name="durationMinutes" type="number" min={5} max={480} step={5} defaultValue={values.durationMinutes} required />
        </Field>
        <Field label={`Price (${currency})`} name="price" required>
          <TextInput name="price" type="number" min={0} step="0.01" defaultValue={values.price} required />
        </Field>
      </div>
      <Field label="Description" name="description">
        <TextArea name="description" rows={2} defaultValue={values.description} />
      </Field>
      <CheckboxCard
        name="isActive"
        value="on"
        label="Bookable"
        description="Inactive services stay on past appointments but cannot be booked."
        defaultChecked={values.isActive}
      />
    </>
  );
}

function ServiceForm<R>({
  action,
  values,
  currency,
  submitLabel,
  onSuccess,
}: {
  action: (input: FormData) => Promise<ActionResult<R>>;
  values: ServiceValues;
  currency: string;
  submitLabel: string;
  onSuccess: () => void;
}) {
  return (
    <ActionForm action={action} successMessage="Service saved" onSuccess={onSuccess}>
      <ServiceFields values={values} currency={currency} />
      <SubmitButton className="w-full">{submitLabel}</SubmitButton>
    </ActionForm>
  );
}

export function CreateServiceDialog({ currency }: { currency: string }) {
  return (
    <FormDialog
      title="New service"
      description="Its duration decides how many calendar slots a booking takes."
      trigger={
        <>
          <Plus className="h-4 w-4" /> New service
        </>
      }
    >
      {(close) => (
        <ServiceForm
          action={createServiceAction}
          values={{ name: "", description: "", durationMinutes: 15, price: "0", isActive: true }}
          currency={currency}
          submitLabel="Create service"
          onSuccess={close}
        />
      )}
    </FormDialog>
  );
}

export function EditServiceDialog({ values, currency }: { values: ServiceValues; currency: string }) {
  return (
    <FormDialog
      title={`Edit ${values.name}`}
      variant="secondary"
      size="sm"
      trigger={
        <>
          <Pencil className="h-3.5 w-3.5" /> Edit
        </>
      }
    >
      {(close) => (
        <ServiceForm action={updateServiceAction} values={values} currency={currency} submitLabel="Save service" onSuccess={close} />
      )}
    </FormDialog>
  );
}
