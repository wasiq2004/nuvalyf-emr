import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ArrowLeft, ClipboardCheck, FileDown } from "lucide-react";
import { buttonClass } from "@/components/app/buttons";
import { DetailList, PageHeader, PageShell, Panel } from "@/components/app/page";
import { DataTable } from "@/components/app/data-table";
import { StatusBadge } from "@/components/app/status-badge";
import { requireClinic } from "@/lib/auth/clinic-session";
import { withClinic } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { formatMoney, fromMinor } from "@/lib/money";
import { getClinicSettings } from "@/features/settings/settings.service";
import { blindLines, getCountHeader, reviewLines } from "@/features/pharmacy/stock-count.service";
import { COUNT_REASONS, type CountReason } from "@/features/pharmacy/stock-count-rules";
import { costValue } from "@/features/pharmacy/stock-rules";
import { CountEntry } from "./CountEntry";
import { CountReview } from "./CountReview";

export const metadata = { title: "Stock count" };

export default async function StockCountPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireClinic({ permission: "stock:manage", module: "pharmacy" });
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const data = await withClinic({ clinicId: ctx.clinicId, userId: ctx.userId }, async (tx) => {
    const count = await getCountHeader(tx, id);
    if (!count) return null;
    const counting = count.status === "counting";
    return {
      count,
      currency: (await getClinicSettings(tx, ctx.clinicId)).currency,
      // While counting, the system's figures never reach the browser.
      blind: counting ? await blindLines(tx, id) : [],
      lines: counting ? [] : await reviewLines(tx, id),
    };
  });
  if (!data) notFound();
  const { count, lines } = data;
  const value = (l: (typeof lines)[number], units: number) => fromMinor(costValue({ quantity: Math.abs(units), unitCost: l.unitCost, packCost: l.packCost, packSize: l.batchPackSize, mrp: l.mrp }) ?? 0);

  return (
    <PageShell width="wide">
      <Link href="/pharmacy/stock/counts" className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-white">
        <ArrowLeft className="h-4 w-4" /> Stock counts
      </Link>
      <PageHeader
        icon={ClipboardCheck}
        eyebrow={<span className="font-mono normal-case tracking-normal">{count.number}</span>}
        title={count.scopeLabel}
        description={`Started ${formatDateTime(count.createdAt, ctx.timezone)} by ${count.createdByName}`}
        actions={
          <a href={`/pharmacy/stock/counts/${count.id}/sheet`} target="_blank" rel="noopener" className={buttonClass("secondary", "md")}>
            <FileDown className="h-4 w-4" /> Count sheet
          </a>
        }
      />

      {count.status === "counting" && <CountEntry countId={count.id} lines={data.blind} />}

      {count.status === "review" && (
        <CountReview
          countId={count.id}
          currency={data.currency}
          lines={lines.map((l) => ({
            id: l.id,
            name: l.name,
            rack: l.rack,
            batchNo: l.batchNo,
            expiryDate: l.expiryDate,
            found: l.found,
            firstCount: l.firstCount,
            firstByName: l.firstByName,
            recount: l.recount,
            change: l.change,
            reason: l.reason,
            note: l.note,
            value: l.change ? value(l, l.change) : "0.00",
          }))}
        />
      )}

      {(count.status === "posted" || count.status === "cancelled") && (
        <>
          <Panel title={count.status === "posted" ? "Posted" : "Cancelled"}>
            <DetailList
              items={[
                { label: "Batches counted", value: lines.filter((l) => l.firstCount !== null).length },
                { label: "Corrected", value: lines.filter((l) => l.postedChange).length },
                ...(count.postedAt ? [{ label: "Posted", value: formatDateTime(count.postedAt, ctx.timezone) }] : []),
              ]}
            />
          </Panel>
          <Panel flush title="Differences" description={count.status === "posted" ? "Each of these is a movement on the batch's ledger." : "Cancelled: nothing moved."}>
            <DataTable
              rows={lines.filter((l) => l.change)}
              rowKey={(l) => l.id}
              empty={<p className="px-6 py-6 text-sm text-zinc-500">Everything counted matched.</p>}
              columns={[
                { key: "item", header: "Item", cell: (l) => <span className="font-medium text-zinc-900 dark:text-zinc-100">{l.name}</span> },
                { key: "batch", header: "Batch", cell: (l) => <span className="font-mono text-xs">{l.batchNo}</span> },
                { key: "why", header: "Why", hideOnMobile: true, cell: (l) => (l.reason ? [COUNT_REASONS[l.reason as CountReason], l.note].filter(Boolean).join(". ") : "—") },
                {
                  key: "change",
                  header: "Change",
                  align: "right",
                  cell: (l) => <StatusBadge tone={(l.change ?? 0) < 0 ? "danger" : "success"}>{(l.change ?? 0) > 0 ? `+${l.change}` : l.change}</StatusBadge>,
                },
                { key: "value", header: "At cost", align: "right", hideOnMobile: true, cell: (l) => formatMoney(value(l, l.change ?? 0), data.currency) },
              ]}
            />
          </Panel>
        </>
      )}
    </PageShell>
  );
}
