"use client";

import { useState } from "react";
import { KeyRound, UserPlus } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ActionForm, SubmitButton } from "@/components/app/form";
import { OneTimeSecret } from "@/components/app/dialogs";
import { buttonClass } from "@/components/app/buttons";
import { createStaffAction, reissuePasswordAction } from "@/features/staff/staff.actions";
import { EMPTY_STAFF, StaffForm, type RoleOption } from "./StaffForm";

export function CreateStaffDialog({ roleOptions, clinicCode }: { roleOptions: RoleOption[]; clinicCode: string }) {
  const [open, setOpen] = useState(false);
  const [created, setCreated] = useState<{ email: string; oneTimePassword: string } | null>(null);

  function close() {
    // The secret stays on screen while the dialog animates out; it resets on next open.
    setOpen(false);
  }

  function reopen() {
    setCreated(null);
    setOpen(true);
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? reopen() : close())}>
      <DialogTrigger asChild>
        <button type="button" className={buttonClass("primary", "md")}>
          <UserPlus className="h-4 w-4" /> Add staff
        </button>
      </DialogTrigger>
      <DialogContent className="max-h-[92vh] overflow-y-auto rounded-3xl sm:max-w-2xl" data-accent="clinic">
        <DialogHeader>
          <DialogTitle className="text-xl">{created ? "Account created" : "Add a staff member"}</DialogTitle>
          <DialogDescription>
            {created
              ? `They sign in with clinic code "${clinicCode}", ${created.email} and this password.`
              : "Each account gets a generated one-time password, shown once."}
          </DialogDescription>
        </DialogHeader>
        {created ? (
          <OneTimeSecret
            secret={created.oneTimePassword}
            label="Their first password; they must change it when they sign in."
            onDone={close}
          />
        ) : (
          <StaffForm
            action={createStaffAction}
            values={EMPTY_STAFF}
            roleOptions={roleOptions}
            submitLabel="Create account"
            onSuccess={(data) => setCreated(data)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

export function ReissuePasswordDialog({ id, email }: { id: string; email: string }) {
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
        <button type="button" className={buttonClass("secondary", "md")}>
          <KeyRound className="h-4 w-4" /> Issue new password
        </button>
      </DialogTrigger>
      <DialogContent className="rounded-3xl sm:max-w-lg" data-accent="clinic">
        <DialogHeader>
          <DialogTitle>New password for {email}</DialogTitle>
          <DialogDescription>
            Their current password and every open session stop working immediately. This is recorded in the audit
            trail.
          </DialogDescription>
        </DialogHeader>
        {secret ? (
          <OneTimeSecret secret={secret} label="Hand it over in person or through a trusted channel." onDone={close} />
        ) : (
          <ActionForm action={reissuePasswordAction} onSuccess={(data) => setSecret(data.oneTimePassword)}>
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
