"use client";

// WhatsApp consent on the patient record: current state per type, with the
// history underneath. Granting or withdrawing is one click and is audited.
import { BellRing, Megaphone } from "lucide-react";
import { ActionButton } from "@/components/app/action-button";
import { StatusBadge } from "@/components/app/status-badge";
import { setConsentAction } from "@/features/messaging/messaging.actions";
import { CONSENT_LABELS, CONSENT_TYPES, type ConsentType } from "@/features/messaging/messaging-rules";

const ICON: Record<ConsentType, typeof BellRing> = { whatsapp_reminders: BellRing, whatsapp_broadcasts: Megaphone };

export function ConsentControls({
  patientId,
  current,
  canWrite,
  hasMobile,
}: {
  patientId: string;
  current: Record<ConsentType, boolean>;
  canWrite: boolean;
  hasMobile: boolean;
}) {
  return (
    <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
      {CONSENT_TYPES.map((type) => {
        const Icon = ICON[type];
        const granted = current[type];
        return (
          <li key={type} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
            <span className="flex items-center gap-3 text-sm text-zinc-800 dark:text-zinc-200">
              <Icon className="h-4 w-4 text-(--accent-text)" aria-hidden />
              {CONSENT_LABELS[type]}
            </span>
            <span className="flex items-center gap-2">
              <StatusBadge tone={granted ? "success" : "neutral"}>{granted ? "Agreed" : "Not agreed"}</StatusBadge>
              {canWrite &&
                (granted ? (
                  <ActionButton action={setConsentAction} input={{ patientId, type, granted: false }} variant="ghost" successMessage="Consent withdrawn">
                    Withdraw
                  </ActionButton>
                ) : (
                  hasMobile && (
                    <ActionButton action={setConsentAction} input={{ patientId, type, granted: true }} successMessage="Consent recorded">
                      Patient agrees
                    </ActionButton>
                  )
                ))}
            </span>
          </li>
        );
      })}
      {!hasMobile && <li className="pt-3 text-xs text-zinc-500">Add a mobile number to record WhatsApp consent.</li>}
    </ul>
  );
}
