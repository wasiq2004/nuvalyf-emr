"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Clock, Loader2, Search, UserRound, X } from "lucide-react";
import { ActionForm, Field, SubmitButton, TextArea, inputClass } from "@/components/app/form";
import { Panel } from "@/components/app/page";
import { buttonClass } from "@/components/app/buttons";
import { searchPatientsAction } from "@/features/patients/patients.actions";
import { bookAppointmentAction, getSlotsAction } from "@/features/scheduling/booking.actions";
import type { Slot } from "@/features/scheduling/slots";
import { cn } from "@/lib/utils";

type PatientPick = { id: string; name: string; mrn: string; age: number | null; mobile: string | null };

export default function BookingForm({
  doctors,
  services,
  initialPatient,
  initialDate,
  minDate,
  maxDate,
}: {
  doctors: { id: string; name: string; specialty: string | null; serviceIds: string[] }[];
  services: { id: string; name: string; durationMinutes: number }[];
  initialPatient: PatientPick | null;
  initialDate: string;
  minDate: string;
  maxDate: string;
}) {
  const router = useRouter();
  const [patient, setPatient] = useState<PatientPick | null>(initialPatient);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PatientPick[]>([]);
  const [searching, setSearching] = useState(false);

  const [doctorId, setDoctorId] = useState(doctors[0]?.id ?? "");
  const doctorServices = useMemo(
    () => services.filter((s) => doctors.find((d) => d.id === doctorId)?.serviceIds.includes(s.id)),
    [doctorId, doctors, services],
  );
  const [chosenServiceId, setServiceId] = useState("");
  // The chosen service stays valid for the chosen doctor without extra state syncing.
  const serviceId = doctorServices.some((s) => s.id === chosenServiceId) ? chosenServiceId : (doctorServices[0]?.id ?? "");
  const [date, setDate] = useState(initialDate);

  // Slot results and the picked time belong to one doctor/service/date
  // combination; anything fetched for another combination is ignored.
  const slotKey = `${doctorId}|${serviceId}|${date}`;
  const [slotState, setSlotState] = useState<{ key: string; slots: Slot[]; error: string | null } | null>(null);
  const [picked, setPicked] = useState<{ key: string; time: string } | null>(null);
  const slots = slotState?.key === slotKey ? slotState.slots : null;
  const slotError = slotState?.key === slotKey ? slotState.error : null;
  const time = picked?.key === slotKey ? picked.time : "";
  const setTime = (value: string) => setPicked({ key: slotKey, time: value });

  useEffect(() => {
    if (!doctorId || !serviceId || !date) return;
    let cancelled = false;
    getSlotsAction({ doctorId, serviceId, date }).then((result) => {
      if (cancelled) return;
      setSlotState(
        result.ok ? { key: slotKey, slots: result.data, error: null } : { key: slotKey, slots: [], error: result.error },
      );
    });
    return () => {
      cancelled = true;
    };
  }, [doctorId, serviceId, date, slotKey]);

  // Debounced patient search, driven by typing.
  const searchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  function onQueryChange(value: string) {
    setQuery(value);
    clearTimeout(searchTimer.current);
    if (value.trim().length < 2) {
      setResults([]);
      return;
    }
    searchTimer.current = setTimeout(async () => {
      setSearching(true);
      const result = await searchPatientsAction({ q: value });
      setSearching(false);
      setResults(result.ok ? result.data : []);
    }, 300);
  }

  if (doctors.length === 0 || services.length === 0) {
    return (
      <Panel>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Booking needs at least one doctor with a schedule and one bookable service. Ask your Clinic Admin to set them up
          under Administration.
        </p>
      </Panel>
    );
  }

  return (
    <ActionForm
      action={bookAppointmentAction}
      successMessage="Appointment booked"
      refresh={false}
      onSuccess={() => router.push(`/appointments?date=${date}`)}
      className="space-y-6"
    >
      <Panel title="Patient">
        {patient ? (
          <div className="flex items-center justify-between gap-4 rounded-2xl border border-(--accent-soft-border) bg-(--accent-soft)/50 p-4">
            <div className="flex items-center gap-3">
              <UserRound className="h-5 w-5 text-(--accent-text)" />
              <div>
                <p className="font-semibold text-zinc-900 dark:text-zinc-100">{patient.name}</p>
                <p className="text-sm text-zinc-500">
                  {patient.mrn} · {patient.age !== null ? `${patient.age} y` : "age unknown"} · {patient.mobile ?? "no mobile"}
                </p>
              </div>
            </div>
            <button type="button" onClick={() => setPatient(null)} className={buttonClass("ghost", "sm")} aria-label="Change patient">
              <X className="h-4 w-4" />
            </button>
            <input type="hidden" name="patientId" value={patient.id} />
          </div>
        ) : (
          <div className="space-y-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
              <input
                value={query}
                onChange={(e) => onQueryChange(e.target.value)}
                placeholder="Search by name, mobile or record number"
                aria-label="Find patient"
                className={cn(inputClass, "h-11 pl-11")}
              />
              {searching && <Loader2 className="absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-zinc-400" />}
            </div>
            {results.length > 0 && (
              <ul className="divide-y divide-zinc-100 rounded-2xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
                {results.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => setPatient(p)}
                      className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                    >
                      <span>
                        <span className="font-medium text-zinc-900 dark:text-zinc-100">{p.name}</span>
                        <span className="ml-2 font-mono text-xs text-zinc-500">{p.mrn}</span>
                      </span>
                      <span className="text-sm text-zinc-500">
                        {p.age !== null ? `${p.age} y` : "—"} · {p.mobile ?? "—"}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-sm text-zinc-500">
              New patient?{" "}
              <Link href="/patients/new" className="font-medium text-(--accent-text) hover:underline">
                Register them first
              </Link>
              .
            </p>
          </div>
        )}
      </Panel>

      <Panel title="Doctor, service and date">
        <div className="grid gap-4 sm:grid-cols-3">
          <label className="space-y-1.5">
            <span className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Doctor</span>
            <select name="doctorId" value={doctorId} onChange={(e) => setDoctorId(e.target.value)} className={cn(inputClass, "h-11")}>
              {doctors.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                  {d.specialty ? ` · ${d.specialty}` : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1.5">
            <span className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Service</span>
            <select name="serviceId" value={serviceId} onChange={(e) => setServiceId(e.target.value)} className={cn(inputClass, "h-11")}>
              {doctorServices.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.durationMinutes} min)
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1.5">
            <span className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Date</span>
            <input
              type="date"
              name="date"
              value={date}
              min={minDate}
              max={maxDate}
              onChange={(e) => setDate(e.target.value)}
              className={cn(inputClass, "h-11")}
            />
          </label>
        </div>
      </Panel>

      <Panel title="Time">
        <input type="hidden" name="time" value={time} />
        {slots === null ? (
          <p className="flex items-center gap-2 text-sm text-zinc-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading free slots...
          </p>
        ) : slots.length === 0 ? (
          <p className="text-sm text-zinc-500">{slotError ?? "No free slots that day. Try another date or doctor."}</p>
        ) : (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            {slots.map((slot) => (
              <button
                key={slot.time}
                type="button"
                onClick={() => setTime(slot.time)}
                aria-pressed={time === slot.time}
                className={cn(
                  "flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2.5 text-sm font-medium tabular-nums transition-colors",
                  time === slot.time
                    ? "border-(--accent-solid) bg-(--accent-soft) text-(--accent-text)"
                    : "border-zinc-200 hover:border-(--accent-soft-border) dark:border-zinc-800",
                )}
              >
                <Clock className="h-3.5 w-3.5" /> {slot.time}
              </button>
            ))}
          </div>
        )}
      </Panel>

      <Panel title="Notes">
        <Field label="Reason for visit (optional)" name="notes">
          <TextArea name="notes" rows={2} maxLength={1000} placeholder="e.g. Fever since 3 days" />
        </Field>
      </Panel>

      <div className="flex justify-end">
        {patient && time ? <SubmitButton size="lg">Book {time}</SubmitButton> : (
          <span className="text-sm text-zinc-500">{patient ? "Choose a time to book." : "Choose a patient to book."}</span>
        )}
      </div>
    </ActionForm>
  );
}
