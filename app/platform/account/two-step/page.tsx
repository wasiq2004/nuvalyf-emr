import { AuthLayout, Notice } from "@/components/app/auth-layout";
import { requireOperator } from "@/lib/auth/platform-session";
import { withPlatform } from "@/lib/db";
import { operatorMfaStatus } from "@/features/platform/operator-mfa.service";
import { OperatorTwoStep } from "./OperatorTwoStep";

export const metadata = { title: "Two-step sign-in · Operations console" };

export default async function OperatorTwoStepPage() {
  const operator = await requireOperator({ allowPendingMfa: true });
  const status = await withPlatform((db) => operatorMfaStatus(db, operator.id));
  return (
    <AuthLayout
      accent="platform"
      badge="Operations console"
      heading={<>A code from your phone, as well as your password.</>}
      subheading="Operator accounts can suspend every clinic on the platform, so every operator uses two-step sign-in."
      title="Two-step sign-in"
      description={`Signed in as ${operator.email}`}
    >
      {operator.mustEnrollMfa && <Notice tone="info">Set up two-step sign-in to continue.</Notice>}
      {status.enabled && <Notice tone="info">On. {status.recoveryLeft} of 10 recovery codes left.</Notice>}
      <OperatorTwoStep enabled={status.enabled} />
    </AuthLayout>
  );
}
