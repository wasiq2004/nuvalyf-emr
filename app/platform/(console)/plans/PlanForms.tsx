"use client";

import { Pencil, Plus } from "lucide-react";
import { ActionForm, CheckboxCard, Field, SubmitButton, TextArea, TextInput } from "@/components/app/form";
import { FormDialog } from "@/components/app/dialogs";
import { createPlanAction, updatePlanAction } from "@/features/platform/platform.actions";

type ModuleOption = { key: string; name: string; description: string; requires: string[] };

type PlanValues = {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  modules: string[];
};

function ModuleCheckboxes({ modules, selected }: { modules: ModuleOption[]; selected: string[] }) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Modules</p>
      <p className="text-xs text-zinc-500">Core features (patients, appointments, queue, consultations, billing, audit) are always included.</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {modules.map((m) => (
          <CheckboxCard
            key={m.key}
            name="modules[]"
            value={m.key}
            label={m.name}
            description={m.requires.length > 0 ? `${m.description}. Requires ${m.requires.join(", ")}.` : m.description}
            defaultChecked={selected.includes(m.key)}
          />
        ))}
      </div>
    </div>
  );
}

export function CreatePlanDialog({ modules }: { modules: ModuleOption[] }) {
  return (
    <FormDialog
      title="New plan"
      description="Plans decide which optional modules a clinic can use."
      wide
      trigger={
        <>
          <Plus className="h-4 w-4" /> New plan
        </>
      }
    >
      {(close) => (
        <ActionForm action={createPlanAction} successMessage="Plan created" onSuccess={close}>
          <Field label="Name" name="name" required>
            <TextInput name="name" placeholder="Standard" required />
          </Field>
          <Field label="Description" name="description">
            <TextArea name="description" rows={2} />
          </Field>
          <ModuleCheckboxes modules={modules} selected={[]} />
          <SubmitButton className="w-full">Create plan</SubmitButton>
        </ActionForm>
      )}
    </FormDialog>
  );
}

export function EditPlanDialog({ plan, modules }: { plan: PlanValues; modules: ModuleOption[] }) {
  return (
    <FormDialog
      title={`Edit ${plan.name}`}
      description="Changes apply to every clinic on this plan on their next request."
      wide
      variant="secondary"
      size="sm"
      trigger={
        <>
          <Pencil className="h-3.5 w-3.5" /> Edit
        </>
      }
    >
      {(close) => (
        <ActionForm action={updatePlanAction} successMessage="Plan updated" onSuccess={close}>
          <input type="hidden" name="id" value={plan.id} />
          <Field label="Name" name="name" required>
            <TextInput name="name" defaultValue={plan.name} required />
          </Field>
          <Field label="Description" name="description">
            <TextArea name="description" rows={2} defaultValue={plan.description ?? ""} />
          </Field>
          <ModuleCheckboxes modules={modules} selected={plan.modules} />
          <CheckboxCard
            name="isActive"
            value="on"
            label="Available for new assignments"
            description="Retired plans stay on clinics that already have them."
            defaultChecked={plan.isActive}
          />
          <SubmitButton className="w-full">Save plan</SubmitButton>
        </ActionForm>
      )}
    </FormDialog>
  );
}
