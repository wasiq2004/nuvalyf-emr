"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus } from "lucide-react";

import { createDoctorAction } from "@/features/doctors/doctor.actions";
import { SPECIALIZATIONS } from "@/config/specializations";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface DepartmentItem {
  id: string;
  name: string;
}

const inputClass =
  "h-12 rounded-2xl border-zinc-200 dark:border-zinc-800 focus-visible:border-blue-600 focus-visible:ring-blue-600/30";
const selectClass =
  "h-12 w-full rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-4 text-base focus-visible:border-blue-600 focus-visible:ring-blue-600/30";

export default function CreateDoctorDialog({ departments }: { departments: DepartmentItem[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setPending(true);
    setError(null);

    const result = await createDoctorAction(null, new FormData(form));
    setPending(false);

    if (!result?.success) {
      setError(result?.error ?? "Failed to create doctor");
      return;
    }

    toast.success("Doctor account created", {
      description: "They can now sign in with the email and password you set.",
    });
    form.reset();
    setOpen(false);
    startTransition(() => router.refresh());
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setError(null);
      }}
    >
      <DialogTrigger asChild>
        <Button className="text-zinc-100 h-12 px-8 rounded-2xl bg-gradient-to-r from-blue-600 to-teal-600 hover:from-blue-700 hover:to-teal-700 shadow-lg shadow-blue-500/25 transition-all">
          <Plus className="mr-2 h-5 w-5" />
          Add New Doctor
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-lg rounded-3xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl">Add New Doctor</DialogTitle>
          <DialogDescription>
            Creates the doctor&apos;s login and profile. Share the password with them securely.
          </DialogDescription>
        </DialogHeader>

        {departments.length === 0 ? (
          <p className="text-sm text-amber-600 dark:text-amber-500 py-6">
            Create at least one department before adding doctors.
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5 mt-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="first_name">First Name</Label>
                <Input id="first_name" name="first_name" required maxLength={100} disabled={pending} className={inputClass} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="last_name">Last Name</Label>
                <Input id="last_name" name="last_name" required maxLength={100} disabled={pending} className={inputClass} />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">Email Address</Label>
              <Input
                id="email"
                name="email"
                type="email"
                placeholder="doctor@hospital.com"
                required
                disabled={pending}
                className={inputClass}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Initial Password</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="new-password"
                minLength={8}
                maxLength={72}
                required
                disabled={pending}
                className={inputClass}
              />
              <p className="text-xs text-zinc-500">At least 8 characters.</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="specialization">Specialization</Label>
                <select id="specialization" name="specialization" required disabled={pending} className={selectClass}>
                  <option value="">Select</option>
                  {SPECIALIZATIONS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="department_id">Department</Label>
                <select id="department_id" name="department_id" required disabled={pending} className={selectClass}>
                  <option value="">Select</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="license_number">License Number</Label>
                <Input
                  id="license_number"
                  name="license_number"
                  placeholder="LIC-12345"
                  required
                  maxLength={100}
                  disabled={pending}
                  className={inputClass}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="years_of_experience">Years of Experience</Label>
                <Input
                  id="years_of_experience"
                  name="years_of_experience"
                  type="number"
                  min={0}
                  max={70}
                  step={1}
                  placeholder="5"
                  required
                  disabled={pending}
                  className={inputClass}
                />
              </div>
            </div>

            {error && (
              <p role="alert" className="text-sm text-red-600 dark:text-red-400">
                {error}
              </p>
            )}

            <Button
              type="submit"
              disabled={pending}
              className="w-full text-zinc-100 h-12 rounded-2xl text-base font-semibold bg-gradient-to-r from-blue-600 to-teal-600 hover:from-blue-700 hover:to-teal-700 transition-all shadow-lg shadow-blue-500/25"
            >
              {pending ? "Creating Doctor..." : "Create Doctor"}
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
