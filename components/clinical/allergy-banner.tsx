// Always-visible allergy status at the top of any clinical screen. Three
// states, never confused: allergies recorded / checked and none known / not
// asked yet.
import { CheckCircle2, CircleHelp, ShieldAlert } from "lucide-react";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { AllergyView } from "@/features/clinical/allergies.service";

export function AllergyBanner({
  allergies,
  noKnownAllergiesAt,
  timezone,
  sticky = false,
}: {
  allergies: AllergyView[];
  noKnownAllergiesAt: Date | null;
  timezone: string;
  sticky?: boolean;
}) {
  const active = allergies.filter((a) => a.status === "active");
  const base = cn(
    "flex items-start gap-3 rounded-2xl border px-5 py-3.5 text-sm shadow-sm backdrop-blur-xl",
    sticky && "sticky top-2 z-20",
  );

  if (active.length > 0) {
    return (
      <div role="alert" aria-label="Allergies" className={cn(base, "border-red-300 bg-red-50/95 text-red-800 dark:border-red-900 dark:bg-red-950/80 dark:text-red-300")}>
        <ShieldAlert className="mt-0.5 h-5 w-5 flex-shrink-0" aria-hidden />
        <div className="min-w-0">
          <p className="font-semibold">Allergies</p>
          <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
            {active.map((a) => (
              <li key={a.id}>
                <span className="font-semibold">{a.substance}</span>
                {a.className && a.className.toLowerCase() !== a.substance.toLowerCase() ? ` (${a.className})` : ""}
                <span className="text-red-700/80 dark:text-red-400/80">
                  {" "}
                  · {a.severity}
                  {a.reaction ? ` · ${a.reaction}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    );
  }

  if (noKnownAllergiesAt) {
    return (
      <div aria-label="Allergies" className={cn(base, "border-emerald-200 bg-emerald-50/95 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/80 dark:text-emerald-300")}>
        <CheckCircle2 className="mt-0.5 h-5 w-5 flex-shrink-0" aria-hidden />
        <p>
          <span className="font-semibold">No known allergies</span> · checked {formatDate(noKnownAllergiesAt, timezone)}
        </p>
      </div>
    );
  }

  return (
    <div aria-label="Allergies" className={cn(base, "border-amber-200 bg-amber-50/95 text-amber-800 dark:border-amber-900 dark:bg-amber-950/80 dark:text-amber-300")}>
      <CircleHelp className="mt-0.5 h-5 w-5 flex-shrink-0" aria-hidden />
      <p>
        <span className="font-semibold">Allergies not recorded yet.</span> Ask the patient before prescribing.
      </p>
    </div>
  );
}
