"use client";

import { PackagePlus } from "lucide-react";
import { ActionForm, Field, SelectInput, SubmitButton, TextInput } from "@/components/app/form";
import { FormDialog } from "@/components/app/dialogs";
import { adjustStockAction, receiveStockAction, setReorderLevelAction } from "@/features/pharmacy/pharmacy.actions";

export function ReceiveStockDialog({ drugId, drugName }: { drugId: string; drugName: string }) {
  return (
    <FormDialog
      trigger={
        <>
          <PackagePlus className="h-4 w-4" /> Add stock
        </>
      }
      title={`Add stock: ${drugName}`}
      description="For opening stock, a delivery without a purchase order, or a customer return. Deliveries against an order are received on the order."
    >
      {(close) => (
        <ActionForm action={receiveStockAction} successMessage="Stock added" onSuccess={close}>
          <input type="hidden" name="drugId" value={drugId} />
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Batch number" name="batchNo" required>
              <TextInput name="batchNo" className="uppercase" />
            </Field>
            <Field label="Expiry" name="expiryDate" required>
              <TextInput name="expiryDate" type="date" />
            </Field>
            <Field label="Quantity (units)" name="quantity" required>
              <TextInput name="quantity" type="number" min={1} />
            </Field>
            <Field label="Cost per unit" name="unitCost">
              <TextInput name="unitCost" inputMode="decimal" />
            </Field>
          </div>
          <Field label="Why" name="reason" required>
            <SelectInput
              name="reason"
              defaultValue="opening"
              options={[
                { value: "opening", label: "Opening stock / stock count" },
                { value: "receipt", label: "Delivery without a purchase order" },
                { value: "return", label: "Returned by a customer" },
              ]}
            />
          </Field>
          <Field label="Note" name="note">
            <TextInput name="note" />
          </Field>
          <div className="flex justify-end">
            <SubmitButton>Add stock</SubmitButton>
          </div>
        </ActionForm>
      )}
    </FormDialog>
  );
}

export function AdjustBatchDialog({ batchId, batchNo, quantity }: { batchId: string; batchNo: string; quantity: number }) {
  return (
    <FormDialog
      variant="ghost"
      size="sm"
      trigger="Adjust"
      title={`Adjust batch ${batchNo}`}
      description={`${quantity} on hand. Every adjustment is kept in the ledger with your note.`}
    >
      {(close) => (
        <ActionForm action={adjustStockAction} successMessage="Stock adjusted" onSuccess={close}>
          <input type="hidden" name="batchId" value={batchId} />
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Change" name="change" required hint="Negative to remove, e.g. -5.">
              <TextInput name="change" type="number" />
            </Field>
            <Field label="Reason" name="reason" required>
              <SelectInput
                name="reason"
                defaultValue="adjustment"
                options={[
                  { value: "adjustment", label: "Stock count correction" },
                  { value: "expired", label: "Expired: write off" },
                  { value: "damaged", label: "Damaged: write off" },
                ]}
              />
            </Field>
          </div>
          <Field label="Note" name="note" required>
            <TextInput name="note" placeholder="e.g. Physical count, 14 Oct" />
          </Field>
          <div className="flex justify-end">
            <SubmitButton>Save</SubmitButton>
          </div>
        </ActionForm>
      )}
    </FormDialog>
  );
}

export function ReorderLevelForm({ drugId, level }: { drugId: string; level: number }) {
  return (
    <ActionForm action={setReorderLevelAction} successMessage="Reorder level saved">
      <input type="hidden" name="drugId" value={drugId} />
      <div className="flex items-end gap-3">
        <Field label="Alert at or below" name="reorderLevel" className="flex-1">
          <TextInput name="reorderLevel" type="number" min={0} defaultValue={level} />
        </Field>
        <SubmitButton variant="secondary">Save</SubmitButton>
      </div>
    </ActionForm>
  );
}
