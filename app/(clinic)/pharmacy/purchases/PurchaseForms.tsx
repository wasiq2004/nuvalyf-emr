"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Loader2, PackageCheck, Pencil, Plus, Send, Trash2, X } from "lucide-react";
import { ActionForm, Field, SelectInput, SubmitButton, TextInput, inputClass } from "@/components/app/form";
import { ConfirmAction, FormDialog } from "@/components/app/dialogs";
import { ActionButton } from "@/components/app/action-button";
import { buttonClass } from "@/components/app/buttons";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  cancelOrderAction,
  createOrderAction,
  decideOrderAction,
  receiveOrderAction,
  removeOrderItemAction,
  saveSupplierAction,
  setOrderItemAction,
  submitOrderAction,
} from "@/features/pharmacy/pharmacy.actions";
import { cn } from "@/lib/utils";

export function SupplierDialog({ values }: { values?: { id: string; name: string; contactName: string; phone: string; email: string; taxId: string } }) {
  const editing = Boolean(values);
  return (
    <FormDialog
      variant={editing ? "ghost" : "secondary"}
      size="sm"
      trigger={editing ? <Pencil className="h-4 w-4" aria-label={`Edit ${values!.name}`} /> : <><Plus className="h-4 w-4" /> Add supplier</>}
      title={editing ? `Edit ${values!.name}` : "Add a supplier"}
    >
      {(close) => (
        <ActionForm action={saveSupplierAction} successMessage="Supplier saved" onSuccess={close}>
          <input type="hidden" name="id" value={values?.id ?? ""} />
          <Field label="Name" name="name" required>
            <TextInput name="name" defaultValue={values?.name} />
          </Field>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Contact person" name="contactName">
              <TextInput name="contactName" defaultValue={values?.contactName} />
            </Field>
            <Field label="Phone" name="phone">
              <TextInput name="phone" defaultValue={values?.phone} />
            </Field>
            <Field label="Email" name="email">
              <TextInput name="email" type="email" defaultValue={values?.email} />
            </Field>
            <Field label="GSTIN / tax ID" name="taxId">
              <TextInput name="taxId" defaultValue={values?.taxId} />
            </Field>
          </div>
          <div className="flex justify-end">
            <SubmitButton>{editing ? "Save" : "Add supplier"}</SubmitButton>
          </div>
        </ActionForm>
      )}
    </FormDialog>
  );
}

export function NewOrderDialog({ suppliers }: { suppliers: { id: string; name: string }[] }) {
  const router = useRouter();
  return (
    <FormDialog
      trigger={
        <>
          <Plus className="h-4 w-4" /> New order
        </>
      }
      title="New purchase order"
    >
      {(close) => (
        <ActionForm
          action={createOrderAction}
          onSuccess={(data: { id: string }) => {
            close();
            router.push(`/pharmacy/purchases/${data.id}`);
          }}
        >
          <Field label="Supplier" name="supplierId" required>
            <SelectInput name="supplierId" placeholder="Choose a supplier" options={suppliers.map((s) => ({ value: s.id, label: s.name }))} />
          </Field>
          <div className="flex justify-end">
            <SubmitButton>Create draft</SubmitButton>
          </div>
        </ActionForm>
      )}
    </FormDialog>
  );
}

export function OrderLineForm({ orderId, drugs }: { orderId: string; drugs: { id: string; name: string }[] }) {
  return (
    <ActionForm action={setOrderItemAction} successMessage="Line saved" resetOnSuccess>
      <input type="hidden" name="orderId" value={orderId} />
      <div className="grid gap-4 sm:grid-cols-[1fr_7rem_8rem_auto] sm:items-end">
        <Field label="Medicine" name="drugId" required>
          <SelectInput name="drugId" placeholder="Choose a medicine" options={drugs.map((d) => ({ value: d.id, label: d.name }))} />
        </Field>
        <Field label="Quantity" name="quantity" required>
          <TextInput name="quantity" type="number" min={1} />
        </Field>
        <Field label="Cost / unit" name="unitCost">
          <TextInput name="unitCost" inputMode="decimal" />
        </Field>
        <SubmitButton variant="secondary">
          <Plus className="h-4 w-4" /> Add
        </SubmitButton>
      </div>
    </ActionForm>
  );
}

export function RemoveOrderLine({ id, name }: { id: string; name: string }) {
  return (
    <ActionButton action={removeOrderItemAction} input={{ id }} variant="ghost" className="px-2" aria-label={`Remove ${name}`}>
      <Trash2 className="h-4 w-4" />
    </ActionButton>
  );
}

export function SubmitOrderButton({ orderId }: { orderId: string }) {
  return (
    <ConfirmAction
      action={submitOrderAction}
      input={{ orderId }}
      variant="primary"
      size="md"
      trigger={
        <>
          <Send className="h-4 w-4" /> Submit for approval
        </>
      }
      title="Submit this order?"
      description="It can no longer be edited. Someone with approval rights (not you) approves or rejects it."
      confirmLabel="Submit"
      successMessage="Order submitted"
    />
  );
}

