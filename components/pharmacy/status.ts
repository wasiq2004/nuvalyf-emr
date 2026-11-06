// Purchase order statuses as badges.
import type { BadgeTone } from "@/components/app/status-badge";

export const ORDER_STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  draft: { label: "Draft", tone: "neutral" },
  submitted: { label: "Awaiting approval", tone: "warning" },
  approved: { label: "Approved", tone: "info" },
  rejected: { label: "Rejected", tone: "danger" },
  received: { label: "Received", tone: "success" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

/** How money moved on a pharmacy document. */
export const MONEY_METHOD_LABELS: Record<string, string> = {
  cash: "Cash",
  upi: "UPI",
  card: "Card",
  other: "Other",
  credit: "On account",
  inpatient: "On the inpatient bill",
  account: "To the account",
  bank: "Bank transfer",
  cheque: "Cheque",
};

export const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  tax_invoice: "Tax invoice",
  bill_of_supply: "Bill of supply",
  cash_memo: "Cash memo",
};
