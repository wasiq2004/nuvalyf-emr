// A set of vitals as tiles, coloured by the flags the server computed.
import { cn } from "@/lib/utils";
import { bmi, FLAG_LABELS, isCritical, VITAL_FIELDS, type VitalFlag, type VitalKey } from "@/features/clinical/vital-rules";

function tone(flag: VitalFlag | undefined) {
  if (!flag) return "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950";
  if (isCritical(flag)) return "border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950/40";
  return "border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40";
}

export function VitalsGrid({
  values,
  flags,
  compact = false,
}: {
  values: Partial<Record<VitalKey, number>>;
  flags: Partial<Record<VitalKey, VitalFlag>>;
  compact?: boolean;
}) {
  const tiles = VITAL_FIELDS.filter(
    (f) => f.key !== "diastolic" && (values[f.key] !== undefined || (f.key === "systolic" && values.diastolic !== undefined)),
  );
  const bmiValue = bmi(values.weight_kg, values.height_cm);

  return (
    <dl className={cn("grid gap-2", compact ? "grid-cols-2 sm:grid-cols-3" : "grid-cols-2 sm:grid-cols-4")}>
      {tiles.map((field) => {
        const isBp = field.key === "systolic";
        // BP shows the worse of its two flags.
        const flag = isBp
          ? ([flags.systolic, flags.diastolic].find((f) => isCritical(f)) ?? flags.systolic ?? flags.diastolic)
          : flags[field.key];
        const value = isBp
          ? `${values.systolic ?? "—"}/${values.diastolic ?? "—"}`
          : String(values[field.key]);
        return (
          <div key={field.key} className={cn("rounded-xl border px-3 py-2.5", isBp && compact && "col-span-2", tone(flag))}>
            <dt className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">{isBp ? "BP" : field.short}</dt>
            <dd className="mt-0.5 flex items-baseline gap-1">
              <span
                className={cn(
                  "text-lg font-semibold tabular-nums text-zinc-900 dark:text-zinc-100",
                  flag && (isCritical(flag) ? "text-red-700 dark:text-red-400" : "text-amber-700 dark:text-amber-400"),
                )}
              >
                {value}
              </span>
              <span className="text-xs text-zinc-500">{field.unit}</span>
            </dd>
            {flag && <p className={cn("text-[11px] font-semibold", isCritical(flag) ? "text-red-700 dark:text-red-400" : "text-amber-700 dark:text-amber-400")}>{FLAG_LABELS[flag]}</p>}
          </div>
        );
      })}
      {bmiValue !== null && (
        <div className={cn("rounded-xl border px-3 py-2.5", tone(undefined))}>
          <dt className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">BMI</dt>
          <dd className="mt-0.5 text-lg font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">{bmiValue}</dd>
        </div>
      )}
    </dl>
  );
}
