"use client";

// Take items back (credit note) or cancel today's sale outright.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Ban, Loader2, Undo2 } from "lucide-react";
import { ActionForm, Field, SubmitButton, TextInput, inputClass } from "@/components/app/form";
import { buttonClass } from "@/components/app/buttons";
import { FormDialog } from "@/components/app/dialogs";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cancelSaleAction, saleReturnAction } from "@/features/pharmacy/returns.actions";
import { cn } from "@/lib/utils";

export type ReturnableLine = { id: string; description: string; batchNo: string; quantity: number; returnable: number; unitLabel: string };

export function ReturnItemsDialog({ saleId, lines }: { saleId: string; lines: ReturnableLine[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState("");
  const [qty, setQty] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);

  const chosen = lines.map((l) => ({ ...l, n: Number(qty[l.id] || 0) }));
  const bad = chosen.some((l) => !Number.isInteger(l.n) || l.n < 0 || l.n > l.returnable);
  const any = chosen.some((l) => l.n > 0);

  async function submit() {
    setPending(true);
    const result = await saleReturnAction({ saleId, reason, idempotencyKey: key, lines: chosen.filter((l) => l.n > 0).map((l) => ({ saleItemId: l.id, quantity: l.n })) });
    setPending(false);
    if (!result.ok) return toast.error(result.fieldErrors ? Object.values(result.fieldErrors)[0] : result.error);
    toast.success(`Credit note ${result.data.number}: refund ₹${result.data.refund}${result.data.refundMethod === "account" ? " to the account" : ""}`);
    setOpen(false);
    router.push(`/pharmacy/returns/${result.data.returnId}`);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setKey(crypto.randomUUID());
          setQty({});
          setReason("");
          setOpen(true);
        }}
        className={buttonClass("secondary", "md")}
      >
        <Undo2 className="h-4 w-4" /> Return items
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92vh] overflow-y-auto rounded-3xl sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-xl">Return items</DialogTitle>
            <DialogDescription>Units go back into their batch and the refund is their exact share of what was paid, GST included. A credit note is issued.</DialogDescription>
          </DialogHeader>
          <ul className="mt-2 space-y-2">
            {chosen.map((l) => (
              <li key={l.id} className="grid items-center gap-3 rounded-2xl border border-zinc-200 p-3 sm:grid-cols-[1fr_7rem] dark:border-zinc-800">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">{l.description}</p>
                  <p className="text-xs text-zinc-500">
                    Batch {l.batchNo} · sold {l.quantity} {l.unitLabel} · {l.returnable} can come back
                  </p>
                </div>
                <input
                  aria-label={`Return quantity of ${l.description}`}
                  type="number"
                  min={0}
                  max={l.returnable}
                  disabled={l.returnable === 0}
                  value={qty[l.id] ?? ""}
                  placeholder="0"
                  onChange={(e) => setQty((prev) => ({ ...prev, [l.id]: e.target.value }))}
                  className={cn(inputClass, "h-10", l.n > l.returnable && "border-red-400")}
                />
              </li>
            ))}
          </ul>
          <label className="mt-3 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Reason
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Doctor changed the medicine" className={cn(inputClass, "mt-1.5 h-11")} />
          </label>
          <div className="flex justify-end pt-2">
            <button type="button" onClick={submit} disabled={pending || bad || !any || !reason.trim()} className={buttonClass("primary", "md")}>
              {pending && <Loader2 className="h-4 w-4 animate-spin" />}
              Take back &amp; refund
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function CancelSaleDialog({ saleId, number }: { saleId: string; number: string }) {
  const router = useRouter();
  const [key] = useState(() => crypto.randomUUID());
  return (
    <FormDialog
      variant="danger-outline"
      trigger={
        <>
          <Ban className="h-4 w-4" /> Cancel sale
        </>
      }
      title={`Cancel ${number}?`}
      description="Everything goes back into stock and the full amount is refunded on a credit note. Only today's sales with no returns can be cancelled."
    >
      {(close) => (
        <ActionForm
          action={cancelSaleAction}
          successMessage="Sale cancelled"
          onSuccess={(data: { returnId: string }) => {
            close();
            router.push(`/pharmacy/returns/${data.returnId}`);
          }}
        >
          <input type="hidden" name="saleId" value={saleId} />
          <input type="hidden" name="idempotencyKey" value={key} />
          <Field label="Reason" name="reason" required>
            <TextInput name="reason" placeholder="e.g. Billed twice by mistake" />
          </Field>
          <div className="flex justify-end">
            <SubmitButton variant="danger">Cancel sale</SubmitButton>
          </div>
        </ActionForm>
      )}
    </FormDialog>
  );
}
