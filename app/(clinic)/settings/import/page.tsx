import { Download, FileSpreadsheet, Upload } from "lucide-react";
import { buttonClass } from "@/components/app/buttons";
import { EmptyState, PageHeader, PageShell, Panel } from "@/components/app/page";
import { DataTable } from "@/components/app/data-table";
import { StatusBadge } from "@/components/app/status-badge";
import { requireClinic } from "@/lib/auth/clinic-session";
import { withClinic } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { listImportJobs } from "@/features/import/import.service";
import { TEMPLATE_CSV } from "@/features/import/import-rules";
import { ImportFlow } from "./ImportFlow";

export const metadata = { title: "Import patients" };

export default async function ImportPage() {
  const ctx = await requireClinic({ permission: "import:run" });
  const jobs = await withClinic({ clinicId: ctx.clinicId, userId: ctx.userId }, (tx) => listImportJobs(tx));
  const template = `data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE_CSV)}`;

  return (
    <PageShell width="default">
      <PageHeader
        icon={Upload}
        title="Import patients"
        description="Bring an existing register in from a spreadsheet. The whole file is checked first; if any row has a problem, nothing is imported."
        actions={
          <a href={template} download="medflow-patients-template.csv" className={buttonClass("secondary", "md")}>
            <Download className="h-4 w-4" /> Template CSV
          </a>
        }
      />

      <Panel title="Columns">
        <ul className="grid gap-x-8 gap-y-1.5 text-sm text-zinc-700 sm:grid-cols-2 dark:text-zinc-300">
          <li>
            <span className="font-mono">first_name</span>, <span className="font-mono">sex</span> (male / female / other / unknown): required
          </li>
          <li>
            <span className="font-mono">date_of_birth</span> (yyyy-mm-dd or dd/mm/yyyy) <em>or</em> <span className="font-mono">age</span>: one is required
          </li>
          <li>
            <span className="font-mono">last_name</span>, <span className="font-mono">mobile</span>, <span className="font-mono">email</span>, <span className="font-mono">address</span>,{" "}
            <span className="font-mono">city</span>
          </li>
          <li>
            <span className="font-mono">consent_reminders</span>, <span className="font-mono">consent_broadcasts</span>: yes / no (needs a mobile)
          </li>
        </ul>
        <p className="mt-4 text-xs text-zinc-500">
          An age is stored with today&apos;s date so it keeps ageing correctly. Rows that look like patients already registered are refused, like at the front desk.
        </p>
      </Panel>

      <Panel title="Upload">
        <ImportFlow />
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
                  <StatusBadge tone="success">{j.imported} imported</StatusBadge>
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
