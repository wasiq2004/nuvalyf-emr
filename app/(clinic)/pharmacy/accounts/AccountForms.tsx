"use client";

// Customer records, money received from customers and money paid to suppliers.
import { HandCoins, Pencil, UserPlus } from "lucide-react";
import { ActionForm, Field, SelectInput, SubmitButton, TextInput } from "@/components/app/form";
import { FormDialog } from "@/components/app/dialogs";
import { recordReceiptAction, recordSupplierPaymentAction, saveCustomerAction } from "@/features/pharmacy/accounts.actions";

const METHODS = [
  { value: "cash", label: "Cash" },
  { value: "upi", label: "UPI" },
  { value: "card", label: "Card" },
  { value: "bank", label: "Bank transfer" },
  { value: "cheque", label: "Cheque" },
  { value: "other", label: "Other" },
];

export type CustomerValues = { id: string; name: string; phone: string; address: string; gstin: string; stateCode: string; creditLimit: string };

export function CustomerDialog({ values, canSetCredit }: { values?: CustomerValues; canSetCredit: boolean }) {
  return (
    <FormDialog
      variant={values ? "secondary" : "primary"}
      trigger={
        values ? (
          <>
            <Pencil className="h-4 w-4" /> Edit
          </>
        ) : (
          <>
            <UserPlus className="h-4 w-4" /> New customer
          </>
        )
      }
      title={values ? `Edit ${values.name}` : "New customer"}
      description="For credit sales and GST-registered buyers. Walk-in cash buyers need no record."
    >
      {(close) => (
        <ActionForm action={saveCustomerAction} successMessage={values ? "Customer saved" : "Customer added"} onSuccess={close}>
          {values && <input type="hidden" name="id" value={values.id} />}
          <Field label="Name" name="name" required>
            <TextInput name="name" defaultValue={values?.name} />
          </Field>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Phone" name="phone">
              <TextInput name="phone" type="tel" defaultValue={values?.phone} />
            </Field>
            <Field label="GSTIN" name="gstin" hint="For a registered buyer">
              <TextInput name="gstin" defaultValue={values?.gstin} className="uppercase placeholder:normal-case" maxLength={15} />
            </Field>
          </div>
          <Field label="Address" name="address">
            <TextInput name="address" defaultValue={values?.address} />
          </Field>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="State code" name="stateCode" hint="Taken from the GSTIN when there is one">
              <TextInput name="stateCode" defaultValue={values?.stateCode} inputMode="numeric" maxLength={2} />
            </Field>
            {canSetCredit && (
              <Field label="Credit limit (₹)" name="creditLimit" hint="Empty: no limit">
                <TextInput name="creditLimit" defaultValue={values?.creditLimit} inputMode="decimal" />
              </Field>
            )}
          </div>
          <div className="flex justify-end">
            <SubmitButton>{values ? "Save" : "Add customer"}</SubmitButton>
          </div>
        </ActionForm>
      )}
    </FormDialog>
  );
}

/** "Receive payment" from a customer, or "Record payment" to a supplier. */
export function PaymentDialog({ side, partyId, partyName, outstanding }: { side: "customer" | "supplier"; partyId: string; partyName: string; outstanding: string }) {
  const customer = side === "customer";
  return (
    <FormDialog
      trigger={
        <>
          <HandCoins className="h-4 w-4" /> {customer ? "Receive payment" : "Record payment"}
        </>
      }
      title={customer ? `Payment from ${partyName}` : `Payment to ${partyName}`}
      description={customer ? `Outstanding ₹${outstanding}. A receipt is issued; it cannot be more than is owed.` : `Owed ₹${outstanding}. It cannot be more than is owed.`}
    >
      {(close) => (
        <ActionForm<{ number: string }> action={customer ? recordReceiptAction : recordSupplierPaymentAction} successMessage={customer ? "Payment received" : "Payment recorded"} onSuccess={close}>
          <input type="hidden" name={customer ? "customerId" : "supplierId"} value={partyId} />
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Amount (₹)" name="amount" required>
              <TextInput name="amount" inputMode="decimal" defaultValue={outstanding} />
            </Field>
            <Field label="Method" name="method" required>
              <SelectInput name="method" options={METHODS} defaultValue="cash" />
            </Field>
          </div>
          <Field label="Reference" name="reference" hint="UPI reference, cheque number…">
            <TextInput name="reference" />
          </Field>
          <Field label="Note" name="note">
            <TextInput name="note" />
          </Field>
          <div className="flex justify-end">
            <SubmitButton>{customer ? "Receive" : "Record"}</SubmitButton>
          </div>
        </ActionForm>
      )}
    </FormDialog>
  );
}
