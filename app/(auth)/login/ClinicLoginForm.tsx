"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ActionForm, Field, SubmitButton, TextInput } from "@/components/app/form";
import { clinicSignInAction } from "@/features/auth/auth.actions";

export default function ClinicLoginForm() {
  const router = useRouter();
  // Shown once the password is accepted and the account uses two-step sign-in.
  const [needCode, setNeedCode] = useState(false);
  return (
    <ActionForm action={clinicSignInAction} refresh={false} onSuccess={() => router.replace("/")} onError={(_, fields) => fields.code && setNeedCode(true)}>
      <Field label="Clinic code" name="clinicCode">
        <TextInput name="clinicCode" autoComplete="organization" placeholder="e.g. sunrise-clinic" autoCapitalize="none" required />
      </Field>
      <Field label="Email" name="email">
        <TextInput name="email" type="email" autoComplete="email" placeholder="you@clinic.com" required />
      </Field>
      <Field label="Password" name="password">
        <TextInput name="password" type="password" autoComplete="current-password" required />
      </Field>
      {needCode && (
        <Field label="Code from your authenticator app" name="code" hint="6 digits, or one of your recovery codes">
          <TextInput name="code" inputMode="numeric" autoComplete="one-time-code" autoFocus required />
        </Field>
      )}
      <SubmitButton size="lg" className="w-full" pendingLabel="Signing in...">
        Sign in
      </SubmitButton>
    </ActionForm>
  );
}
