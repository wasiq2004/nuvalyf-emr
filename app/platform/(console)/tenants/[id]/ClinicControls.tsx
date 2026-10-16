"use client";

import { useState } from "react";
import { LifeBuoy, PauseCircle, PlayCircle } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ActionForm, Field, SelectInput, SubmitButton, TextArea, TextInput } from "@/components/app/form";
import { ConfirmAction, FormDialog, OneTimeSecret } from "@/components/app/dialogs";
import { buttonClass } from "@/components/app/buttons";
import {
  rescueClinicAdminAction,
  setClinicPlanAction,
  setClinicStatusAction,
  updateClinicContactAction,
} from "@/features/platform/platform.actions";

export function ClinicPlanForm({
  clinicId,
  planId,
  plans,
}: {
  clinicId: string;
  planId: string | null;
  plans: { id: string; name: string }[];
}) {
  return (
    <ActionForm action={setClinicPlanAction} successMessage="Plan updated" className="space-y-4">
      <input type="hidden" name="clinicId" value={clinicId} />
      <Field label="Plan" name="planId" hint="Module changes apply on the clinic's next request.">
        <SelectInput
          name="planId"
          defaultValue={planId ?? ""}
          placeholder="No plan (all optional modules off)"
          options={plans.map((p) => ({ value: p.id, label: p.name }))}
        />
      </Field>
      <SubmitButton variant="secondary">Save plan</SubmitButton>
    </ActionForm>
  );
}

export function ClinicStatusControl({
  clinicId,
  clinicName,
  status,
}: {
  clinicId: string;
  clinicName: string;
  status: string;
}) {
  if (status === "suspended") {
    return (
      <ConfirmAction
        action={setClinicStatusAction}
        input={{ clinicId, status: "active" }}
        trigger={
          <>
            <PlayCircle className="h-4 w-4" /> Restore clinic
          </>
        }
        variant="primary"
        size="md"
        title={`Restore ${clinicName}?`}
        description="Staff can sign in again immediately."
        confirmLabel="Restore"
        successMessage="Clinic restored"
      />
    );
  }

  return (
    <FormDialog
      title={`Suspend ${clinicName}?`}
      description="Every staff session stops working on its next request. Their data is untouched and not visible to operators."
      variant="danger-outline"
      trigger={
        <>
          <PauseCircle className="h-4 w-4" /> Suspend clinic
        </>
      }
    >
      {(close) => (
        <ActionForm action={setClinicStatusAction} successMessage="Clinic suspended" onSuccess={close}>
          <input type="hidden" name="clinicId" value={clinicId} />
          <input type="hidden" name="status" value="suspended" />
          <Field label="Reason" name="reason" required hint="Recorded in the audit trail.">
            <TextArea name="reason" placeholder="e.g. Subscription unpaid since 1 October" required />
          </Field>
          <SubmitButton variant="danger" className="w-full" pendingLabel="Suspending...">
            Suspend clinic
          </SubmitButton>
        </ActionForm>
      )}
    </FormDialog>
  );
}

export function ClinicContactForm({
  clinicId,
  name,
  contactName,
  contactEmail,
  contactPhone,
}: {
  clinicId: string;
  name: string;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
}) {
  return (
    <ActionForm action={updateClinicContactAction} successMessage="Clinic details saved">
      <input type="hidden" name="clinicId" value={clinicId} />
      <Field label="Clinic name" name="name" required>
        <TextInput name="name" defaultValue={name} required />
      </Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Contact name" name="contactName">
          <TextInput name="contactName" defaultValue={contactName ?? ""} />
        </Field>
        <Field label="Contact email" name="contactEmail">
          <TextInput name="contactEmail" type="email" defaultValue={contactEmail ?? ""} />
        </Field>
        <Field label="Contact phone" name="contactPhone">
          <TextInput name="contactPhone" type="tel" defaultValue={contactPhone ?? ""} />
        </Field>
      </div>
      <SubmitButton variant="secondary">Save details</SubmitButton>
    </ActionForm>
  );
}

export function RescueAdminButton({
  clinicId,
  userId,
  email,
}: {
  clinicId: string;
  userId: string;
  email: string;
}) {
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
          <LifeBuoy className="h-4 w-4" /> Rescue
        </button>
      </DialogTrigger>
      <DialogContent className="rounded-3xl sm:max-w-lg" data-accent="platform">
        <DialogHeader>
          <DialogTitle>Rescue {email}</DialogTitle>
          <DialogDescription>
            Issues a new one-time password, re-activates the account and ends all of its sessions. This is audited in
            the console and in the clinic&apos;s own trail.
          </DialogDescription>
        </DialogHeader>
        {secret ? (
          <OneTimeSecret
            secret={secret}
            label="Give this to the administrator through a trusted channel."
            onDone={close}
          />
        ) : (
          <ActionForm action={rescueClinicAdminAction} refresh={false} onSuccess={(data) => setSecret(data.oneTimePassword)}>
            <input type="hidden" name="clinicId" value={clinicId} />
            <input type="hidden" name="userId" value={userId} />
            <SubmitButton className="w-full" pendingLabel="Issuing...">
              Issue new password
            </SubmitButton>
          </ActionForm>
        )}
      </DialogContent>
    </Dialog>
  );
}
