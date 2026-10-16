"use client";

import { Power, PowerOff } from "lucide-react";
import { ConfirmAction } from "@/components/app/dialogs";
import { setStaffStatusAction, updateStaffAction } from "@/features/staff/staff.actions";
import { StaffForm, type RoleOption, type StaffValues } from "../StaffForm";

export function EditStaffForm({ values, roleOptions }: { values: StaffValues; roleOptions: RoleOption[] }) {
  return (
    <StaffForm
      action={updateStaffAction}
      values={values}
      roleOptions={roleOptions}
      submitLabel="Save changes"
      successMessage="Staff member updated"
    />
  );
}

export function StaffStatusButton({ id, name, status }: { id: string; name: string; status: string }) {
  if (status === "active") {
    return (
      <ConfirmAction
        action={setStaffStatusAction}
        input={{ id, status: "disabled" }}
        trigger={
          <>
            <PowerOff className="h-4 w-4" /> Disable
          </>
        }
        variant="danger-outline"
        size="md"
        destructive
        title={`Disable ${name}?`}
        description="They are signed out everywhere immediately and cannot sign in until re-enabled. Their records stay."
        confirmLabel="Disable account"
        successMessage="Account disabled"
      />
    );
  }
  return (
    <ConfirmAction
      action={setStaffStatusAction}
      input={{ id, status: "active" }}
      trigger={
        <>
          <Power className="h-4 w-4" /> Enable
        </>
      }
      variant="secondary"
      size="md"
      title={`Enable ${name}?`}
      description="They can sign in again with their existing password."
      confirmLabel="Enable account"
      successMessage="Account enabled"
    />
  );
}
