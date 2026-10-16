"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Plus, User, Clock, ArrowLeft, Search, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  bookAppointmentAction,
  getAvailableSlotsAction,
} from "@/features/appointments/appointment.actions";
import type { Slot } from "@/features/appointments/appointment.slots";

interface BookingDoctor {
  id: string;
  name: string;
  specialization: string;
  department: string;
  yearsOfExperience: number;
}

interface DepartmentItem {
  id: string;
  name: string;
}

type Props = {
  doctors: BookingDoctor[];
  departments: DepartmentItem[];
  /** Clinic-local "today", YYYY-MM-DD. */
  minDate: string;
  maxDate: string;
  defaultOpen?: boolean;
};

export default function BookAppointmentModal({
  doctors,
  departments,
  minDate,
  maxDate,
  defaultOpen = false,
}: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [open, setOpen] = useState(defaultOpen);
  const [step, setStep] = useState<1 | 2>(1);

  const [searchTerm, setSearchTerm] = useState("");
  const [selectedDepartment, setSelectedDepartment] = useState("all");
  const [selectedSpecialization, setSelectedSpecialization] = useState("all");

  const [selectedDoctor, setSelectedDoctor] = useState<BookingDoctor | null>(null);
  const [selectedDate, setSelectedDate] = useState(minDate);
  const [availableSlots, setAvailableSlots] = useState<Slot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState("");
  const [notes, setNotes] = useState("");
  const [booking, setBooking] = useState(false);

  const specializations = useMemo(
    () => [...new Set(doctors.map((d) => d.specialization))].sort(),
    [doctors],
  );

  const filteredDoctors = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return doctors.filter((doctor) => {
      const matchesSearch =
        !term ||
        doctor.name.toLowerCase().includes(term) ||
        doctor.specialization.toLowerCase().includes(term);
      const matchesDept =
        selectedDepartment === "all" || doctor.department === selectedDepartment;
      const matchesSpec =
        selectedSpecialization === "all" || doctor.specialization === selectedSpecialization;
      return matchesSearch && matchesDept && matchesSpec;
    });
  }, [doctors, searchTerm, selectedDepartment, selectedSpecialization]);

  function reset() {
    setStep(1);
    setSelectedDoctor(null);
    setSelectedDate(minDate);
    setAvailableSlots([]);
    setSelectedSlot("");
    setNotes("");
    setSearchTerm("");
    setSelectedDepartment("all");
    setSelectedSpecialization("all");
  }

  async function loadSlots(doctorId: string, date: string) {
    setSlotsLoading(true);
    setSelectedSlot("");
    const result = await getAvailableSlotsAction(doctorId, date);
    setSlotsLoading(false);

    if (!result.success) {
      toast.error(result.error);
      setAvailableSlots([]);
      return;
    }
    setAvailableSlots(result.slots);
  }

  async function handleDoctorSelect(doctor: BookingDoctor) {
    setSelectedDoctor(doctor);
    setStep(2);
    setSelectedDate(minDate);
    await loadSlots(doctor.id, minDate);
  }

  async function handleDateChange(e: React.ChangeEvent<HTMLInputElement>) {
    const date = e.target.value;
    setSelectedDate(date);
    if (selectedDoctor && date) await loadSlots(selectedDoctor.id, date);
  }

  async function handleConfirmBooking() {
    if (!selectedDoctor || !selectedSlot || !selectedDate) return;

    setBooking(true);
    const result = await bookAppointmentAction({
      doctorId: selectedDoctor.id,
      date: selectedDate,
      time: selectedSlot,
      notes: notes.trim() || undefined,
    });
    setBooking(false);

    if (!result.success) {
      toast.error(result.error);
      // The slot may have been taken in the meantime - show fresh availability.
      await loadSlots(selectedDoctor.id, selectedDate);
      return;
    }

    toast.success("Appointment booked! Your doctor will confirm it shortly.");
    setOpen(false);
    reset();
    startTransition(() => router.refresh());
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button className="text-zinc-100 h-12 px-8 rounded-2xl bg-gradient-to-r from-blue-600 to-teal-600 hover:from-blue-700 hover:to-teal-700 shadow-lg shadow-blue-500/25 transition-all">
          <Plus className="mr-2 h-5 w-5" />
          Book New Appointment
        </Button>
      </DialogTrigger>

      <DialogContent className="!max-w-3xl max-h-[92vh] flex flex-col p-0 overflow-hidden">
        <DialogHeader className="px-6 pt-6 pb-4 border-b">
          <DialogTitle className="flex items-center gap-3 text-xl">
            {step === 1 ? (
              "Find a Doctor"
            ) : (
              <>
                <button
                  type="button"
                  aria-label="Back to doctor list"
                  onClick={() => setStep(1)}
                  className="hover:text-teal-600"
                >
                  <ArrowLeft className="h-5 w-5" />
                </button>
                Book with Dr. {selectedDoctor?.name}
              </>
            )}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Choose a doctor, then pick a date and an available time slot.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-6">
          {step === 1 && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <Label htmlFor="doctor-search">Search Doctor</Label>
                  <div className="relative mt-1.5">
                    <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="doctor-search"
                      placeholder="Name or specialization..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="pl-10"
                    />
                  </div>
                </div>

                <div>
                  <Label>Department</Label>
                  <Select value={selectedDepartment} onValueChange={setSelectedDepartment}>
                    <SelectTrigger className="mt-1.5 w-full">
                      <SelectValue placeholder="All Departments" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Departments</SelectItem>
                      {departments.map((dept) => (
                        <SelectItem key={dept.id} value={dept.name}>
                          {dept.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label>Specialization</Label>
                  <Select value={selectedSpecialization} onValueChange={setSelectedSpecialization}>
                    <SelectTrigger className="mt-1.5 w-full">
                      <SelectValue placeholder="All Specializations" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Specializations</SelectItem>
                      {specializations.map((spec) => (
                        <SelectItem key={spec} value={spec}>
                          {spec}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {filteredDoctors.length > 0 ? (
                  filteredDoctors.map((doctor) => (
                    <Card
                      key={doctor.id}
                      role="button"
                      tabIndex={0}
                      className="cursor-pointer hover:border-teal-500 hover:shadow-md transition-all"
                      onClick={() => handleDoctorSelect(doctor)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          handleDoctorSelect(doctor);
                        }
                      }}
                    >
                      <CardContent className="p-5">
                        <div className="flex items-start gap-4">
                          <div className="bg-blue-100 dark:bg-blue-900/30 p-3 rounded-2xl">
                            <User className="h-8 w-8 text-blue-600 dark:text-blue-400" />
                          </div>
                          <div className="flex-1">
                            <p className="font-semibold text-lg">Dr. {doctor.name}</p>
                            <p className="text-blue-600 dark:text-blue-400 font-medium">
                              {doctor.specialization}
                            </p>
                            <p className="text-sm text-muted-foreground mt-2">
                              {doctor.department} • {doctor.yearsOfExperience} years
                            </p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))
                ) : (
                  <p className="col-span-full text-center text-muted-foreground py-12">
                    {doctors.length === 0
                      ? "No doctors are available for booking yet."
                      : "No doctors match your filters"}
                  </p>
                )}
              </div>
            </div>
          )}

          {step === 2 && selectedDoctor && (
            <div className="space-y-8">
              <div>
                <Label htmlFor="booking-date">Select Date</Label>
                <input
                  id="booking-date"
                  type="date"
                  value={selectedDate}
                  onChange={handleDateChange}
                  min={minDate}
                  max={maxDate}
                  className="w-full mt-2 p-4 border border-input rounded-2xl focus:outline-none focus:border-blue-500 bg-background"
                />
              </div>

              <div>
                <Label className="mb-3 block">Available Slots</Label>
                {slotsLoading ? (
                  <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading slots...
                  </div>
                ) : availableSlots.length > 0 ? (
                  <div className="grid grid-cols-4 sm:grid-cols-6 gap-3 max-h-80 overflow-y-auto pr-2">
                    {availableSlots.map((slot) => (
                      <button
                        key={slot.time}
                        type="button"
                        onClick={() => setSelectedSlot(slot.time)}
                        aria-pressed={selectedSlot === slot.time}
                        className={`p-4 border rounded-2xl text-center transition-all flex flex-col items-center gap-1 ${
                          selectedSlot === slot.time
                            ? "border-blue-500 bg-blue-200/10 text-blue-500"
                            : "hover:border-blue-400"
                        }`}
                      >
                        <Clock className="h-5 w-5" />
                        <span className="font-medium text-sm">{slot.time}</span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="text-muted-foreground py-12 text-center">
                    No slots available on this date. Try another day.
                  </p>
                )}
              </div>

              <div>
                <Label htmlFor="booking-notes">Additional Notes (optional)</Label>
                <Textarea
                  id="booking-notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Any symptoms or special requests..."
                  className="mt-2"
                  rows={3}
                  maxLength={1000}
                />
              </div>
            </div>
          )}
        </div>

        {step === 2 && (
          <div className="p-6 border-t bg-background flex gap-3">
            <Button
              variant="outline"
              className="flex-1 dark:text-zinc-100 h-12 px-8 rounded-md transition-all"
              onClick={() => setStep(1)}
            >
              Back
            </Button>
            <Button
              onClick={handleConfirmBooking}
              disabled={!selectedSlot || booking}
              className="flex-1 text-zinc-100 h-12 px-8 rounded-md bg-gradient-to-r from-blue-600 to-teal-600 hover:from-blue-700 hover:to-teal-700 shadow-lg shadow-blue-500/25 transition-all"
            >
              {booking ? "Booking..." : "Confirm & Book Appointment"}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
