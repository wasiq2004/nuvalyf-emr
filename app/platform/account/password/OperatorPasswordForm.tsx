"use client";

import { useRouter } from "next/navigation";
import { ActionForm, Field, SubmitButton, TextInput } from "@/components/app/form";
import { changeOperatorPasswordAction } from "@/features/platform/platform.actions";

export default function OperatorPasswordForm({ minLength }: { minLength: number }) {
  const router = useRouter();
  return (
    <ActionForm
      action={changeOperatorPasswordAction}
      successMessage="Password updated"
      refresh={false}
      onSuccess={() => router.replace("/platform")}
    >
      <Field label="Current password" name="currentPassword">
        <TextInput name="currentPassword" type="password" autoComplete="current-password" required />
      </Field>
      <Field label="New password" name="newPassword" hint={`At least ${minLength} characters.`}>
        <TextInput name="newPassword" type="password" autoComplete="new-password" minLength={minLength} required />
      </Field>
      <Field label="Confirm new password" name="confirmPassword">
        <TextInput name="confirmPassword" type="password" autoComplete="new-password" required />
      </Field>
      <SubmitButton size="lg" className="w-full" pendingLabel="Updating...">
        Save password
      </SubmitButton>
    </ActionForm>
  );
}
