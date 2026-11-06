"use client";

import { Undo2 } from "lucide-react";
import { ActionForm, Field, SubmitButton, TextInput } from "@/components/app/form";
import { FormDialog } from "@/components/app/dialogs";
import { reverseStockImportAction } from "@/features/pharmacy/pharmacy.actions";

/** Takes a wrong load back out, while nothing has touched its batches. */
export function ReverseImport({ jobId, fileName }: { jobId: string; fileName: string }) {
  return (
    <FormDialog
      variant="ghost"
      size="sm"
      trigger={
        <>
          <Undo2 className="h-4 w-4" /> Reverse
        </>
      }
      title={`Reverse ${fileName}`}
      description="Every unit this file added comes back out, and you can then import a corrected file. New items stay in your list. This is only possible while nothing has been sold from those batches: after that, use a stock count."
    >
      {(close) => (
        <ActionForm action={reverseStockImportAction} successMessage="Import reversed" onSuccess={close}>
          <input type="hidden" name="jobId" value={jobId} />
          <Field label="Why" name="note" required>
            <TextInput name="note" placeholder="e.g. Quantities were strips, not tablets" />
          </Field>
          <div className="flex justify-end">
            <SubmitButton>Reverse import</SubmitButton>
          </div>
        </ActionForm>
      )}
    </FormDialog>
  );
}
