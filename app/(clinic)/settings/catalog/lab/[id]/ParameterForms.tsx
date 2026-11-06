"use client";

// A lab test's parameters and ranges, edited by the clinic.
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { ActionForm, Field, SelectInput, SubmitButton, TextInput } from "@/components/app/form";
import { FormDialog } from "@/components/app/dialogs";
import { buttonClass } from "@/components/app/buttons";
import { EntryActiveToggle } from "../../CatalogForms";
import { deleteLabRangeAction, saveLabParameterAction, saveLabRangeAction } from "@/features/catalog/catalog.actions";

type Values = { id: string; name: string; section: string; unit: string; valueType: string; normalText: string; sortOrder: number };

export function ParameterDialog({ testId, nextOrder, values }: { testId: string; nextOrder: number; values?: Values }) {
  const editing = Boolean(values);
  return (
    <FormDialog
      variant={editing ? "ghost" : "primary"}
      size={editing ? "sm" : "md"}
      trigger={
        editing ? (
          "Edit"
        ) : (
          <>
            <Plus className="h-4 w-4" /> Add parameter
          </>
        )
      }
      title={editing ? `Edit ${values!.name}` : "Add a parameter"}
    >
      {(close) => (
        <ActionForm action={saveLabParameterAction} successMessage="Parameter saved" onSuccess={close}>
          <input type="hidden" name="id" value={values?.id ?? ""} />
          <input type="hidden" name="testId" value={testId} />
          <Field label="Name" name="name" required>
            <TextInput name="name" defaultValue={values?.name} placeholder="e.g. Haemoglobin" />
          </Field>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Unit" name="unit">
              <TextInput name="unit" defaultValue={values?.unit} placeholder="e.g. g/dL" />
            </Field>
            <Field label="Report heading" name="section" hint="Groups parameters on the report">
              <TextInput name="section" defaultValue={values?.section} placeholder="e.g. Differential count" />
            </Field>
            <Field label="Result is" name="valueType" required>
              <SelectInput
                name="valueType"
                defaultValue={values?.valueType ?? "number"}
                options={[
                  { value: "number", label: "A number" },
                  { value: "text", label: "A word or phrase" },
                ]}
              />
            </Field>
            <Field label="Expected finding" name="normalText" hint="For words, e.g. Negative">
              <TextInput name="normalText" defaultValue={values?.normalText} />
            </Field>
            <Field label="Order on the report" name="sortOrder">
              <TextInput name="sortOrder" type="number" min={0} defaultValue={values?.sortOrder ?? nextOrder} />
            </Field>
          </div>
          <div className="flex justify-end">
            <SubmitButton>Save</SubmitButton>
          </div>
        </ActionForm>
      )}
    </FormDialog>
  );
}

export function ParameterToggle({ id, name, isActive }: { id: string; name: string; isActive: boolean }) {
  return <EntryActiveToggle kind="labParameter" id={id} name={name} isActive={isActive} />;
}

export function RangeDialog({ parameterId, name }: { parameterId: string; name: string }) {
  return (
    <FormDialog
      variant="secondary"
      size="sm"
      trigger={
        <>
          <Plus className="h-4 w-4" /> Range
        </>
      }
      title={`Reference range for ${name}`}
      description="The narrowest age band matching the patient is used; a sex-specific range wins over one for everyone."
    >
      {(close) => (
        <ActionForm action={saveLabRangeAction} successMessage="Range saved" onSuccess={close}>
          <input type="hidden" name="parameterId" value={parameterId} />
          <div className="grid gap-5 sm:grid-cols-3">
            <Field label="For" name="sex" required>
              <SelectInput
                name="sex"
                defaultValue="any"
                options={[
                  { value: "any", label: "Everyone" },
                  { value: "male", label: "Male" },
                  { value: "female", label: "Female" },
                ]}
              />
            </Field>
            <Field label="From age" name="ageMinYears">
              <TextInput name="ageMinYears" type="number" min={0} defaultValue={0} />
            </Field>
            <Field label="To age" name="ageMaxYears" hint="Empty: no limit">
              <TextInput name="ageMaxYears" type="number" min={0} />
            </Field>
            <Field label="Low" name="low">
              <TextInput name="low" inputMode="decimal" />
            </Field>
            <Field label="High" name="high">
              <TextInput name="high" inputMode="decimal" />
            </Field>
            <span className="hidden sm:block" />
            <Field label="Critical low" name="criticalLow">
              <TextInput name="criticalLow" inputMode="decimal" />
            </Field>
            <Field label="Critical high" name="criticalHigh">
              <TextInput name="criticalHigh" inputMode="decimal" />
            </Field>
          </div>
          <div className="flex justify-end">
            <SubmitButton>Save range</SubmitButton>
          </div>
        </ActionForm>
      )}
    </FormDialog>
  );
}

export function DeleteRangeButton({ id }: { id: string }) {
  const router = useRouter();
  return (
    <button
      type="button"
      aria-label="Remove this range"
      onClick={async () => {
        const result = await deleteLabRangeAction({ id });
        if (!result.ok) return toast.error(result.error);
        toast.success("Range removed");
        router.refresh();
      }}
      className={buttonClass("ghost", "sm", "px-2")}
    >
      <Trash2 className="h-4 w-4" />
    </button>
  );
}
