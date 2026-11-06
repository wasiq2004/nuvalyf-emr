import Link from "next/link";
import { ArrowLeft, Download, FileSpreadsheet, FileUp } from "lucide-react";
import { buttonClass } from "@/components/app/buttons";
import { EmptyState, PageHeader, PageShell, Panel } from "@/components/app/page";
import { DataTable } from "@/components/app/data-table";
import { StatusBadge } from "@/components/app/status-badge";
import { can, requireClinic } from "@/lib/auth/clinic-session";
import { withClinic } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { getClinicSettings } from "@/features/settings/settings.service";
import { listStockImports } from "@/features/pharmacy/stock-import.service";
import { STOCK_TEMPLATE_CSV } from "@/features/pharmacy/stock-import-rules";
import { StockImportFlow } from "./StockImportFlow";
import { ReverseImport } from "./ReverseImport";

export const metadata = { title: "Import items & stock" };

const Col = ({ children }: { children: React.ReactNode }) => <span className="font-mono">{children}</span>;

export default async function StockImportPage() {
  const ctx = await requireClinic({ permission: ["stock:manage", "medicine:manage"], module: "pharmacy" });
  const { jobs, currency } = await withClinic({ clinicId: ctx.clinicId, userId: ctx.userId }, async (tx) => ({ jobs: await listStockImports(tx), currency: (await getClinicSettings(tx, ctx.clinicId)).currency }));
  const totals = (summary: unknown) => summary as { units?: number; costValue?: string; mrpValue?: string; batches?: number };
  const template = `data:text/csv;charset=utf-8,${encodeURIComponent(STOCK_TEMPLATE_CSV)}`;

  return (
    <PageShell width="default">
      <Link href="/pharmacy/stock" className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-white">
        <ArrowLeft className="h-4 w-4" /> Stock
      </Link>
      <PageHeader
        icon={FileUp}
        title="Import items & stock"
        description="Bring your item list and opening stock in from your old software or a spreadsheet. The whole file is checked first; if any row has a problem, nothing is imported. Opening stock goes in once: a batch already in stock is refused."
        actions={
          <a href={template} download="nuvalyf-items-stock-template.csv" className={buttonClass("secondary", "md")}>
            <Download className="h-4 w-4" /> Template CSV
          </a>
        }
      />

      <Panel title="Columns" description="One row per batch. Repeat the item's name on another row for each further batch; leave the stock columns empty for an item you have none of.">
        <ul className="grid gap-x-8 gap-y-1.5 text-sm text-zinc-700 sm:grid-cols-2 dark:text-zinc-300">
          <li>
            <Col>name</Col>: required
          </li>
          <li>
            <Col>type</Col>: medicine (default), consumable or instrument
          </li>
          <li>
            <Col>generic_name</Col>: required for a new medicine
          </li>
          <li>
            <Col>form</Col>, <Col>strength</Col>, <Col>manufacturer</Col>, <Col>category</Col>
          </li>
          <li>
            <Col>units_per_pack</Col> (default 1), <Col>selling_price</Col> per unit, <Col>reorder_level</Col>
          </li>
          <li>
            <Col>other_names</Col>: other spellings or brands, separated by <Col>;</Col>
          </li>
          <li>
            <Col>batch_no</Col>, <Col>expiry_date</Col> (MM/YY, dd/mm/yyyy or yyyy-mm-dd), <Col>quantity</Col>: together, for opening stock. You say below whether quantities are units or packs
          </li>
          <li>
            <Col>pack_price</Col> or <Col>mrp</Col>: the MRP printed on one pack of this batch. Each batch keeps its own
          </li>
          <li>
            <Col>unit_cost</Col>: what one unit cost you, or <Col>pack_cost</Col>: what a pack cost. With quantities in packs, <Col>unit_cost</Col> also means per pack
          </li>
        </ul>
        <p className="mt-4 text-xs text-zinc-500">
          A row whose name, or one of its other names, is already in your list adds stock to that item instead of creating a copy. Expired stock can be included: it is recorded so it can go back to the supplier, and can never be sold. Leave out anything damaged, or write it off afterwards.
        </p>
        <p className="mt-2 text-xs text-zinc-500">Batch numbers such as 00123 lose their zeros if Excel opens the file. Format the batch column as Text before saving. Afterwards, use Compare with stock here to check every batch against the old software&apos;s closing stock.</p>
      </Panel>

      <Panel title="Upload">
        <StockImportFlow currency={currency} />
      </Panel>

      <Panel flush title="Recent imports">
        <DataTable
          rows={jobs}
          rowKey={(j) => j.id}
          empty={<EmptyState icon={FileSpreadsheet} title="No imports yet" />}
          columns={[
            { key: "file", header: "File", cell: (j) => <span className="font-medium text-zinc-900 dark:text-zinc-100">{j.fileName}</span> },
            { key: "when", header: "When", hideOnMobile: true, cell: (j) => formatDateTime(j.createdAt, ctx.timezone) },
            { key: "rows", header: "Rows", align: "right", hideOnMobile: true, cell: (j) => j.rowCount },
            { key: "units", header: "Units", align: "right", hideOnMobile: true, cell: (j) => totals(j.summary).units ?? "—" },
            { key: "cost", header: "At cost", align: "right", hideOnMobile: true, cell: (j) => (totals(j.summary).costValue ? formatMoney(totals(j.summary).costValue, currency) : "—") },
            {
              key: "status",
              header: "",
              align: "right",
              cell: (j) =>
                j.status === "imported" ? (
                  <span className="flex items-center justify-end gap-2">
                    <StatusBadge tone="success">{j.imported} rows imported</StatusBadge>
                    {can(ctx, "stock:manage") && <ReverseImport jobId={j.id} fileName={j.fileName} />}
                  </span>
                ) : j.status === "reversed" ? (
                  <StatusBadge tone="warning">Reversed</StatusBadge>
                ) : (
                  <StatusBadge tone="danger">Refused · {(j.errors as unknown[]).length} problems</StatusBadge>
                ),
            },
          ]}
        />
      </Panel>
    </PageShell>
  );
}
