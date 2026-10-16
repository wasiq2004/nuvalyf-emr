"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pencil, UserPlus2 } from "lucide-react";
import { ActionForm, Field, SelectInput, SubmitButton, TextArea, TextInput } from "@/components/app/form";
import { FormDialog } from "@/components/app/dialogs";
import { updatePatientAction } from "@/features/patients/patients.actions";
import { walkInAction } from "@/features/queue/queue.actions";

type PatientValues = {
  id: string;
  firstName: string;
  lastName: string;
  sex: string;
  dateOfBirth: string;
  statedAgeYears: string;
  mobile: string;
  altPhone: string;
  email: string;
  addressLine: string;
  city: string;
};

export function EditPatientDialog({ values, completing }: { values: PatientValues; completing: boolean }) {
  return (
    <FormDialog
      title={completing ? "Complete this record" : "Edit patient details"}
      description={completing ? "Saving the patient's real details closes the urgent task." : undefined}
      variant={completing ? "primary" : "secondary"}
      wide
      trigger={
        <>
          <Pencil className="h-4 w-4" /> {completing ? "Complete record" : "Edit details"}
        </>
      }
    >
      {(close) => (
        <ActionForm action={updatePatientAction} successMessage="Patient details saved" onSuccess={close}>
          <input type="hidden" name="id" value={values.id} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="First name" name="firstName" required>
              <TextInput name="firstName" defaultValue={values.firstName} required />
            </Field>
            <Field label="Last name" name="lastName">
              <TextInput name="lastName" defaultValue={values.lastName} />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Sex" name="sex" required>
              <SelectInput
                name="sex"
                defaultValue={values.sex}
                options={[
                  { value: "female", label: "Female" },
                  { value: "male", label: "Male" },
                  { value: "other", label: "Other" },
                  { value: "unknown", label: "Not stated" },
                ]}
              />
            </Field>
            <Field label="Date of birth" name="dateOfBirth">
              <TextInput name="dateOfBirth" type="date" defaultValue={values.dateOfBirth} />
            </Field>
            <Field label="or age" name="statedAgeYears" hint="Stored with today's date.">
              <TextInput name="statedAgeYears" type="number" min={0} max={130} defaultValue={values.statedAgeYears} />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Mobile" name="mobile">
              <TextInput name="mobile" type="tel" defaultValue={values.mobile} />
            </Field>
            <Field label="Alternate phone" name="altPhone">
              <TextInput name="altPhone" type="tel" defaultValue={values.altPhone} />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Email" name="email">
              <TextInput name="email" type="email" defaultValue={values.email} />
            </Field>
            <Field label="City" name="city">
              <TextInput name="city" defaultValue={values.city} />
            </Field>
          </div>
          <Field label="Address" name="addressLine">
            <TextArea name="addressLine" rows={2} defaultValue={values.addressLine} />
          </Field>
          <SubmitButton className="w-full">Save details</SubmitButton>
        </ActionForm>
      )}
    </FormDialog>
  );
}

export function WalkInDialog({
  patientId,
  doctors,
  services,
}: {
  patientId: string;
  doctors: { id: string; name: string }[];
  services: { id: string; name: string }[];
}) {
  const router = useRouter();
  return (
    <FormDialog
      title="Add to today's queue"
      description="For somebody already at the desk without an appointment."
      variant="secondary"
      trigger={
        <>
          <UserPlus2 className="h-4 w-4" /> Walk-in
        </>
      }
    >
      {(close) => (
        <ActionForm
          action={walkInAction}
          refresh={false}
          onSuccess={() => {
            close();
            toast.success("Added to the queue", { action: { label: "Open queue", onClick: () => router.push("/queue") } });
            router.refresh();
          }}
        >
          <input type="hidden" name="patientId" value={patientId} />
          <Field label="Doctor" name="doctorId" hint="Leave empty for the next available doctor.">
            <SelectInput name="doctorId" placeholder="Any doctor" options={doctors.map((d) => ({ value: d.id, label: d.name }))} />
          </Field>
          <Field label="Service" name="serviceId">
            <SelectInput name="serviceId" placeholder="Not specified" options={services.map((s) => ({ value: s.id, label: s.name }))} />
          </Field>
          <SubmitButton className="w-full">Add to queue</SubmitButton>
        </ActionForm>
      )}
    </FormDialog>
  );
}
