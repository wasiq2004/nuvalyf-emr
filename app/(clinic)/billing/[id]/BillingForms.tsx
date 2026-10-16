"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Banknote, Ban, CheckCircle2, Plus, RotateCcw, Trash2 } from "lucide-react";
import { ActionForm, Field, SelectInput, SubmitButton, TextInput } from "@/components/app/form";
import { ConfirmAction } from "@/components/app/dialogs";
import { ActionButton } from "@/components/app/action-button";
import { buttonClass } from "@/components/app/buttons";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  addInvoiceItemAction,
  discardDraftAction,
  issueInvoiceAction,
  recordPaymentAction,
  recordRefundAction,
  removeInvoiceItemAction,
  setDiscountAction,
  voidInvoiceAction,
} from "@/features/billing/billing.actions";
import { PAYMENT_METHOD_LABELS, PAYMENT_METHODS } from "@/features/billing/billing-rules";

const METHOD_OPTIONS = PAYMENT_METHODS.map((m) => ({ value: m, label: PAYMENT_METHOD_LABELS[m] }));

export function AddLineForm({ invoiceId, services }: { invoiceId: string; services: { id: string; name: string; price: string }[] }) {
  const [serviceId, setServiceId] = useState("");
  return (
    <ActionForm action={addInvoiceItemAction} successMessage="Line added" resetOnSuccess onSuccess={() => setServiceId("")}>
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <div className="grid gap-4 sm:grid-cols-[1fr_6rem] lg:grid-cols-[14rem_1fr_6rem_8rem_auto] lg:items-end">
        <Field label="Service" name="serviceId">
          <SelectInput
            name="serviceId"
            value={serviceId}
            onChange={(e) => setServiceId(e.target.value)}
            placeholder="Other item…"
            options={services.map((s) => ({ value: s.id, label: s.name }))}
          />
        </Field>
        {!serviceId && (
          <Field label="Description" name="description">
            <TextInput name="description" placeholder="e.g. Dressing, certificate" />
          </Field>
        )}
        <Field label="Qty" name="quantity">
          <TextInput name="quantity" type="number" min={1} defaultValue={1} />
        </Field>
        {!serviceId && (
          <Field label="Price" name="unitPrice">
            <TextInput name="unitPrice" inputMode="decimal" placeholder="0.00" />
          </Field>
        )}
        <SubmitButton variant="secondary">
          <Plus className="h-4 w-4" /> Add
        </SubmitButton>
      </div>
    </ActionForm>
  );
}

export function RemoveLineButton({ id, description }: { id: string; description: string }) {
  return (
    <ActionButton action={removeInvoiceItemAction} input={{ id }} variant="ghost" className="px-2" aria-label={`Remove ${description}`}>
      <Trash2 className="h-4 w-4" />
    </ActionButton>
  );
}

