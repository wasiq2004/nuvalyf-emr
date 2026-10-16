"use client";

// Move a booked appointment in one step: pick a day, pick a free slot. The
// server releases the old slot and takes the new one together.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalendarClock, Loader2 } from "lucide-react";
import { inputClass } from "@/components/app/form";
import { buttonClass } from "@/components/app/buttons";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getSlotsAction, rescheduleAppointmentAction } from "@/features/scheduling/booking.actions";
import { cn } from "@/lib/utils";

export function RescheduleDialog({
  id,
  patientName,
  doctorId,
  serviceId,
  date,
}: {
  id: string;
  patientName: string;
  doctorId: string;
  serviceId: string;
  date: string;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [day, setDay] = useState(date);
  const [slots, setSlots] = useState<{ time: string }[] | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function load(nextDay: string) {
    setDay(nextDay);
    setChosen(null);
    setSlots(null);
    const result = await getSlotsAction({ doctorId, serviceId, date: nextDay });
    if (result.ok) setSlots(result.data);
    else {
      setSlots([]);
      toast.error(result.error);
    }
  }

  async function move() {
    if (!chosen) return;
    setPending(true);
    const result = await rescheduleAppointmentAction({ id, date: day, time: chosen });
    setPending(false);
    if (!result.ok) return toast.error(result.error);
    toast.success(`Moved to ${day} at ${chosen}`);
    setOpen(false);
    startTransition(() => router.refresh());
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          void load(date);
        }}
        className={buttonClass("ghost", "sm")}
        aria-label={`Reschedule ${patientName}`}
      >
        <CalendarClock className="h-3.5 w-3.5" />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92vh] overflow-y-auto rounded-3xl sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-xl">Reschedule {patientName}</DialogTitle>
            <DialogDescription>Same doctor and service. The current slot is released only if the new one is still free.</DialogDescription>
          </DialogHeader>
          <div className="mt-2 space-y-4">
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Day
              <input type="date" value={day} onChange={(e) => e.target.value && load(e.target.value)} className={cn(inputClass, "mt-1.5 h-11")} />
            </label>
            {slots === null ? (
              <p className="flex items-center gap-2 text-sm text-zinc-500">
                <Loader2 className="h-4 w-4 animate-spin" /> Finding free slots…
              </p>
            ) : slots.length === 0 ? (
              <p className="text-sm text-zinc-500">No free slots that day (the doctor may be off or away).</p>
            ) : (
              <div className="grid grid-cols-4 gap-2 sm:grid-cols-5" role="group" aria-label="Free slots">
                {slots.map((s) => (
                  <button
                    key={s.time}
                    type="button"
                    aria-pressed={chosen === s.time}
                    onClick={() => setChosen(s.time)}
                    className={cn(
                      "rounded-xl border px-2 py-2 text-sm font-medium tabular-nums transition-colors",
                      chosen === s.time
                        ? "accent-gradient-x border-transparent text-white"
                        : "border-zinc-200 hover:border-(--accent-soft-border) hover:bg-(--accent-soft) dark:border-zinc-800",
                    )}
                  >
                    {s.time}
                  </button>
                ))}
              </div>
            )}
            <div className="flex justify-end">
              <button type="button" onClick={move} disabled={!chosen || pending} className={buttonClass("primary", "md")}>
                {pending && <Loader2 className="h-4 w-4 animate-spin" />}
                {chosen ? `Move to ${chosen}` : "Choose a slot"}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
