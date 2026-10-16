// Invoice status as one badge: draft / void, else how much has been paid.
import { StatusBadge } from "@/components/app/status-badge";

export function InvoiceBadge({ status, paymentState }: { status: string; paymentState: "unpaid" | "partial" | "paid" }) {
  if (status === "draft") return <StatusBadge>Draft</StatusBadge>;
  if (status === "void") return <StatusBadge tone="neutral">Void</StatusBadge>;
  if (paymentState === "paid") return <StatusBadge tone="success">Paid</StatusBadge>;
  if (paymentState === "partial") return <StatusBadge tone="warning">Part paid</StatusBadge>;
  return <StatusBadge tone="danger">Unpaid</StatusBadge>;
}
