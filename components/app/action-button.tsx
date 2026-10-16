"use client";

// A button that runs a server action straight away (no confirmation), shows
// any error as a toast, and either refreshes the page or navigates to where
// the result points.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import type { ActionResult } from "@/lib/action-result";
import { buttonClass, type ButtonSize, type ButtonVariant } from "./buttons";

export function ActionButton<R>({
  action,
  input,
  children,
  variant = "secondary",
  size = "sm",
  successMessage,
  navigateTo,
  className,
  "aria-label": ariaLabel,
}: {
  action: (input: Record<string, unknown>) => Promise<ActionResult<R>>;
  input: Record<string, unknown>;
  children: React.ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  successMessage?: string;
  /** Where to go once it worked; otherwise the page refreshes. */
  navigateTo?: (data: R) => string;
  className?: string;
  "aria-label"?: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [, startTransition] = useTransition();

  async function run() {
    setPending(true);
    let result: ActionResult<R>;
    try {
      result = await action(input);
    } catch {
      result = { ok: false, error: "Could not reach the server. Check your connection and try again." };
    }
    if (!result.ok) {
      setPending(false);
      toast.error(result.error);
      return;
    }
    if (successMessage) toast.success(successMessage);
    if (navigateTo) {
      router.push(navigateTo(result.data));
      return;
    }
    setPending(false);
    startTransition(() => router.refresh());
  }

  return (
    <button type="button" onClick={run} disabled={pending} aria-label={ariaLabel} className={buttonClass(variant, size, className)}>
      {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}
