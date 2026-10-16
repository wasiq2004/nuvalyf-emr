import { AuthLayout, Notice } from "@/components/app/auth-layout";
import { requireClinic } from "@/lib/auth/clinic-session";
import { STAFF_PASSWORD_MIN } from "@/lib/auth/passwords";
import ChangePasswordForm from "./ChangePasswordForm";

export const metadata = { title: "Change password" };

export default async function ChangePasswordPage() {
  const ctx = await requireClinic({ allowPendingPasswordChange: true });

  return (
    <AuthLayout
      accent="clinic"
      badge={ctx.clinicName}
      heading={<>Set your own password.</>}
      subheading="Passwords issued by an administrator are single-use. Choose one only you know."
      title={ctx.mustChangePassword ? "Choose a new password" : "Change password"}
      description={`Signed in as ${ctx.email}`}
    >
      {ctx.mustChangePassword && (
        <Notice tone="info">You signed in with a one-time password. Set your own to continue.</Notice>
      )}
      <ChangePasswordForm minLength={STAFF_PASSWORD_MIN} />
    </AuthLayout>
  );
}
