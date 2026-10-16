// Every allergy entry on a patient, including corrected ones.
import { ShieldAlert } from "lucide-react";
import { EmptyState } from "@/components/app/page";
import { StatusBadge } from "@/components/app/status-badge";
import { formatDate } from "@/lib/format";
import type { AllergyView } from "@/features/clinical/allergies.service";
import { CorrectAllergyDialog } from "./allergy-actions";

const STATUS_LABEL: Record<string, string> = { active: "Active", resolved: "Resolved", entered_in_error: "Entered in error" };

export function AllergyList({ allergies, canWrite, timezone }: { allergies: AllergyView[]; canWrite: boolean; timezone: string }) {
  if (allergies.length === 0) {
    return <EmptyState icon={ShieldAlert} title="No allergies recorded" />;
  }
  return (
    <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
      {allergies.map((a) => (
        <li key={a.id} className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
          <div className="min-w-0">
            <p className={a.status === "active" ? "font-semibold text-zinc-900 dark:text-zinc-100" : "font-medium text-zinc-500 line-through"}>
              {a.substance}
              {a.className && a.className.toLowerCase() !== a.substance.toLowerCase() && (
                <span className="ml-1 font-normal text-zinc-500 no-underline">({a.className})</span>
              )}
            </p>
            <p className="mt-0.5 text-xs text-zinc-500">
              {a.severity}
              {a.reaction ? ` · ${a.reaction}` : ""} · {a.recordedByName}, {formatDate(a.recordedAt, timezone)}
              {a.corrections > 0 ? ` · corrected ${a.corrections}×` : ""}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge tone={a.status === "active" ? (a.severity === "severe" ? "danger" : "warning") : "neutral"}>{STATUS_LABEL[a.status]}</StatusBadge>
            {canWrite && a.status !== "entered_in_error" && <CorrectAllergyDialog allergy={a} />}
          </div>
        </li>
      ))}
    </ul>
  );
}
