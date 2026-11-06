"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { buttonClass } from "@/components/app/buttons";
import { inputClass } from "@/components/app/form";
import { startStockCountAction } from "@/features/pharmacy/stock-count.actions";
import { cn } from "@/lib/utils";

export function StartCount({ racks }: { racks: string[] }) {
  const router = useRouter();
  const [rack, setRack] = useState(racks[0] ?? "");
  const [busy, setBusy] = useState<string | null>(null);

  async function start(scope: "cycle" | "rack" | "all") {
    setBusy(scope);
    const result = await startStockCountAction({ scope, rack: scope === "rack" ? rack : undefined });
    setBusy(null);
    if (!result.ok) return toast.error(result.error);
    router.push(`/pharmacy/stock/counts/${result.data.id}`);
  }

  const spin = (scope: string) => busy === scope && <Loader2 className="h-4 w-4 animate-spin" />;
  return (
    <div className="flex flex-wrap items-end gap-3">
      <button type="button" disabled={busy !== null} onClick={() => start("cycle")} className={buttonClass("primary", "md")}>
        {spin("cycle")} Today&apos;s daily count
      </button>
      {racks.length > 0 && (
        <div className="flex items-end gap-2">
          <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Rack
            <select value={rack} onChange={(e) => setRack(e.target.value)} className={cn(inputClass, "mt-1.5 h-10 w-32")}>
              {racks.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          <button type="button" disabled={busy !== null} onClick={() => start("rack")} className={buttonClass("secondary", "md")}>
            {spin("rack")} Count this rack
          </button>
        </div>
      )}
      <button type="button" disabled={busy !== null} onClick={() => start("all")} className={buttonClass("secondary", "md")}>
        {spin("all")} Whole pharmacy
      </button>
    </div>
  );
}
