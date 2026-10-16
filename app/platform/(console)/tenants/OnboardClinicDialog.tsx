"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Building2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ActionForm, Field, SelectInput, SubmitButton, TextInput } from "@/components/app/form";
import { OneTimeSecret } from "@/components/app/dialogs";
import { buttonClass } from "@/components/app/buttons";
import { onboardClinicAction } from "@/features/platform/platform.actions";

type PlanOption = { id: string; name: string };

type Created = { clinicCode: string; adminEmail: string; oneTimePassword: string; clinicId: string };

export default function OnboardClinicDialog({
  plans,
  timezones,
  defaultOpen,
  enabled,
}: {
  plans: PlanOption[];
  timezones: string[];
  defaultOpen: boolean;
  enabled: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(defaultOpen && enabled);
  const [planId, setPlanId] = useState("");
  const [created, setCreated] = useState<Created | null>(null);

  function close() {
    // The password stays on screen while the dialog animates out.
    setOpen(false);
    if (created) router.push(`/platform/tenants/${created.clinicId}`);
  }

  function reopen() {
    setCreated(null);
    setPlanId("");
    setOpen(true);
  }

  if (!enabled) {
    return (
      <button type="button" disabled className={buttonClass("primary", "md")} title="Provisioner connection not configured">
        <Building2 className="h-4 w-4" /> Onboarding switched off
      </button>
    );
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? reopen() : close())}>
      <DialogTrigger asChild>
        <button type="button" className={buttonClass("primary", "md")}>
          <Building2 className="h-4 w-4" /> Onboard a clinic
        </button>
      </DialogTrigger>
      <DialogContent className="max-h-[92vh] overflow-y-auto rounded-3xl sm:max-w-2xl" data-accent="platform">
        <DialogHeader>
          <DialogTitle className="text-xl">{created ? "Clinic created" : "Onboard a clinic"}</DialogTitle>
          <DialogDescription>
            {created
              ? `Give the administrator the clinic code "${created.clinicCode}", their email and this password.`
              : "Creates the clinic, its default roles and its first administrator."}
          </DialogDescription>
        </DialogHeader>

        {created ? (
          <div className="mt-2 space-y-4">
            <div className="grid gap-3 rounded-2xl border border-zinc-200 p-4 text-sm sm:grid-cols-2 dark:border-zinc-800">
              <div>
                <p className="text-xs uppercase tracking-wider text-zinc-500">Clinic code</p>
                <p className="mt-1 font-mono font-semibold">{created.clinicCode}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wider text-zinc-500">Administrator</p>
                <p className="mt-1 font-medium">{created.adminEmail}</p>
              </div>
            </div>
            <OneTimeSecret
              secret={created.oneTimePassword}
              label="This is the administrator's first password; they must change it when they sign in."
              onDone={close}
            />
          </div>
        ) : (
          <ActionForm action={onboardClinicAction} onSuccess={(data) => setCreated(data)} className="mt-2">
            <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500">Clinic</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Clinic name" name="name" required>
                <TextInput name="name" placeholder="Sunrise Family Clinic" required />
              </Field>
              <Field label="Clinic code" name="code" required hint="Staff type this at sign-in.">
                <TextInput name="code" placeholder="sunrise" autoCapitalize="none" required />
              </Field>
              <Field label="Plan" name="planId">
                <SelectInput
                  name="planId"
                  placeholder="No plan"
                  value={planId}
                  onChange={(e) => setPlanId(e.target.value)}
                  options={plans.map((p) => ({ value: p.id, label: p.name }))}
                />
              </Field>
              <Field label="Timezone" name="timezone" required>
                <SelectInput
                  name="timezone"
                  defaultValue="Asia/Kolkata"
                  options={timezones.map((tz) => ({ value: tz, label: tz }))}
                />
              </Field>
            </div>

            {!planId && (
              <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
                <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden />
                Without a plan every optional module is off. Staff will be told to contact their administrator when
                they reach those features.
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Contact name" name="contactName">
                <TextInput name="contactName" />
              </Field>
              <Field label="Contact email" name="contactEmail">
                <TextInput name="contactEmail" type="email" />
              </Field>
              <Field label="Contact phone" name="contactPhone">
                <TextInput name="contactPhone" type="tel" />
              </Field>
            </div>

            <p className="pt-2 text-xs font-semibold uppercase tracking-widest text-zinc-500">First administrator</p>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="First name" name="adminFirstName" required>
                <TextInput name="adminFirstName" required />
              </Field>
              <Field label="Last name" name="adminLastName" required>
                <TextInput name="adminLastName" required />
              </Field>
              <Field label="Email" name="adminEmail" required>
                <TextInput name="adminEmail" type="email" required />
              </Field>
            </div>

            <SubmitButton className="w-full" pendingLabel="Creating clinic...">
              Create clinic
            </SubmitButton>
          </ActionForm>
        )}
      </DialogContent>
    </Dialog>
  );
}
