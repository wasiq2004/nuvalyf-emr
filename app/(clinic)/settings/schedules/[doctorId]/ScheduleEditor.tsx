"use client";

import { useMemo, useState } from "react";
import { Copy, Plus, Trash2 } from "lucide-react";
import { ActionForm, CheckboxCard, SubmitButton, inputClass } from "@/components/app/form";
import { Panel } from "@/components/app/page";
import { buttonClass } from "@/components/app/buttons";
import { saveDoctorScheduleAction } from "@/features/scheduling/scheduling.actions";
import { WEEKDAYS, findOverlap, type ScheduleWindow } from "@/features/scheduling/schedule-rules";
import { cn } from "@/lib/utils";

// Monday-first, the way clinics read a week.
const ORDER = [1, 2, 3, 4, 5, 6, 0];

export default function ScheduleEditor({
  doctorId,
  initialWindows,
  initialServiceIds,
  services,
}: {
  doctorId: string;
  initialWindows: ScheduleWindow[];
  initialServiceIds: string[];
  services: { id: string; name: string; durationMinutes: number }[];
}) {
  const [windows, setWindows] = useState<ScheduleWindow[]>(initialWindows);
  const problem = useMemo(() => findOverlap(windows), [windows]);

  function update(index: number, patch: Partial<ScheduleWindow>) {
    setWindows((current) => current.map((w, i) => (i === index ? { ...w, ...patch } : w)));
  }
  function add(weekday: number) {
    const sameDay = windows.filter((w) => w.weekday === weekday);
    const last = sameDay.at(-1);
    setWindows((current) => [
      ...current,
      last ? { weekday, startTime: "17:00", endTime: "20:00" } : { weekday, startTime: "09:00", endTime: "13:00" },
    ]);
  }
  function remove(index: number) {
    setWindows((current) => current.filter((_, i) => i !== index));
  }
  function copyToWeekdays(fromDay: number) {
    const template = windows.filter((w) => w.weekday === fromDay);
    setWindows((current) => [
      ...current.filter((w) => w.weekday === fromDay || w.weekday === 0 || w.weekday === 6),
      ...[1, 2, 3, 4, 5].filter((d) => d !== fromDay).flatMap((d) => template.map((w) => ({ ...w, weekday: d }))),
    ]);
  }

  return (
    <ActionForm action={saveDoctorScheduleAction} successMessage="Schedule saved" className="space-y-6">
      <input type="hidden" name="doctorId" value={doctorId} />
      <input type="hidden" name="windows" value={JSON.stringify(windows)} />

      <Panel title="Weekly hours" description="Leave a day empty when the doctor does not work.">
        <div className="space-y-3">
          {ORDER.map((day) => {
            const dayWindows = windows.map((w, index) => ({ w, index })).filter(({ w }) => w.weekday === day);
            return (
              <div
                key={day}
                className={cn(
                  "flex flex-col gap-3 rounded-2xl border p-4 sm:flex-row sm:items-start",
                  dayWindows.length > 0
                    ? "border-(--accent-soft-border) bg-(--accent-soft)/40"
                    : "border-zinc-200 dark:border-zinc-800",
                )}
              >
                <div className="w-32 flex-shrink-0 pt-2 font-semibold text-zinc-900 dark:text-zinc-100">{WEEKDAYS[day]}</div>
                <div className="flex-1 space-y-2">
                  {dayWindows.length === 0 && <p className="pt-2 text-sm text-zinc-500">Not working</p>}
                  {dayWindows.map(({ w, index }) => (
                    <div key={index} className="flex flex-wrap items-center gap-2">
                      <input
                        type="time"
                        value={w.startTime}
                        onChange={(e) => update(index, { startTime: e.target.value })}
                        aria-label={`${WEEKDAYS[day]} start`}
                        className={cn(inputClass, "h-10 w-32")}
                      />
                      <span className="text-zinc-400">to</span>
                      <input
                        type="time"
                        value={w.endTime}
                        onChange={(e) => update(index, { endTime: e.target.value })}
                        aria-label={`${WEEKDAYS[day]} end`}
                        className={cn(inputClass, "h-10 w-32")}
                      />
                      <button
                        type="button"
                        onClick={() => remove(index)}
                        className={buttonClass("ghost", "sm")}
                        aria-label={`Remove ${w.startTime}–${w.endTime} on ${WEEKDAYS[day]}`}
                      >
                        <Trash2 className="h-4 w-4 text-red-500" />
                      </button>
                    </div>
                  ))}
                </div>
                <div className="flex flex-shrink-0 gap-2">
                  <button type="button" onClick={() => add(day)} className={buttonClass("secondary", "sm")}>
                    <Plus className="h-3.5 w-3.5" /> {dayWindows.length > 0 ? "Add shift" : "Add hours"}
                  </button>
                  {dayWindows.length > 0 && day >= 1 && day <= 5 && (
                    <button
                      type="button"
                      onClick={() => copyToWeekdays(day)}
                      className={buttonClass("ghost", "sm")}
                      title="Copy these hours to Monday-Friday"
                    >
                      <Copy className="h-3.5 w-3.5" /> Mon–Fri
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        {problem && (
          <p role="alert" className="mt-4 text-sm font-medium text-red-600 dark:text-red-400">
            {problem}
          </p>
        )}
      </Panel>

      <Panel title="Services offered" description="Leave all unticked if the doctor offers every service.">
        {services.length === 0 ? (
          <p className="text-sm text-zinc-500">No bookable services yet. Add them under Services.</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {services.map((s) => (
              <CheckboxCard
                key={s.id}
                name="serviceIds[]"
                value={s.id}
                label={s.name}
                description={`${s.durationMinutes} min`}
                defaultChecked={initialServiceIds.includes(s.id)}
              />
            ))}
          </div>
        )}
      </Panel>

      <div className="flex justify-end">
        <SubmitButton>Save schedule</SubmitButton>
      </div>
    </ActionForm>
  );
}
