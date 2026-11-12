"use client";

import { useRouter } from "next/navigation";
import { TwoStepSetup } from "@/components/auth/two-step-setup";
import { TwoStepManage } from "@/components/auth/two-step-manage";
import { beginMfaSetupAction, finishMfaSetupAction, newMfaRecoveryCodesAction, turnOffMfaAction } from "@/features/auth/auth.actions";

export function ClinicTwoStep({ enabled, required, home }: { enabled: boolean; required: boolean; home: string }) {
  const router = useRouter();
  if (!enabled) return <TwoStepSetup begin={beginMfaSetupAction} finish={finishMfaSetupAction} onDone={() => router.replace(home)} />;
  return <TwoStepManage renew={newMfaRecoveryCodesAction} turnOff={required ? undefined : turnOffMfaAction} onChanged={() => router.refresh()} />;
}
