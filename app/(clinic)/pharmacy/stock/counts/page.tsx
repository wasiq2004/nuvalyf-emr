import Link from "next/link";
import { ArrowLeft, ClipboardCheck, ClipboardList } from "lucide-react";
import { EmptyState, PageHeader, PageShell, Panel } from "@/components/app/page";
import { DataTable } from "@/components/app/data-table";
import { StatusBadge } from "@/components/app/status-badge";
import { requireClinic } from "@/lib/auth/clinic-session";
import { withClinic } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { listCounts, racksInUse } from "@/features/pharmacy/stock-count.service";
import { StartCount } from "./StartCount";

export const metadata = { title: "Stock counts" };

const STATUS: Record<string, { label: string; tone: "info" | "warning" | "success" | "neutral" }> = {
  counting: { label: "Counting", tone: "info" },
  review: { label: "Review", tone: "warning" },
  posted: { label: "Posted", tone: "success" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

export default async function StockCountsPage() {
  const ctx = await requireClinic({ permission: "stock:manage", module: "pharmacy" });
  const data = await withClinic({ clinicId: ctx.clinicId, userId: ctx.userId }, async (tx) => ({ counts: await listCounts(tx), racks: await racksInUse(tx) }));
  const open = data.counts.find((c) => c.status === "counting" || c.status === "review");

  return (
    <PageShell>
      <Link href="/pharmacy/stock" className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-white">
        <ArrowLeft className="h-4 w-4" /> Stock
      </Link>
      <PageHeader icon={ClipboardCheck} title="Stock counts" description="Count the shelves without seeing what the system expects, then explain and post the differences. Sales can carry on while you count." />

      {open ? (
        <Panel title={`${open.number} is open`} description="Finish it or cancel it before starting another: two open counts would both correct the same stock.">
          <Link href={`/pharmacy/stock/counts/${open.id}`} className="text-sm font-medium text-(--accent-text) hover:underline">
            Continue {open.number}
          </Link>
        </Panel>
      ) : (
        <Panel title="Start a count" description="A daily count of about 20 items keeps stock right all year. Controlled drugs come up at least every 30 days.">
          <StartCount racks={data.racks} />
        </Panel>
      )}

      <Panel flush title="Counts">
        <DataTable
          rows={data.counts}
          rowKey={(c) => c.id}
          empty={<EmptyState icon={ClipboardList} title="No counts yet" />}
          columns={[
            {
              key: "number",
              header: "Count",
              cell: (c) => (
                <Link href={`/pharmacy/stock/counts/${c.id}`} className="font-mono font-semibold text-(--accent-text) hover:underline">
                  {c.number}
                </Link>
              ),
            },
            { key: "scope", header: "What", cell: (c) => c.scopeLabel },
            { key: "when", header: "Started", hideOnMobile: true, cell: (c) => formatDateTime(c.createdAt, ctx.timezone) },
            { key: "lines", header: "Counted", align: "right", cell: (c) => `${c.counted} of ${c.lines}` },
            { key: "moved", header: "Corrected", align: "right", hideOnMobile: true, cell: (c) => (c.status === "posted" ? c.moved : "—") },
            { key: "status", header: "", align: "right", cell: (c) => <StatusBadge tone={STATUS[c.status]?.tone ?? "neutral"}>{STATUS[c.status]?.label ?? c.status}</StatusBadge> },
          ]}
        />
      </Panel>
    </PageShell>
  );
}
