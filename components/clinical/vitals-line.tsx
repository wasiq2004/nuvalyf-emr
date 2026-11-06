// One line of triage for a queue row: the latest vitals, when they were taken
// and by whom, so the doctor can read them before calling the patient.
import { formatRelative, formatTime } from "@/lib/format";
import { isCritical, type VitalFlag, type VitalKey } from "@/features/clinical/vital-rules";
import type { VitalsEntry } from "@/features/clinical/vitals.service";
import { cn } from "@/lib/utils";

const SHOWN: { key: VitalKey; label: string; unit: string }[] = [
  { key: "temperature_c", label: "Temp", unit: "°C" },
  { key: "pulse", label: "Pulse", unit: "" },
  { key: "spo2", label: "SpO₂", unit: "%" },
  { key: "resp_rate", label: "RR", unit: "" },
  { key: "weight_kg", label: "Wt", unit: "kg" },
];

function tone(flag: VitalFlag | undefined) {
  if (!flag) return "text-zinc-700 dark:text-zinc-300";
  return isCritical(flag) ? "font-semibold text-red-700 dark:text-red-400" : "font-semibold text-amber-700 dark:text-amber-400";
}

export function VitalsLine({ vitals, chiefComplaint, timezone, now }: { vitals: VitalsEntry | null; chiefComplaint: string | null; timezone: string; now: Date }) {
  const { values, flags } = vitals ?? { values: {}, flags: {} as VitalsEntry["flags"] };
  const bpFlag = flags.systolic ?? flags.diastolic;
  return (
    <div className="mt-1 space-y-0.5 text-xs">
      {chiefComplaint && <p className="truncate text-zinc-600 dark:text-zinc-400">{chiefComplaint}</p>}
      {vitals ? (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
          {values.systolic !== undefined && <span className={tone(bpFlag)}>BP {values.systolic}/{values.diastolic ?? "—"}</span>}
          {SHOWN.filter((s) => values[s.key] !== undefined).map((s) => (
            <span key={s.key} className={tone(flags[s.key])}>
              {s.label} {values[s.key]}
              {s.unit}
            </span>
          ))}
          <span className={cn("text-zinc-500")}>
            Updated {formatRelative(vitals.recordedAt, now)} ({formatTime(vitals.recordedAt, timezone)}) by {vitals.recordedByName}
          </span>
        </p>
      ) : (
        <p className="font-medium text-amber-700 dark:text-amber-400">Vitals not taken yet</p>
      )}
    </div>
  );
}
