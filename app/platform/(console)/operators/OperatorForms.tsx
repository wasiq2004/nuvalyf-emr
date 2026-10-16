"use client";

import { useState } from "react";
import { KeyRound, Pencil, UserPlus } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ActionForm, Field, SelectInput, SubmitButton, TextInput } from "@/components/app/form";
import { FormDialog, OneTimeSecret } from "@/components/app/dialogs";
import { buttonClass } from "@/components/app/buttons";
import {
  createOperatorAction,
  resetOperatorPasswordAction,
  updateOperatorAction,
} from "@/features/platform/platform.actions";

const ROLE_OPTIONS = [
  { value: "operator", label: "Operator: onboard, plans, suspend" },
  { value: "platform_admin", label: "Platform Admin: everything, incl. operators and rescue" },
];

export function CreateOperatorDialog() {
  const [open, setOpen] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);

  function close() {
    // The secret stays on screen while the dialog animates out; it resets on next open.
    setOpen(false);
  }

  function reopen() {
    setSecret(null);
    setOpen(true);
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? reopen() : close())}>
      <DialogTrigger asChild>
        <button type="button" className={buttonClass("primary", "md")}>
          <UserPlus className="h-4 w-4" /> Add operator
        </button>
      </DialogTrigger>
      <DialogContent className="rounded-3xl sm:max-w-lg" data-accent="platform">
        <DialogHeader>
          <DialogTitle>{secret ? "Operator created" : "Add operator"}</DialogTitle>
          <DialogDescription>Operators sign in at /platform/login with their own one-hour sessions.</DialogDescription>
        </DialogHeader>
        {secret ? (
          <OneTimeSecret secret={secret} label="Their first password; they must change it at sign-in." onDone={close} />
        ) : (
          <ActionForm action={createOperatorAction} onSuccess={(data) => setSecret(data.oneTimePassword)}>
            <Field label="Name" name="name" required>
              <TextInput name="name" required />
            </Field>
            <Field label="Email" name="email" required>
              <TextInput name="email" type="email" required />
            </Field>
            <Field label="Role" name="role" required>
              <SelectInput name="role" defaultValue="operator" options={ROLE_OPTIONS} />
            </Field>
            <SubmitButton className="w-full">Create operator</SubmitButton>
          </ActionForm>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function EditOperatorDialog({
  id,
  name,
  role,
  status,
}: {
  id: string;
  name: string;
  role: string;
  status: string;
}) {
  return (
    <FormDialog
      title={`Edit ${name}`}
      description="Changing role or status ends their current sessions."
      variant="secondary"
      size="sm"
      trigger={
        <>
          <Pencil className="h-3.5 w-3.5" /> Edit
        </>
      }
    >
      {(close) => (
        <ActionForm action={updateOperatorAction} successMessage="Operator updated" onSuccess={close}>
          <input type="hidden" name="id" value={id} />
          <Field label="Role" name="role">
            <SelectInput name="role" defaultValue={role} options={ROLE_OPTIONS} />
          </Field>
          <Field label="Status" name="status">
            <SelectInput
              name="status"
              defaultValue={status}
              options={[
                { value: "active", label: "Active" },
                { value: "disabled", label: "Disabled" },
              ]}
            />
          </Field>
          <SubmitButton className="w-full">Save</SubmitButton>
        </ActionForm>
      )}
    </FormDialog>
  );
}

export function ResetOperatorPasswordDialog({ id, email }: { id: string; email: string }) {
  const [open, setOpen] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);

  function close() {
    // The secret stays on screen while the dialog animates out; it resets on next open.
    setOpen(false);
  }

  function reopen() {
    setSecret(null);
    setOpen(true);
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? reopen() : close())}>
      <DialogTrigger asChild>
        <button type="button" className={buttonClass("secondary", "sm")}>
          <KeyRound className="h-3.5 w-3.5" /> New password
        </button>
      </DialogTrigger>
      <DialogContent className="rounded-3xl sm:max-w-lg" data-accent="platform">
        <DialogHeader>
          <DialogTitle>New password for {email}</DialogTitle>
          <DialogDescription>Issues a one-time password and ends their current sessions. This is audited.</DialogDescription>
        </DialogHeader>
        {secret ? (
          <OneTimeSecret secret={secret} label="Share it through a trusted channel." onDone={close} />
        ) : (
          <ActionForm action={resetOperatorPasswordAction} refresh={false} onSuccess={(data) => setSecret(data.oneTimePassword)}>
            <input type="hidden" name="id" value={id} />
            <SubmitButton className="w-full" pendingLabel="Issuing...">
              Issue new password
            </SubmitButton>
          </ActionForm>
        )}
      </DialogContent>
    </Dialog>
  );
}
