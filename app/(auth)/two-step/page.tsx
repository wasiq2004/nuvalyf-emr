import { AuthLayout, Notice } from "@/components/app/auth-layout";
import { requireClinic } from "@/lib/auth/clinic-session";
import { withClinic } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { clinicMfaRequired } from "@/features/auth/mfa";
import { mfaStatus } from "@/features/auth/mfa.service";
import { ClinicTwoStep } from "./ClinicTwoStep";

export const metadata = { title: "Two-step sign-in" };

export default async function TwoStepPage() {
  const ctx = await requireClinic({ allowPendingMfa: true });
  const status = await withClinic({ clinicId: ctx.clinicId, userId: ctx.userId }, (tx) => mfaStatus(tx, ctx.userId));
  const required = clinicMfaRequired(ctx.roleKeys);

  return (
    <AuthLayout
      accent="clinic"
      badge={ctx.clinicName}
      heading={<>A code from your phone, as well as your password.</>}
      subheading="Someone who learns your password still cannot sign in without your phone."
      title="Two-step sign-in"
      description={`Signed in as ${ctx.email}`}
    >
      {ctx.mustEnrollMfa && <Notice tone="info">Your role can see every patient&apos;s record and change who has access, so two-step sign-in is required. Set it up to continue.</Notice>}
      {status.enabled && (
        <Notice tone="info">
          On since {formatDateTime(status.enabledAt!, ctx.timezone)}. {status.recoveryLeft} of 10 recovery codes left.
        </Notice>
      )}
      <ClinicTwoStep enabled={status.enabled} required={required} home={ctx.home} />
    </AuthLayout>
  );
}
