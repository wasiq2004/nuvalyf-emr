"use client";

// The doctor reviews the drafted summary, edits it and signs it.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, PenLine, RefreshCw, Save } from "lucide-react";
import { buttonClass } from "@/components/app/buttons";
import { inputClass } from "@/components/app/styles";
import { Panel } from "@/components/app/page";
import { draftSummaryAction, saveSummaryAction, signSummaryAction } from "@/features/inpatient/inpatient.actions";
import { REQUIRED_SECTIONS, type SummarySection } from "@/features/inpatient/summary-rules";
import { cn } from "@/lib/utils";

export function DraftButton({ admissionId, label, secondary }: { admissionId: string; label: string; secondary?: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  return (
    <button
      type="button"
      disabled={pending}
      onClick={async () => {
        setPending(true);
        const result = await draftSummaryAction({ admissionId });
        setPending(false);
        if (!result.ok) return toast.error(result.error);
        router.refresh();
      }}
      className={buttonClass(secondary ? "secondary" : "primary", "md")}
    >
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} {label}
    </button>
  );
}

export function SummaryEditor({ admissionId, sections }: { admissionId: string; sections: SummarySection[] }) {
  const router = useRouter();
  const [bodies, setBodies] = useState<Record<string, string>>(() => Object.fromEntries(sections.map((s) => [s.key, s.body])));
  const [pending, setPending] = useState<"save" | "sign" | null>(null);
  const payload = () => ({ admissionId, sections: sections.map((s) => ({ key: s.key, body: bodies[s.key] ?? "" })) });

  async function run(kind: "save" | "sign") {
    setPending(kind);
    const result = kind === "save" ? await saveSummaryAction(payload()) : await signSummaryAction(payload());
    setPending(null);
    if (!result.ok) return toast.error(result.error);
    toast.success(kind === "save" ? "Summary saved" : "Summary signed");
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {sections.map((s) => (
        <Panel key={s.key} title={s.title}>
          <textarea
            aria-label={s.title}
            value={bodies[s.key] ?? ""}
            onChange={(e) => setBodies((prev) => ({ ...prev, [s.key]: e.target.value }))}
            rows={Math.min(10, Math.max(3, (bodies[s.key] ?? "").split("\n").length + 1))}
            placeholder={REQUIRED_SECTIONS.includes(s.key) ? "Needed before signing" : "Nothing from the record; write here if needed"}
            className={cn(inputClass, "py-2.5")}
          />
        </Panel>
      ))}
      <div className="sticky bottom-4 flex flex-wrap items-center justify-end gap-2 rounded-2xl border border-zinc-200 bg-white/95 px-5 py-3 shadow-lg backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/95">
        <DraftButton admissionId={admissionId} label="Fill empty sections" secondary />
        <button type="button" disabled={pending !== null} onClick={() => run("save")} className={buttonClass("secondary", "md")}>
          {pending === "save" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save
        </button>
        <button type="button" disabled={pending !== null} onClick={() => run("sign")} className={buttonClass("primary", "md")}>
          {pending === "sign" ? <Loader2 className="h-4 w-4 animate-spin" /> : <PenLine className="h-4 w-4" />} Sign &amp; lock
        </button>
      </div>
    </div>
  );
}
