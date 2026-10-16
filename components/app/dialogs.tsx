"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Copy, KeyRound, Loader2 } from "lucide-react";
import type { ActionResult } from "@/lib/action-result";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { buttonClass, type ButtonVariant, type ButtonSize } from "./buttons";
import { cn } from "@/lib/utils";

/** A button that asks for confirmation, then calls a server action. */
export function ConfirmAction<R>({
  action,
  input,
  trigger,
  title,
  description,
  confirmLabel = "Confirm",
  successMessage,
  onSuccess,
  variant = "secondary",
  size = "sm",
  destructive = false,
}: {
  action: (input: Record<string, unknown>) => Promise<ActionResult<R>>;
  input: Record<string, unknown>;
  trigger: React.ReactNode;
  title: string;
  description: React.ReactNode;
  confirmLabel?: string;
  successMessage?: string;
  onSuccess?: (data: R) => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  destructive?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [, startTransition] = useTransition();

  async function run() {
    setPending(true);
    const result = await action(input);
    setPending(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    setOpen(false);
    if (successMessage) toast.success(successMessage);
    onSuccess?.(result.data);
    startTransition(() => router.refresh());
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <button type="button" className={buttonClass(variant, size)}>
          {trigger}
        </button>
      </AlertDialogTrigger>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="text-sm text-zinc-600 dark:text-zinc-400">{description}</div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <button
            type="button"
            onClick={run}
            disabled={pending}
            className={buttonClass(destructive ? "danger" : "primary", "md")}
          >
            {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {confirmLabel}
          </button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** A dialog wrapping a form; `children` receives a close() callback. */
export function FormDialog({
  trigger,
  title,
  description,
  children,
  variant = "primary",
  size = "md",
  wide = false,
}: {
  trigger: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  children: (close: () => void) => React.ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  wide?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button type="button" className={buttonClass(variant, size)}>
          {trigger}
        </button>
      </DialogTrigger>
      <DialogContent className={cn("max-h-[92vh] overflow-y-auto rounded-3xl", wide ? "sm:max-w-2xl" : "sm:max-w-lg")}>
        <DialogHeader>
          <DialogTitle className="text-xl">{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <div className="mt-2">{children(() => setOpen(false))}</div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Shows a generated password exactly once. It is never stored in plain text,
 * so closing this is the last chance to copy it.
 */
export function OneTimeSecret({
  secret,
  label,
  onDone,
}: {
  secret: string;
  label: string;
  onDone?: () => void;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
      toast.success("Copied to clipboard");
    } catch {
      toast.error("Copy failed. Select the password and copy it manually.");
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
        <p className="flex items-center gap-2 font-semibold">
          <KeyRound className="h-4 w-4" aria-hidden /> Shown once
        </p>
        <p className="mt-1">
          {label} It cannot be shown again or recovered. If it is lost, issue a new one.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <code className="flex-1 select-all rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 font-mono text-lg tracking-wider text-zinc-900 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100">
          {secret}
        </code>
        <button type="button" onClick={copy} className={buttonClass("secondary", "lg")} aria-label="Copy password">
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        </button>
      </div>
      {onDone && (
        <button type="button" onClick={onDone} className={buttonClass("primary", "md", "w-full")}>
          I have saved it
        </button>
      )}
    </div>
  );
}
