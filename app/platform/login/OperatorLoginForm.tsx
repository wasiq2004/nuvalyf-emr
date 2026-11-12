"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ActionForm, Field, SubmitButton, TextInput } from "@/components/app/form";
import { operatorSignInAction } from "@/features/platform/platform.actions";

export default function OperatorLoginForm() {
  const router = useRouter();
  const [needCode, setNeedCode] = useState(false);
  return (
    <ActionForm action={operatorSignInAction} refresh={false} onSuccess={() => router.replace("/platform")} onError={(_, fields) => fields.code && setNeedCode(true)}>
      <Field label="Email" name="email">
        <TextInput name="email" type="email" autoComplete="username" required />
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
        Sign in to console
      </SubmitButton>
    </ActionForm>
  );
}
