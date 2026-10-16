import { AuthLayout, Notice } from "@/components/app/auth-layout";
import { requireOperator } from "@/lib/auth/platform-session";
import { OPERATOR_PASSWORD_MIN } from "@/lib/auth/passwords";
import OperatorPasswordForm from "./OperatorPasswordForm";

export const metadata = { title: "Change password · Operations console" };

export default async function OperatorPasswordPage() {
  const operator = await requireOperator({ allowPendingPasswordChange: true });
  return (
    <AuthLayout
      accent="platform"
      badge="Operations console"
      heading={<>Set your own password.</>}
      subheading="Operator accounts can suspend every clinic on the platform. Use a long, unique password."
      title={operator.mustChangePassword ? "Choose a new password" : "Change password"}
      description={`Signed in as ${operator.email}`}
    >
      {operator.mustChangePassword && (
        <Notice tone="info">You signed in with a one-time password. Set your own to continue.</Notice>
      )}
      <OperatorPasswordForm minLength={OPERATOR_PASSWORD_MIN} />
    </AuthLayout>
  );
}
