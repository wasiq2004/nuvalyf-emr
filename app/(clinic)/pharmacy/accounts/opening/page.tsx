import Link from "next/link";
import { ArrowLeft, Download, FileSpreadsheet, FileUp } from "lucide-react";
import { buttonClass } from "@/components/app/buttons";
import { EmptyState, PageHeader, PageShell, Panel } from "@/components/app/page";
import { DataTable } from "@/components/app/data-table";
import { StatusBadge } from "@/components/app/status-badge";
import { requireClinic } from "@/lib/auth/clinic-session";
import { withClinic } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { getClinicSettings } from "@/features/settings/settings.service";
import { listBalanceImports } from "@/features/pharmacy/opening-balances.service";
import { BALANCE_TEMPLATE_CSV } from "@/features/pharmacy/opening-balances-rules";
import { BalanceImportFlow } from "./BalanceImportFlow";

export const metadata = { title: "Opening balances" };

const Col = ({ children }: { children: React.ReactNode }) => <span className="font-mono">{children}</span>;

export default async function OpeningBalancesPage() {
  const ctx = await requireClinic({ permission: "accounts:manage", module: "pharmacy" });
  const data = await withClinic({ clinicId: ctx.clinicId, userId: ctx.userId }, async (tx) => ({ jobs: await listBalanceImports(tx), currency: (await getClinicSettings(tx, ctx.clinicId)).currency }));
  const template = `data:text/csv;charset=utf-8,${encodeURIComponent(BALANCE_TEMPLATE_CSV)}`;
  const money = (v: unknown) => formatMoney(String(v ?? "0"), data.currency);

  return (
    <PageShell width="default">
      <Link href="/pharmacy/accounts" className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-white">
        <ArrowLeft className="h-4 w-4" /> Accounts
      </Link>
      <PageHeader
        icon={FileUp}
        title="Opening balances"
        description="What customers owed you and what you owed suppliers in the old software on the day you moved. The whole file is checked first; if any row has a problem, nothing is imported."
        actions={
          <a href={template} download="nuvalyf-opening-balances-template.csv" className={buttonClass("secondary", "md")}>
            <Download className="h-4 w-4" /> Template CSV
          </a>
        }
      />

      <Panel title="Columns" description="One row per party, or one per unpaid bill: rows for the same party add up. A name not in your list is added.">
        <ul className="grid gap-x-8 gap-y-1.5 text-sm text-zinc-700 sm:grid-cols-2 dark:text-zinc-300">
          <li>
            <Col>type</Col>: customer or supplier
          </li>
          <li>
            <Col>name</Col>: as in the old software
          </li>
          <li>
            <Col>amount</Col>: what is owed; a minus for an advance
          </li>
          <li>
            <Col>phone</Col>, <Col>gstin</Col>: for a party being added
          </li>
          <li>
            <Col>as_of</Col>: the date of the balance (today if empty)
          </li>
          <li>
            <Col>reference</Col>: the old bill number
          </li>
        </ul>
        <p className="mt-4 text-xs text-zinc-500">A party with an opening balance is refused, so a file cannot be counted twice. Correct one from the party&apos;s account. These balances carry no GST and move no stock.</p>
      </Panel>

      <Panel title="Upload">
        <BalanceImportFlow currency={data.currency} />
      </Panel>

      <Panel flush title="Recent imports">
        <DataTable
          rows={data.jobs}
          rowKey={(j) => j.id}
          empty={<EmptyState icon={FileSpreadsheet} title="No imports yet" />}
          columns={[
            { key: "file", header: "File", cell: (j) => <span className="font-medium text-zinc-900 dark:text-zinc-100">{j.fileName}</span> },
            { key: "when", header: "When", hideOnMobile: true, cell: (j) => formatDateTime(j.createdAt, ctx.timezone) },
            { key: "customers", header: "Customers owe", align: "right", hideOnMobile: true, cell: (j) => (j.status === "imported" ? money((j.summary as { customerTotal?: string }).customerTotal) : "—") },
            { key: "suppliers", header: "Owed to suppliers", align: "right", hideOnMobile: true, cell: (j) => (j.status === "imported" ? money((j.summary as { supplierTotal?: string }).supplierTotal) : "—") },
            {
              key: "status",
              header: "",
              align: "right",
              cell: (j) => (j.status === "imported" ? <StatusBadge tone="success">{j.imported} rows imported</StatusBadge> : <StatusBadge tone="danger">Refused · {(j.errors as unknown[]).length} problems</StatusBadge>),
            },
          ]}
        />
      </Panel>
    </PageShell>
  );
}
