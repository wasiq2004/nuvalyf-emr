"use client";

import { toast } from "sonner";
import { X } from "lucide-react";
import { ActionForm, Field, SubmitButton, TextInput } from "@/components/app/form";
import { ActionButton } from "@/components/app/action-button";
import { addLeaveAction, removeLeaveAction } from "@/features/scheduling/booking.actions";

export function AddLeaveForm({ doctorId, today }: { doctorId: string; today: string }) {
  return (
    <ActionForm
      action={addLeaveAction}
      resetOnSuccess
      onSuccess={(data: { affected: number }) =>
        data.affected > 0
          ? toast.warning(`Leave added. ${data.affected} booked ${data.affected === 1 ? "appointment needs" : "appointments need"} moving.`)
          : toast.success("Leave added")
      }
    >
      <input type="hidden" name="doctorId" value={doctorId} />
      <div className="grid gap-4 sm:grid-cols-[11rem_1fr_auto] sm:items-end">
        <Field label="Day" name="date" required>
          <TextInput name="date" type="date" min={today} />
        </Field>
        <Field label="Reason" name="reason" required>
          <TextInput name="reason" placeholder="e.g. Conference, personal leave" />
        </Field>
        <SubmitButton variant="secondary">Add leave</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function RemoveLeaveButton({ id, date }: { id: string; date: string }) {
  return (
    <ActionButton action={removeLeaveAction} input={{ id }} variant="ghost" className="px-2" aria-label={`Remove leave on ${date}`} successMessage="Leave removed">
      <X className="h-4 w-4" />
    </ActionButton>
  );
}
