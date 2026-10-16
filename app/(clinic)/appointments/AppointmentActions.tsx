"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Ban, LogIn, UserX } from "lucide-react";
import { ActionForm, Field, SubmitButton, TextInput } from "@/components/app/form";
import { ConfirmAction, FormDialog } from "@/components/app/dialogs";
import { buttonClass } from "@/components/app/buttons";
import { cancelAppointmentAction, markNoShowAction } from "@/features/scheduling/booking.actions";
import { checkInAction } from "@/features/queue/queue.actions";
import { RescheduleDialog } from "./RescheduleDialog";

export function AppointmentRowActions({
  id,
  patientName,
  canCheckIn,
  canManage,
  started,
  reschedule,
}: {
  id: string;
  patientName: string;
  canCheckIn: boolean;
  canManage: boolean;
  started: boolean;
  /** Present when the appointment can be moved (booked, with a service). */
  reschedule?: { doctorId: string; serviceId: string; date: string };
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [, startTransition] = useTransition();

  async function checkIn() {
    setPending(true);
    const result = await checkInAction({ appointmentId: id });
    setPending(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(`${patientName} checked in: wait clock started`);
    startTransition(() => router.refresh());
  }

  return (
    <div className="flex justify-end gap-2">
      {canCheckIn && (
        <button type="button" onClick={checkIn} disabled={pending} className={buttonClass("primary", "sm")}>
          <LogIn className="h-3.5 w-3.5" /> {pending ? "Checking in..." : "Check in"}
        </button>
      )}
      {canManage && started && (
        <ConfirmAction
          action={markNoShowAction}
          input={{ id }}
          trigger={<UserX className="h-3.5 w-3.5" />}
          title={`Mark ${patientName} as a no-show?`}
          description="Frees nothing: the slot has already passed. Recorded on the patient's history."
          confirmLabel="Mark no-show"
          successMessage="Marked as no-show"
        />
      )}
      {canManage && reschedule && <RescheduleDialog id={id} patientName={patientName} {...reschedule} />}
      {canManage && (
        <FormDialog title={`Cancel ${patientName}'s appointment?`} variant="ghost" size="sm" trigger={<Ban className="h-3.5 w-3.5 text-red-500" />}>
          {(close) => (
            <ActionForm action={cancelAppointmentAction} successMessage="Appointment cancelled" onSuccess={close}>
              <input type="hidden" name="id" value={id} />
              <Field label="Reason" name="reason" required>
                <TextInput name="reason" placeholder="e.g. Patient called to cancel" required />
              </Field>
              <SubmitButton variant="danger" className="w-full">
                Cancel appointment
              </SubmitButton>
            </ActionForm>
          )}
        </FormDialog>
      )}
    </div>
  );
}
