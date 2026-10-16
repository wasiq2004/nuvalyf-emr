"use client";

// Compose a broadcast: pick an approved template and an audience, see exactly
// how many patients will receive it and how many are left out (and why)
// before anything is sent.
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Send, UsersRound } from "lucide-react";
import { inputClass } from "@/components/app/form";
import { buttonClass } from "@/components/app/buttons";
import { createBroadcastAction, previewAudienceAction } from "@/features/messaging/messaging.actions";
import { cn } from "@/lib/utils";

type Preview = { matched: number; recipients: number; noConsent: number; noMobile: number };

export function BroadcastComposer({ templates }: { templates: { id: string; name: string; preview: string }[] }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<"all" | "seen_within_days">("all");
  const [days, setDays] = useState("180");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);

  const audience = kind === "all" ? { kind } : { kind, days: Number(days) || 1 };
  const audienceKey = JSON.stringify(audience);

  useEffect(() => {
    let cancelled = false;
    previewAudienceAction({ audience: JSON.parse(audienceKey) }).then((result) => {
      if (cancelled) return;
      if (result.ok) setPreview(result.data);
      else toast.error(result.error);
    });
    return () => {
      cancelled = true;
    };
  }, [audienceKey]);

  async function send() {
    setPending(true);
    const result = await createBroadcastAction({ templateId, title, audience, idempotencyKey: key });
    setPending(false);
    setConfirming(false);
    if (!result.ok) return toast.error(result.fieldErrors ? Object.values(result.fieldErrors)[0] : result.error);
    toast.success(`Queued for ${result.data.recipients} patients. Sending starts within a minute.`);
    setTitle("");
    setKey(crypto.randomUUID());
    startTransition(() => router.refresh());
  }

  const template = templates.find((t) => t.id === templateId);
  const label = "block text-sm font-medium text-zinc-700 dark:text-zinc-300";

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-5">
        <label className={label}>
          Title (for your records)
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Monsoon health camp" className={cn(inputClass, "mt-1.5 h-11")} />
        </label>
        <label className={label}>
          Template
          <select value={templateId} onChange={(e) => setTemplateId(e.target.value)} className={cn(inputClass, "mt-1.5 h-11")}>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <fieldset className="space-y-2">
          <legend className={label}>Audience</legend>
          <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
            <input type="radio" name="kind" checked={kind === "all"} onChange={() => setKind("all")} className="accent-(--accent-solid)" /> Every patient
          </label>
          <label className="flex flex-wrap items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
            <input type="radio" name="kind" checked={kind === "seen_within_days"} onChange={() => setKind("seen_within_days")} className="accent-(--accent-solid)" />
            Patients seen in the last
            <input
              type="number"
              min={1}
              max={3650}
              value={days}
              onChange={(e) => {
                setKind("seen_within_days");
                setDays(e.target.value);
              }}
              aria-label="Days"
              className={cn(inputClass, "h-9 w-24")}
            />
            days
          </label>
        </fieldset>
      </div>

      <div className="space-y-4 rounded-2xl border border-zinc-200 p-5 dark:border-zinc-800">
        <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Message</p>
        <p className="whitespace-pre-wrap rounded-xl bg-emerald-50 p-4 text-sm text-zinc-800 dark:bg-emerald-950/30 dark:text-zinc-200">
          {template?.preview.replace("{{1}}", "Asha") ?? "Choose a template"}
        </p>
        {preview ? (
          <dl className="grid grid-cols-2 gap-3 text-sm" aria-label="Audience">
            <div className="col-span-2 flex items-center gap-2 rounded-xl border border-(--accent-soft-border) bg-(--accent-soft) p-3">
              <UsersRound className="h-5 w-5 text-(--accent-text)" />
              <dt className="sr-only">Will receive it</dt>
              <dd>
                <span className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">{preview.recipients}</span> will receive it
              </dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-500">Left out: no consent</dt>
              <dd className="font-semibold">{preview.noConsent}</dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-500">Left out: no mobile</dt>
              <dd className="font-semibold">{preview.noMobile}</dd>
            </div>
          </dl>
        ) : (
          <p className="text-sm text-zinc-500">Counting…</p>
        )}

        {confirming ? (
          <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            <p>
              Send <span className="font-mono">{template?.name}</span> to <span className="font-semibold">{preview?.recipients}</span> patients? This cannot be recalled.
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setConfirming(false)} className={buttonClass("ghost", "sm")}>
                Cancel
              </button>
              <button type="button" onClick={send} disabled={pending} className={buttonClass("primary", "sm")}>
                {pending && <Loader2 className="h-4 w-4 animate-spin" />}
                Send now
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            disabled={!templateId || !title.trim() || !preview || preview.recipients === 0}
            className={buttonClass("primary", "md", "w-full")}
          >
            <Send className="h-4 w-4" /> Review and send
          </button>
        )}
      </div>
    </div>
  );
}
