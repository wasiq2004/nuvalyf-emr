"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { setRolePermissionAction } from "@/features/staff/staff.actions";

export function PermissionSwitch({
  roleId,
  permission,
  granted,
  label,
}: {
  roleId: string;
  permission: string;
  granted: boolean;
  label: string;
}) {
  const router = useRouter();
  const [checked, setChecked] = useState(granted);
  const [pending, setPending] = useState(false);
  const [, startTransition] = useTransition();

  async function toggle(next: boolean) {
    setChecked(next);
    setPending(true);
    const result = await setRolePermissionAction({ roleId, permission, granted: next });
    setPending(false);
    if (!result.ok) {
      setChecked(!next);
      toast.error(result.error);
      return;
    }
    toast.success(next ? `Granted: ${label}` : `Removed: ${label}`);
    startTransition(() => router.refresh());
  }

  return (
    <Switch
      checked={checked}
      onCheckedChange={toggle}
      disabled={pending}
      aria-label={`${label}: ${checked ? "granted" : "not granted"}`}
      className="data-[state=checked]:bg-(--accent-solid)"
    />
  );
}