export function DiscountForm({ invoiceId, discount, reason }: { invoiceId: string; discount: string; reason: string }) {
  return (
    <ActionForm action={setDiscountAction} successMessage="Discount saved">
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <div className="grid gap-4 sm:grid-cols-[8rem_1fr_auto] sm:items-end">
        <Field label="Discount" name="discount">
          <TextInput name="discount" inputMode="decimal" defaultValue={discount} />
        </Field>
        <Field label="Reason" name="reason">
          <TextInput name="reason" defaultValue={reason} placeholder="Required for any discount" />
        </Field>
        <SubmitButton variant="secondary">Apply</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function IssueButton({ invoiceId }: { invoiceId: string }) {
  return (
    <ConfirmAction
      action={issueInvoiceAction}
      input={{ invoiceId }}
      variant="secondary"
      size="md"
      trigger={
        <>
          <CheckCircle2 className="h-4 w-4" /> Issue
        </>
      }
      title="Issue this invoice?"
      description="Its lines and amounts become final. Taking a payment issues it automatically."
      confirmLabel="Issue invoice"
      successMessage="Invoice issued"
    />
  );
}

export function DiscardButton({ invoiceId, number }: { invoiceId: string; number: string }) {
  const router = useRouter();
  return (
    <ConfirmAction
      action={discardDraftAction}
      input={{ invoiceId }}
      variant="danger-outline"
      size="md"
      trigger={
        <>
          <Trash2 className="h-4 w-4" /> Discard draft
        </>
      }
      title={`Discard draft ${number}?`}
      description="The draft and its lines are removed. Its number is not reused."
      confirmLabel="Discard"
      destructive
      onSuccess={(data: { patientId: string }) => router.push(`/patients/${data.patientId}`)}
    />
  );
}

/**
 * Payment and refund dialogs. Each opening gets a fresh idempotency key, so
 * a double-click or a network retry of the same submission records once.
 */
function MoneyDialog({
  mode,
  invoiceId,
  max,
  maxLabel,
  trigger,
}: {
  mode: "payment" | "refund";
  invoiceId: string;
  /** Plain amount (pre-fills the field). */
  max: string;
  /** The same amount formatted in the clinic currency. */
  maxLabel: string;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState("");
  const payment = mode === "payment";

  function show() {
    setKey(crypto.randomUUID());
    setOpen(true);
  }

  return (
    <>
      <button type="button" onClick={show} className={buttonClass(payment ? "primary" : "secondary", "md")}>
        {trigger}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92vh] overflow-y-auto rounded-3xl sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-xl">{payment ? "Record a payment" : "Record a refund"}</DialogTitle>
            <DialogDescription>
              {payment ? `Balance due: ${maxLabel}. Enter what the patient actually paid.` : `Up to ${maxLabel} can be refunded. The original payment stays on record.`}
            </DialogDescription>
          </DialogHeader>
          <div className="mt-2">
            <ActionForm
              action={payment ? recordPaymentAction : recordRefundAction}
              successMessage={payment ? "Payment recorded" : "Refund recorded"}
              onSuccess={() => setOpen(false)}
            >
              <input type="hidden" name="invoiceId" value={invoiceId} />
              <input type="hidden" name="idempotencyKey" value={key} />
              <div className="grid gap-5 sm:grid-cols-2">
                <Field label="Amount" name="amount" required>
                  <TextInput name="amount" inputMode="decimal" defaultValue={payment ? max : ""} autoFocus />
                </Field>
                <Field label={payment ? "Paid by" : "Refunded by"} name="method" required>
                  <SelectInput name="method" defaultValue="cash" options={METHOD_OPTIONS} />
                </Field>
              </div>
              {payment ? (
                <Field label="Reference" name="reference" hint="UPI transaction ID or card slip number, if any.">
                  <TextInput name="reference" />
                </Field>
              ) : (
                <Field label="Reason" name="reason" required>
                  <TextInput name="reason" placeholder="e.g. Test not done" />
                </Field>
              )}
              <div className="flex justify-end">
                <SubmitButton variant={payment ? "primary" : "danger"}>{payment ? "Record payment" : "Record refund"}</SubmitButton>
              </div>
            </ActionForm>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function PaymentDialog({ invoiceId, balance, balanceLabel }: { invoiceId: string; balance: string; balanceLabel: string }) {
  return (
    <MoneyDialog
      mode="payment"
      invoiceId={invoiceId}
      max={balance}
      maxLabel={balanceLabel}
      trigger={
        <>
          <Banknote className="h-4 w-4" /> Take payment
        </>
      }
    />
  );
}

export function RefundDialog({ invoiceId, paid, paidLabel }: { invoiceId: string; paid: string; paidLabel: string }) {
  return (
    <MoneyDialog
      mode="refund"
      invoiceId={invoiceId}
      max={paid}
      maxLabel={paidLabel}
      trigger={
        <>
          <RotateCcw className="h-4 w-4" /> Refund
        </>
      }
    />
  );
}

export function VoidButton({ invoiceId, number }: { invoiceId: string; number: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={buttonClass("danger-outline", "md")}>
        <Ban className="h-4 w-4" /> Void
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="rounded-3xl sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-xl">Void {number}?</DialogTitle>
            <DialogDescription>A void invoice stays on record with your reason. It cannot be undone.</DialogDescription>
          </DialogHeader>
          <ActionForm action={voidInvoiceAction} successMessage="Invoice voided" onSuccess={() => setOpen(false)}>
            <input type="hidden" name="invoiceId" value={invoiceId} />
            <Field label="Reason" name="reason" required>
              <TextInput name="reason" placeholder="e.g. Raised against the wrong patient" />
            </Field>
            <div className="flex justify-end">
              <SubmitButton variant="danger">Void invoice</SubmitButton>
            </div>
          </ActionForm>
        </DialogContent>
      </Dialog>
    </>
  );
}
