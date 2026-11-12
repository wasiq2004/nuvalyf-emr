"use client";

// Once two-step sign-in is on: new recovery codes, or switching it off where
// the role allows. Both need a current code.
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { buttonClass } from "@/components/app/buttons";
import { inputClass } from "@/components/app/form";
import type { ActionResult } from "@/lib/action-result";
import { cn } from "@/lib/utils";
import { RecoveryCodes } from "./two-step-setup";

type WithCode<R> = (input: { code: string }) => Promise<ActionResult<R>>;

export function TwoStepManage({ renew, turnOff, onChanged }: { renew: WithCode<{ recoveryCodes: string[] }>; turnOff?: WithCode<unknown>; onChanged: () => void }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<"renew" | "off" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);

  if (codes) return <RecoveryCodes codes={codes} onDone={() => (setCodes(null), onChanged())} />;

  const run = async (which: "renew" | "off") => {
    setBusy(which);
    setError(null);
    const result = which === "renew" ? await renew({ code }) : await turnOff!({ code });
    setBusy(null);
    setCode("");
    if (!result.ok) return setError(result.fieldErrors?.code ?? result.error);
    if (which === "renew") setCodes((result.data as { recoveryCodes: string[] }).recoveryCodes);
    else onChanged();
  };

  return (
    <div className="space-y-4">
      <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300" htmlFor="manage-code">
        Current code from your authenticator app
      </label>
      <input id="manage-code" inputMode="numeric" autoComplete="one-time-code" maxLength={12} value={code} onChange={(e) => setCode(e.target.value)} className={cn(inputClass, "h-11 font-mono tracking-widest")} />
      {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy !== null || code.trim().length < 6} onClick={() => run("renew")} className={buttonClass("secondary", "md")}>
          {busy === "renew" && <Loader2 className="h-4 w-4 animate-spin" />} New recovery codes
        </button>
        {turnOff && (
          <button type="button" disabled={busy !== null || code.trim().length < 6} onClick={() => run("off")} className={buttonClass("ghost", "md")}>
            {busy === "off" && <Loader2 className="h-4 w-4 animate-spin" />} Turn off
          </button>
        )}
      </div>
    </div>
  );
}
