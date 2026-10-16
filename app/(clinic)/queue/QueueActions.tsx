"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, DoorOpen } from "lucide-react";
import { ConfirmAction } from "@/components/app/dialogs";
import { buttonClass } from "@/components/app/buttons";
import { markLeftAction, moveInQueueAction } from "@/features/queue/queue.actions";

export function QueueRowActions({
  visitId,
  patientName,
  canMoveUp,
  canMoveDown,
  canMarkLeft,
}: {
  visitId: string;
  patientName: string;
  canMoveUp: boolean;
  canMoveDown: boolean;
  canMarkLeft: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [, startTransition] = useTransition();

  async function move(direction: "up" | "down") {
    setPending(true);
    const result = await moveInQueueAction({ visitId, direction });
    setPending(false);
    if (!result.ok) toast.error(result.error);
    startTransition(() => router.refresh());
  }

  return (
    <div className="flex gap-1">
      <button
        type="button"
        onClick={() => move("up")}
        disabled={!canMoveUp || pending}
        className={buttonClass("ghost", "sm", "px-2")}
        aria-label={`Move ${patientName} up`}
      >
        <ArrowUp className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => move("down")}
        disabled={!canMoveDown || pending}
        className={buttonClass("ghost", "sm", "px-2")}
        aria-label={`Move ${patientName} down`}
      >
        <ArrowDown className="h-4 w-4" />
      </button>
      {canMarkLeft && (
        <ConfirmAction
          action={markLeftAction}
          input={{ visitId }}
          variant="ghost"
          trigger={<DoorOpen className="h-4 w-4" aria-label={`${patientName} left`} />}
          title={`Did ${patientName} leave without being seen?`}
          description="Removes them from today's queue and records it on their history."
          confirmLabel="Mark as left"
          successMessage="Removed from the queue"
        />
      )}
    </div>
  );
}
