"use client";

import { Check, PenLine, Trash2, X } from "lucide-react";
import { ActionButton } from "@/components/app/action-button";
import { ConfirmAction } from "@/components/app/dialogs";
import {
  finalizeEncounterAction,
  handOverAction,
  removeDiagnosisAction,
  removePrescriptionItemAction,
  takeOverEncounterAction,
} from "@/features/clinical/clinical.actions";
import { cancelLabOrderAction } from "@/features/clinical/lab.actions";

export function HandOverButton({ encounterId }: { encounterId: string }) {
  return (
    <ConfirmAction
      action={handOverAction}
      input={{ encounterId }}
      variant="primary"
      size="md"
      trigger={
        <>
          <Check className="h-4 w-4" /> Ready for doctor
        </>
      }
      title="Hand over to the doctor?"
      description="The patient moves to READY in the doctor's queue. You can still add vitals until the doctor signs."
      confirmLabel="Hand over"
      successMessage="Patient is ready for the doctor"
    />
  );
}

export function FinalizeButton({
  encounterId,
  medicines,
  diagnoses,
  blocked,
}: {
  encounterId: string;
  medicines: number;
  diagnoses: number;
  blocked: boolean;
}) {
  if (blocked) {
    return (
      <span className="inline-flex cursor-not-allowed items-center gap-2 rounded-xl border border-zinc-200 px-4 py-2.5 text-sm font-semibold text-zinc-400 dark:border-zinc-800" title="Your registration number is needed to sign">
        <PenLine className="h-4 w-4" /> Sign &amp; finalise
      </span>
    );
  }
  return (
    <ConfirmAction
      action={finalizeEncounterAction}
      input={{ encounterId }}
      variant="primary"
      size="md"
      trigger={
        <>
          <PenLine className="h-4 w-4" /> Sign &amp; finalise
        </>
      }
      title="Sign and finalise this consultation?"
      description={
        <div className="space-y-2">
          <p>
            {diagnoses === 0 ? "No diagnosis is recorded. " : ""}
            {medicines > 0 ? `The prescription (${medicines} ${medicines === 1 ? "medicine" : "medicines"}) will be signed in your name.` : "There is no prescription."}
          </p>
          <p className="font-medium text-zinc-800 dark:text-zinc-200">After signing, nothing in this consultation can be changed. Corrections are added as amendments.</p>
        </div>
      }
      confirmLabel="Sign & finalise"
      successMessage="Consultation signed"
    />
  );
}

export function RemoveDiagnosisButton({ id, code }: { id: string; code: string }) {
  return (
    <ActionButton action={removeDiagnosisAction} input={{ id }} variant="ghost" className="px-2" aria-label={`Remove ${code}`}>
      <X className="h-4 w-4" />
    </ActionButton>
  );
}

export function RemoveItemButton({ id, name }: { id: string; name: string }) {
  return (
    <ActionButton action={removePrescriptionItemAction} input={{ id }} variant="ghost" className="px-2" aria-label={`Remove ${name}`}>
      <Trash2 className="h-4 w-4" />
    </ActionButton>
  );
}

export function CancelLabButton({ id, name }: { id: string; name: string }) {
  return (
    <ConfirmAction
      action={cancelLabOrderAction}
      input={{ id }}
      variant="ghost"
      trigger="Cancel"
      title={`Cancel ${name}?`}
      description="The lab will no longer see it in their worklist."
      confirmLabel="Cancel test"
      destructive
      successMessage="Test cancelled"
    />
  );
}

export function TakeOverButton({ encounterId }: { encounterId: string }) {
  return (
    <ConfirmAction
      action={takeOverEncounterAction}
      input={{ encounterId }}
      variant="secondary"
      size="md"
      trigger="Take over"
      title="Take over this consultation?"
      description="You become its doctor: you write the notes and sign it. The change is recorded in the audit trail."
      confirmLabel="Take over"
      successMessage="You are now the consulting doctor"
    />
  );
}
