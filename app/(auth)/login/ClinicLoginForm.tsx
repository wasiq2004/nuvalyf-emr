"use client";

import { useRouter } from "next/navigation";
import { ActionForm, Field, SubmitButton, TextInput } from "@/components/app/form";
import { clinicSignInAction } from "@/features/auth/auth.actions";

export default function ClinicLoginForm() {
  const router = useRouter();
  return (
    <ActionForm action={clinicSignInAction} refresh={false} onSuccess={() => router.replace("/")}>
      <Field label="Clinic code" name="clinicCode">
        <TextInput name="clinicCode" autoComplete="organization" placeholder="e.g. sunrise-clinic" autoCapitalize="none" required />
      </Field>
      <Field label="Email" name="email">
        <TextInput name="email" type="email" autoComplete="email" placeholder="you@clinic.com" required />
      </Field>
      <Field label="Password" name="password">
        <TextInput name="password" type="password" autoComplete="current-password" required />
      </Field>
      <SubmitButton size="lg" className="w-full" pendingLabel="Signing in...">
        Sign in
      </SubmitButton>
    </ActionForm>
  );
}
