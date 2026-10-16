"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Siren } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ActionForm, Field, SelectInput, SubmitButton, TextInput } from "@/components/app/form";
import { admitEmergencyAction } from "@/features/patients/patients.actions";

/**
 * The red Emergency button in the header of every clinic screen. Only a label
 * is required ("Unknown male, approx 40" is valid); the patient goes straight
 * to the front of the queue and an URGENT task tracks the incomplete record.
 */
export function EmergencyButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="inline-flex h-9 items-center gap-2 rounded-xl bg-red-600 px-3.5 text-sm font-semibold text-white shadow-md shadow-red-600/25 transition hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 focus-visible:ring-offset-2"
        >
          <Siren className="h-4 w-4" aria-hidden />
          Emergency
        </button>
      </DialogTrigger>
      <DialogContent className="rounded-3xl border-red-200 sm:max-w-md dark:border-red-900">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl text-red-700 dark:text-red-400">
            <Siren className="h-5 w-5" aria-hidden /> Admit an emergency
          </DialogTitle>
          <DialogDescription>
            Only a description is required. The patient goes to the front of the queue and the record can be completed
            later.
          </DialogDescription>
        </DialogHeader>
        <ActionForm
          action={admitEmergencyAction}
          refresh
          onSuccess={(data) => {
            setOpen(false);
            toast.success(`Emergency admitted as ${data.mrn}: front of the queue`, {
              action: { label: "Open queue", onClick: () => router.push("/queue") },
            });
          }}
        >
          <Field label="Description" name="label" required hint='e.g. "Unknown male, approx 40, road accident"'>
            <TextInput name="label" autoFocus required maxLength={200} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Sex" name="sex">
              <SelectInput
                name="sex"
                defaultValue="unknown"
                options={[
                  { value: "unknown", label: "Unknown" },
                  { value: "male", label: "Male" },
                  { value: "female", label: "Female" },
                  { value: "other", label: "Other" },
                ]}
              />
            </Field>
            <Field label="Approx. age" name="approxAge">
              <TextInput name="approxAge" type="number" min={0} max={130} inputMode="numeric" />
            </Field>
          </div>
          <Field label="Phone of person who brought them" name="companionPhone">
            <TextInput name="companionPhone" type="tel" />
          </Field>
          <SubmitButton variant="danger" size="lg" className="w-full" pendingLabel="Admitting...">
            Admit to front of queue
          </SubmitButton>
        </ActionForm>
      </DialogContent>
    </Dialog>
  );
}
