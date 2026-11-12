"use client";

// Setting up two-step sign-in: show the key (and a link that opens the
// authenticator app on a phone), take one code to prove it was added, then
// show the recovery codes once.
import { useState } from "react";
import { toast } from "sonner";
import { Copy, Download, Loader2, ShieldCheck, Smartphone } from "lucide-react";
import { buttonClass } from "@/components/app/buttons";
import { inputClass } from "@/components/app/form";
import type { ActionResult } from "@/lib/action-result";
import { cn } from "@/lib/utils";

type Begin = (input: Record<string, never>) => Promise<ActionResult<{ secret: string; uri: string }>>;
type Finish = (input: { code: string }) => Promise<ActionResult<{ recoveryCodes: string[] }>>;

const grouped = (secret: string) => secret.match(/.{1,4}/g)?.join(" ") ?? secret;

export function RecoveryCodes({ codes, onDone, doneLabel = "I have saved them" }: { codes: string[]; onDone: () => void; doneLabel?: string }) {
  const text = codes.join("\n");
  const [saved, setSaved] = useState(false);
  return (
    <div className="space-y-4">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        <strong>Shown once.</strong> Each code signs you in once if your phone is lost. Keep them somewhere safe, away from your phone.
      </p>
      <ul className="grid grid-cols-2 gap-2 rounded-2xl border border-zinc-200 bg-zinc-50 p-4 font-mono text-sm dark:border-zinc-800 dark:bg-zinc-900">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={buttonClass("secondary", "sm")}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(text);
              toast.success("Copied");
            } catch {
              toast.error("Copy failed: select the codes and copy them.");
            }
          }}
        >
          <Copy className="h-4 w-4" /> Copy
        </button>
        <a className={buttonClass("secondary", "sm")} href={`data:text/plain;charset=utf-8,${encodeURIComponent(`NuvaLyf recovery codes\n\n${text}\n`)}`} download="nuvalyf-recovery-codes.txt">
          <Download className="h-4 w-4" /> Download
        </a>
      </div>
      <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} className="h-4 w-4 accent-(--accent)" /> I have saved these codes
      </label>
      <button type="button" disabled={!saved} onClick={onDone} className={buttonClass("primary", "lg", "w-full")}>
        {doneLabel}
      </button>
    </div>
  );
}

export function TwoStepSetup({ begin, finish, onDone }: { begin: Begin; finish: Finish; onDone: () => void }) {
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null);
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (codes) return <RecoveryCodes codes={codes} onDone={onDone} doneLabel="Continue" />;

  if (!setup) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          You will need an authenticator app on your phone: Google Authenticator, Microsoft Authenticator or similar. Each time you sign in, you enter the 6-digit code it shows.
        </p>
        {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <button
          type="button"
          disabled={busy}
          className={buttonClass("primary", "lg", "w-full")}
          onClick={async () => {
            setBusy(true);
            setError(null);
            const result = await begin({});
            setBusy(false);
            if (!result.ok) return setError(result.error);
            setSetup(result.data);
          }}
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" />} <Smartphone className="h-4 w-4" /> Set up two-step sign-in
        </button>
      </div>
    );
  }

  return (
    <form
      className="space-y-5"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        const result = await finish({ code });
        setBusy(false);
        if (!result.ok) return setError(result.fieldErrors?.code ?? result.error);
        setCodes(result.data.recoveryCodes);
      }}
    >
      <ol className="space-y-4 text-sm text-zinc-700 dark:text-zinc-300">
        <li>
          <p className="font-medium">1. In your authenticator app, add an account and choose &ldquo;Enter a setup key&rdquo;. Type this key:</p>
          <p className="mt-2 select-all rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-center font-mono text-base tracking-wider dark:border-zinc-800 dark:bg-zinc-900" aria-label="Setup key">
            {grouped(setup.secret)}
          </p>
          <p className="mt-2 text-xs text-zinc-500">
            On this phone? <a href={setup.uri} className="font-medium text-(--accent-text) hover:underline">Open it in the authenticator app</a>. The key is time-based, 6 digits.
          </p>
        </li>
        <li>
          <label className="block font-medium" htmlFor="two-step-code">
            2. Enter the 6-digit code it now shows
          </label>
          <input
            id="two-step-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={7}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className={cn(inputClass, "mt-2 h-12 text-center font-mono text-xl tracking-[0.4em]")}
          />
        </li>
      </ol>
      {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      <button type="submit" disabled={busy || code.replace(/\D/g, "").length !== 6} className={buttonClass("primary", "lg", "w-full")}>
        {busy && <Loader2 className="h-4 w-4 animate-spin" />} <ShieldCheck className="h-4 w-4" /> Turn on two-step sign-in
      </button>
    </form>
  );
}
