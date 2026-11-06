// What the pharmacy actually gave against a prescription, beside what the
// doctor wrote. Shown to the pharmacist and on the doctor's consultation page.
import Link from "next/link";
import { StatusBadge } from "@/components/app/status-badge";
import { describeQuantity } from "@/features/pharmacy/selling-rules";
import { LINE_CHANGE_LABELS, dosageText, type LineChange } from "@/features/pharmacy/dispensing-rules";
import { formatDateTime } from "@/lib/format";

export type DispensedLine = {
  id: string;
  saleId: string;
  saleNumber: string;
  soldAt: Date;
  soldByName: string;
  note: string | null;
  description: string;
  quantity: number;
  soldAs: string;
  packs: number | null;
  packSize: number;
  form: string;
  returned: number;
  dose: string | null;
  frequency: string | null;
  durationDays: number | null;
  instructions: string | null;
  lineChange: string;
  prescribedText: string | null;
};

export function DispensedLines({ lines, timezone, linkSales }: { lines: DispensedLine[]; timezone: string; linkSales: boolean }) {
  return (
    <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
      {lines.map((l) => {
        const dosage = dosageText(l);
        const label = LINE_CHANGE_LABELS[l.lineChange as LineChange];
        return (
          <li key={l.id} className="py-3 first:pt-0 last:pb-0">
            <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-zinc-900 dark:text-zinc-100">
              {l.description} · {describeQuantity(l, l.form)}
              {l.returned > 0 && <StatusBadge tone="warning">{l.returned} returned</StatusBadge>}
              {label && l.lineChange !== "as_prescribed" && <StatusBadge tone="warning">{label}</StatusBadge>}
            </p>
            {dosage && <p className="text-sm text-zinc-700 dark:text-zinc-300">{dosage}</p>}
            {l.prescribedText && <p className="text-xs text-zinc-500">Doctor wrote {l.prescribedText}</p>}
            {l.note && <p className="text-xs text-zinc-500">Note: {l.note}</p>}
            <p className="text-xs text-zinc-500">
              {linkSales ? (
                <Link href={`/pharmacy/sales/${l.saleId}`} className="font-mono font-semibold text-(--accent-text) hover:underline">
                  {l.saleNumber}
                </Link>
              ) : (
                <span className="font-mono">{l.saleNumber}</span>
              )}{" "}
              · {formatDateTime(l.soldAt, timezone)} · {l.soldByName}
            </p>
          </li>
        );
      })}
    </ul>
  );
}
