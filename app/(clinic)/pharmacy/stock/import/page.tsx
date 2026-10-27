import Link from "next/link";
import { ArrowLeft, Download, FileSpreadsheet, FileUp } from "lucide-react";
import { buttonClass } from "@/components/app/buttons";
import { EmptyState, PageHeader, PageShell, Panel } from "@/components/app/page";
import { DataTable } from "@/components/app/data-table";
import { StatusBadge } from "@/components/app/status-badge";
import { requireClinic } from "@/lib/auth/clinic-session";
import { withClinic } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { listStockImports } from "@/features/pharmacy/stock-import.service";
import { STOCK_TEMPLATE_CSV } from "@/features/pharmacy/stock-import-rules";
import { StockImportFlow } from "./StockImportFlow";

export const metadata = { title: "Import items & stock" };

const Col = ({ children }: { children: React.ReactNode }) => <span className="font-mono">{children}</span>;

export default async function StockImportPage() {
  const ctx = await requireClinic({ permission: ["stock:manage", "medicine:manage"], module: "pharmacy" });
  const jobs = await withClinic({ clinicId: ctx.clinicId, userId: ctx.userId }, (tx) => listStockImports(tx));
  const template = `data:text/csv;charset=utf-8,${encodeURIComponent(STOCK_TEMPLATE_CSV)}`;

  return (
    <PageShell width="default">
      <Link href="/pharmacy/stock" className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-white">
        <ArrowLeft className="h-4 w-4" /> Stock
      </Link>
      <PageHeader
        icon={FileUp}
        title="Import items & stock"
        description="Bring your item list and opening stock in from your old software or a spreadsheet. The whole file is checked first; if any row has a problem, nothing is imported."
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
            <Col>batch_no</Col>, <Col>expiry_date</Col> (MM/YY, dd/mm/yyyy or yyyy-mm-dd), <Col>quantity</Col> in units: together, for opening stock
          </li>
          <li>
            <Col>unit_cost</Col>: what one unit cost you (optional)
          </li>
        </ul>
        <p className="mt-4 text-xs text-zinc-500">
          A row whose name, or one of its other names, is already in your list adds stock to that item instead of creating a copy. Quantities are single units (tablets, needles), not packs.
        </p>
      </Panel>

      <Panel title="Upload">
        <StockImportFlow />
      </Panel>

      <Panel flush title="Recent imports">
        <DataTable
          rows={jobs}
          rowKey={(j) => j.id}
          empty={<EmptyState icon={FileSpreadsheet} title="No imports yet" />}
          columns={[
            { key: "file", header: "File", cell: (j) => <span className="font-medium text-zinc-900 dark:text-zinc-100">{j.fileName}</span> },
            { key: "when", header: "When", hideOnMobile: true, cell: (j) => formatDateTime(j.createdAt, ctx.timezone) },
            { key: "rows", header: "Rows", align: "right", cell: (j) => j.rowCount },
            {
              key: "status",
              header: "",
              align: "right",
              cell: (j) =>
                j.status === "imported" ? (
                  <StatusBadge tone="success">{j.imported} rows imported</StatusBadge>
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
