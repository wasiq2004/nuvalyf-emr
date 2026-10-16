"use client";

import { useRouter } from "next/navigation";
import { ActionForm, Field, SubmitButton, TextInput } from "@/components/app/form";
import { operatorSignInAction } from "@/features/platform/platform.actions";

export default function OperatorLoginForm() {
  const router = useRouter();
  return (
    <ActionForm action={operatorSignInAction} refresh={false} onSuccess={() => router.replace("/platform")}>
      <Field label="Email" name="email">
        <TextInput name="email" type="email" autoComplete="username" required />
      </Field>
      <Field label="Password" name="password">
        <TextInput name="password" type="password" autoComplete="current-password" required />
      </Field>
      <SubmitButton size="lg" className="w-full" pendingLabel="Signing in...">
        Sign in to console
      </SubmitButton>
    </ActionForm>
  );
}
