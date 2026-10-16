"use client";

import { ActionForm, Field, SelectInput, SubmitButton, TextArea, TextInput } from "@/components/app/form";
import { FormDialog } from "@/components/app/dialogs";
import { enterLabResultAction } from "@/features/clinical/lab.actions";

export function EnterResultDialog({
  id,
  testName,
  patientName,
  unit,
  referenceRange,
}: {
  id: string;
  testName: string;
  patientName: string;
  unit: string | null;
  referenceRange: string | null;
}) {
  return (
    <FormDialog
      size="sm"
      trigger="Enter result"
      title={testName}
      description={`${patientName}. Once saved, the result cannot be edited and goes straight to the ordering doctor.`}
    >
      {(close) => (
        <ActionForm action={enterLabResultAction} successMessage="Result sent to the doctor" onSuccess={close}>
          <input type="hidden" name="id" value={id} />
          <Field
            label={unit ? `Result (${unit})` : "Result"}
            name="value"
            required
            hint={referenceRange ? `Reference range: ${referenceRange}` : undefined}
          >
            <TextArea name="value" rows={unit ? 1 : 4} className={unit ? "min-h-11" : undefined} autoFocus />
          </Field>
          <Field label="Interpretation" name="flag" required>
            <SelectInput
              name="flag"
              defaultValue="normal"
              options={[
                { value: "normal", label: "Within normal limits" },
                { value: "abnormal", label: "Abnormal" },
                { value: "critical", label: "Critical: tell the doctor now" },
              ]}
            />
          </Field>
          <Field label="Notes" name="notes">
            <TextInput name="notes" placeholder="Optional, e.g. sample haemolysed" />
          </Field>
          <div className="flex justify-end">
            <SubmitButton>Save result</SubmitButton>
          </div>
        </ActionForm>
      )}
    </FormDialog>
  );
}
