"use client";

import { FilePlus2, Receipt } from "lucide-react";
import { ActionButton } from "@/components/app/action-button";
import { createInvoiceAction, createInvoiceForVisitAction } from "@/features/billing/billing.actions";

const toInvoice = (data: { id: string }) => `/billing/${data.id}`;

export function BillVisitButton({ visitId, patientName }: { visitId: string; patientName: string }) {
  return (
    <ActionButton action={createInvoiceForVisitAction} input={{ visitId }} navigateTo={toInvoice} aria-label={`Bill ${patientName}`}>
      <Receipt className="h-4 w-4" /> Bill
    </ActionButton>
  );
}

export function NewInvoiceButton({ patientId }: { patientId: string }) {
  return (
    <ActionButton action={createInvoiceAction} input={{ patientId }} navigateTo={toInvoice} size="md">
      <FilePlus2 className="h-4 w-4" /> New invoice
    </ActionButton>
  );
}
