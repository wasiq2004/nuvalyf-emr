"use client";

// One-click queue actions for nurses and doctors. Each opens the
// consultation once the server has accepted it.
import { Check, Megaphone, PhoneCall, Stethoscope } from "lucide-react";
import { ActionButton } from "@/components/app/action-button";
import { callNextAction, callPatientAction, startTriageAction } from "@/features/clinical/clinical.actions";
import { markResultReadAction } from "@/features/clinical/lab.actions";

const toEncounter = (data: { encounterId: string }) => `/encounters/${data.encounterId}`;

export function StartTriageButton({ visitId, patientName }: { visitId: string; patientName: string }) {
  return (
    <ActionButton action={startTriageAction} input={{ visitId }} navigateTo={toEncounter} aria-label={`Start triage for ${patientName}`}>
      <Stethoscope className="h-4 w-4" /> Triage
    </ActionButton>
  );
}

export function CallPatientButton({ visitId, patientName }: { visitId: string; patientName: string }) {
  return (
    <ActionButton action={callPatientAction} input={{ visitId }} navigateTo={toEncounter} aria-label={`Call ${patientName}`}>
      <PhoneCall className="h-4 w-4" /> Call
    </ActionButton>
  );
}

export function CallNextButton() {
  return (
    <ActionButton action={callNextAction} input={{}} navigateTo={toEncounter} variant="primary" size="md">
      <Megaphone className="h-4 w-4" /> Call next patient
    </ActionButton>
  );
}

export function MarkReadButton({ id }: { id: string }) {
  return (
    <ActionButton action={markResultReadAction} input={{ id }} successMessage="Marked as read">
      <Check className="h-4 w-4" /> Mark read
    </ActionButton>
  );
}
