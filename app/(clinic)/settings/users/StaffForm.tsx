"use client";

import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import type { ActionResult } from "@/lib/action-result";
import { ActionForm, CheckboxCard, Field, SubmitButton, TextInput } from "@/components/app/form";

export type RoleOption = { key: string; name: string; description: string | null };

export type StaffValues = {
  id?: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  title: string;
  specialty: string;
  registrationNumber: string;
  registrationCouncil: string;
  roles: string[];
};

export const EMPTY_STAFF: StaffValues = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  title: "",
  specialty: "",
  registrationNumber: "",
  registrationCouncil: "",
  roles: [],
};

export function StaffForm<R>({
  action,
  values,
  roleOptions,
  submitLabel,
  successMessage,
  onSuccess,
}: {
  action: (input: FormData) => Promise<ActionResult<R>>;
  values: StaffValues;
  roleOptions: RoleOption[];
  submitLabel: string;
  successMessage?: string;
  onSuccess?: (data: R) => void;
}) {
  const [roles, setRoles] = useState<string[]>(values.roles);
  const isDoctor = roles.includes("doctor");

  return (
    <ActionForm action={action} successMessage={successMessage} onSuccess={onSuccess}>
      {values.id && <input type="hidden" name="id" value={values.id} />}
      <div className="grid gap-4 sm:grid-cols-[100px_1fr_1fr]">
        <Field label="Title" name="title">
          <TextInput name="title" defaultValue={values.title} placeholder="Dr." />
        </Field>
        <Field label="First name" name="firstName" required>
          <TextInput name="firstName" defaultValue={values.firstName} required />
        </Field>
        <Field label="Last name" name="lastName" required>
          <TextInput name="lastName" defaultValue={values.lastName} required />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Email (sign-in)" name="email" required>
          <TextInput name="email" type="email" defaultValue={values.email} required />
        </Field>
        <Field label="Phone" name="phone">
          <TextInput name="phone" type="tel" defaultValue={values.phone} />
        </Field>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Roles <span className="text-red-500">*</span>
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {roleOptions.map((role) => (
            <CheckboxCard
              key={role.key}
              name="roles[]"
              value={role.key}
              label={role.name}
              description={role.description ?? undefined}
              defaultChecked={values.roles.includes(role.key)}
              onCheckedChange={(checked) =>
                setRoles((current) => (checked ? [...current, role.key] : current.filter((r) => r !== role.key)))
              }
            />
          ))}
        </div>
      </div>

      {isDoctor && (
        <div className="space-y-4 rounded-2xl border border-(--accent-soft-border) bg-(--accent-soft)/40 p-4">
          <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Doctor details</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Specialty" name="specialty">
              <TextInput name="specialty" defaultValue={values.specialty} placeholder="General Physician" />
            </Field>
            <Field label="Medical registration number" name="registrationNumber">
              <TextInput name="registrationNumber" defaultValue={values.registrationNumber} />
            </Field>
          </div>
          <Field label="Registration council" name="registrationCouncil">
            <TextInput name="registrationCouncil" defaultValue={values.registrationCouncil} placeholder="e.g. Karnataka Medical Council" />
          </Field>
          {!values.registrationNumber && (
            <p className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-400">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" aria-hidden />
              A doctor cannot sign prescriptions until a registration number is on file.
            </p>
          )}
        </div>
      )}

      <SubmitButton className="w-full">{submitLabel}</SubmitButton>
    </ActionForm>
  );
}
