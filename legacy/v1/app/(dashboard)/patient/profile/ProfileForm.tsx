"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Save } from "lucide-react";

import { updatePatientProfileAction } from "@/features/patients/patient.actions";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type ProfileValues = {
  first_name: string;
  last_name: string;
  gender: string;
  contact_number: string;
  address: string;
};

const inputClass =
  "h-12 rounded-2xl border-zinc-200 dark:border-zinc-800 focus-visible:border-blue-600 focus-visible:ring-blue-600/30";

export default function ProfileForm({ email, initial }: { email: string; initial: ProfileValues }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);

    const result = await updatePatientProfileAction(new FormData(e.currentTarget));
    setPending(false);

    if (!result.success) {
      setError(result.error);
      return;
    }
    toast.success("Profile saved");
    startTransition(() => router.refresh());
  }

  return (
    <Card className="border-0 shadow-2xl bg-white/95 dark:bg-zinc-900/95 backdrop-blur-2xl rounded-3xl">
      <CardContent className="p-8 lg:p-10">
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" value={email} disabled readOnly className={inputClass} />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <Label htmlFor="first_name">First Name</Label>
              <Input
                id="first_name"
                name="first_name"
                defaultValue={initial.first_name}
                required
                maxLength={100}
                disabled={pending}
                className={inputClass}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="last_name">Last Name</Label>
              <Input
                id="last_name"
                name="last_name"
                defaultValue={initial.last_name}
                required
                maxLength={100}
                disabled={pending}
                className={inputClass}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <Label htmlFor="gender">Gender</Label>
              <select
                id="gender"
                name="gender"
                defaultValue={initial.gender}
                required
                disabled={pending}
                className="h-12 w-full rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-4 text-base"
              >
                <option value="">Select gender</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="contact_number">Contact Number</Label>
              <Input
                id="contact_number"
                name="contact_number"
                type="tel"
                defaultValue={initial.contact_number}
                placeholder="+91 98765 43210"
                required
                disabled={pending}
                className={inputClass}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="address">
              Address <span className="text-xs text-zinc-500 font-normal">(optional)</span>
            </Label>
            <Textarea
              id="address"
              name="address"
              defaultValue={initial.address}
              rows={3}
              maxLength={500}
              disabled={pending}
              className="rounded-2xl"
            />
          </div>

          {error && (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {error}
            </p>
          )}

          <Button
            type="submit"
            disabled={pending}
            className="w-full h-12 rounded-2xl text-base font-semibold text-zinc-100 bg-gradient-to-r from-blue-600 to-teal-600 hover:from-blue-700 hover:to-teal-700 shadow-lg shadow-blue-500/25"
          >
            <Save className="mr-2 h-4 w-4" />
            {pending ? "Saving..." : "Save Profile"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
