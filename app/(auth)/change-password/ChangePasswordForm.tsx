"use client";

import { useRouter } from "next/navigation";
import { ActionForm, Field, SubmitButton, TextInput } from "@/components/app/form";
import { changeOwnPasswordAction } from "@/features/auth/auth.actions";

export default function ChangePasswordForm({ minLength }: { minLength: number }) {
  const router = useRouter();
  return (
    <ActionForm
      action={changeOwnPasswordAction}
      successMessage="Password updated"
      refresh={false}
      onSuccess={(data) => router.replace(data.home)}
    >
      <Field label="Current password" name="currentPassword" hint="The one-time password counts as your current password.">
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
