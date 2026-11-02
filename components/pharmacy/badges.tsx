// Pharmacy badges shared by catalogue, stock, sale and report screens.
import { StatusBadge } from "@/components/app/status-badge";

/** Schedule H / H1 / X marker; nothing for unscheduled items. */
export function ScheduleBadge({ schedule }: { schedule: string | null | undefined }) {
  if (!schedule || schedule === "none") return null;
  const tone = schedule === "H" || schedule === "G" ? "warning" : "danger";
  return <StatusBadge tone={tone}>Sch {schedule}</StatusBadge>;
}

/** Where a sale stands after returns. */
export function SaleReturnBadge({ state }: { state: "none" | "partial" | "returned" | "cancelled" }) {
  if (state === "none") return null;
  if (state === "cancelled") return <StatusBadge tone="danger">Cancelled</StatusBadge>;
  if (state === "returned") return <StatusBadge tone="warning">Returned</StatusBadge>;
  return <StatusBadge tone="warning">Part returned</StatusBadge>;
}
