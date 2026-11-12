"use client";

import { useRouter } from "next/navigation";
import { TwoStepSetup } from "@/components/auth/two-step-setup";
import { TwoStepManage } from "@/components/auth/two-step-manage";
import { beginOperatorMfaSetupAction, finishOperatorMfaSetupAction, newOperatorRecoveryCodesAction } from "@/features/platform/platform.actions";

export function OperatorTwoStep({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  if (!enabled) return <TwoStepSetup begin={beginOperatorMfaSetupAction} finish={finishOperatorMfaSetupAction} onDone={() => router.replace("/platform")} />;
  return <TwoStepManage renew={newOperatorRecoveryCodesAction} onChanged={() => router.refresh()} />;
}