export function CancelOrderButton({ orderId }: { orderId: string }) {
  return (
    <ConfirmAction
      action={cancelOrderAction}
      input={{ orderId }}
      variant="danger-outline"
      size="md"
      trigger="Cancel order"
      title="Cancel this order?"
      description="It stays on record as cancelled."
      confirmLabel="Cancel order"
      destructive
      successMessage="Order cancelled"
    />
  );
}

export function DecideOrderButtons({ orderId }: { orderId: string }) {
  return (
    <>
      <ConfirmAction
        action={decideOrderAction}
        input={{ orderId, decision: "approved" }}
        variant="primary"
        size="md"
        trigger={
          <>
            <Check className="h-4 w-4" /> Approve
          </>
        }
        title="Approve this order?"
        description="The pharmacy can then receive the delivery into stock."
        confirmLabel="Approve"
        successMessage="Order approved"
      />
      <FormDialog
        variant="danger-outline"
        trigger={
          <>
            <X className="h-4 w-4" /> Reject
          </>
        }
        title="Reject this order?"
      >
        {(close) => (
          <ActionForm action={decideOrderAction} successMessage="Order rejected" onSuccess={close}>
            <input type="hidden" name="orderId" value={orderId} />
            <input type="hidden" name="decision" value="rejected" />
            <Field label="Reason" name="note" required>
              <TextInput name="note" placeholder="e.g. Quantity too high for current usage" />
            </Field>
            <div className="flex justify-end">
              <SubmitButton variant="danger">Reject</SubmitButton>
            </div>
          </ActionForm>
        )}
      </FormDialog>
    </>
  );
}

type ReceiveItem = { id: string; drugName: string; quantity: number; unitCost: string | null };

/** Book the delivery: batch, expiry and quantity per line, sent once. */
export function ReceiveOrderDialog({ orderId, items }: { orderId: string; items: ReceiveItem[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState("");
  const [pending, setPending] = useState(false);
  const [rows, setRows] = useState<Record<string, { batchNo: string; expiryDate: string; quantity: string; unitCost: string }>>({});

  function show() {
    setKey(crypto.randomUUID());
    setRows(Object.fromEntries(items.map((i) => [i.id, { batchNo: "", expiryDate: "", quantity: String(i.quantity), unitCost: i.unitCost ?? "" }])));
    setOpen(true);
  }

  async function submit() {
    setPending(true);
    const result = await receiveOrderAction({
      orderId,
      idempotencyKey: key,
      lines: items.map((i) => ({ itemId: i.id, ...rows[i.id] })),
    });
    setPending(false);
    if (!result.ok) {
      toast.error(result.fieldErrors ? `Check the lines: ${Object.values(result.fieldErrors)[0]}` : result.error);
      return;
    }
    toast.success("Delivery received into stock");
    setOpen(false);
    router.refresh();
  }

  const set = (id: string, field: string, value: string) => setRows((prev) => ({ ...prev, [id]: { ...prev[id], [field]: value } }));

  return (
    <>
      <button type="button" onClick={show} className={buttonClass("primary", "md")}>
        <PackageCheck className="h-4 w-4" /> Receive delivery
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92vh] overflow-y-auto rounded-3xl sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="text-xl">Receive delivery</DialogTitle>
            <DialogDescription>Enter the batch and expiry printed on each pack. Set quantity to 0 for anything that did not arrive.</DialogDescription>
          </DialogHeader>
          <div className="mt-2 space-y-3">
            {items.map((i) => (
              <div key={i.id} className="grid gap-2 rounded-2xl border border-zinc-200 p-3 sm:grid-cols-[1fr_8rem_9rem_5rem_6rem] sm:items-end dark:border-zinc-800">
                <p className="text-sm font-medium text-zinc-900 sm:pb-2.5 dark:text-zinc-100">{i.drugName}</p>
                <input aria-label={`Batch for ${i.drugName}`} placeholder="Batch" value={rows[i.id]?.batchNo ?? ""} onChange={(e) => set(i.id, "batchNo", e.target.value)} className={cn(inputClass, "h-10 uppercase")} />
                <input aria-label={`Expiry for ${i.drugName}`} type="date" value={rows[i.id]?.expiryDate ?? ""} onChange={(e) => set(i.id, "expiryDate", e.target.value)} className={cn(inputClass, "h-10")} />
                <input aria-label={`Quantity of ${i.drugName}`} type="number" min={0} value={rows[i.id]?.quantity ?? ""} onChange={(e) => set(i.id, "quantity", e.target.value)} className={cn(inputClass, "h-10")} />
                <input aria-label={`Cost of ${i.drugName}`} inputMode="decimal" placeholder="Cost" value={rows[i.id]?.unitCost ?? ""} onChange={(e) => set(i.id, "unitCost", e.target.value)} className={cn(inputClass, "h-10")} />
              </div>
            ))}
            <div className="flex justify-end pt-2">
              <button type="button" onClick={submit} disabled={pending} className={buttonClass("primary", "md")}>
                {pending && <Loader2 className="h-4 w-4 animate-spin" />}
                Add to stock
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
