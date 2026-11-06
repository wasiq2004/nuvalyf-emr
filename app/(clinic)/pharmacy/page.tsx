import Link from "next/link";
import { forbidden } from "next/navigation";
import { AlertTriangle, Banknote, ClipboardList, PackageX, Pill, Search, ShoppingCart } from "lucide-react";
import { ButtonLink } from "@/components/app/buttons";
import { EmptyState, PageHeader, PageShell, Panel, StatCard } from "@/components/app/page";
import { DataTable } from "@/components/app/data-table";
import { StatusBadge } from "@/components/app/status-badge";
import { AutoRefresh } from "@/components/app/auto-refresh";
import { can, recordDenied, requireClinic } from "@/lib/auth/clinic-session";
import { recordAudit } from "@/lib/audit";
import { withClinic } from "@/lib/db";
import { getRequestMeta } from "@/lib/request";
import { formatDate, formatRelative, formatTime } from "@/lib/format";
import { inputClass } from "@/components/app/styles";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/money";
import { addDaysToDateString, todayInTimeZone, zonedTimeToUtc } from "@/lib/time";
import { getClinicSettings } from "@/features/settings/settings.service";
import { findPrescriptionsForPatient, listPrescriptionQueue, salesBetween, salesTotal } from "@/features/pharmacy/sales.service";
import { listStock } from "@/features/pharmacy/stock.service";
import { MONEY_METHOD_LABELS } from "@/components/pharmacy/status";

export const metadata = { title: "Pharmacy" };

const STATUS_LABELS: Record<string, string> = { pending: "To fill", partial: "Part filled", dispensed: "Dispensed", not_required: "Closed" };
const STATUS_TONES: Record<string, "info" | "warning" | "success" | "neutral"> = { pending: "info", partial: "warning", dispensed: "success", not_required: "neutral" };

export default async function PharmacyPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const ctx = await requireClinic({ module: "pharmacy" });
  const canDispense = can(ctx, "pharmacy:dispense");
  const canSell = can(ctx, "pharmacy:sell");
  if (!canDispense && !canSell) {
    await recordDenied(ctx, "PAGE_ACCESS_DENIED", { required: ["pharmacy:dispense", "pharmacy:sell"], path: "/pharmacy" });
    forbidden();
  }
  const today = todayInTimeZone(ctx.timezone);
  const dayStart = zonedTimeToUtc(today, "00:00", ctx.timezone);
  const dayEnd = zonedTimeToUtc(addDaysToDateString(today, 1), "00:00", ctx.timezone);
  const since = zonedTimeToUtc(addDaysToDateString(today, -30), "00:00", ctx.timezone);
  const now = new Date();
  const search = ((await searchParams).q ?? "").trim().slice(0, 100);

  const meta = await getRequestMeta();
  const data = await withClinic({ clinicId: ctx.clinicId, userId: ctx.userId }, async (tx) => ({
    currency: (await getClinicSettings(tx, ctx.clinicId)).currency,
    queue: canDispense ? await listPrescriptionQueue(tx, today, since) : [],
    found:
      canDispense && search
        ? await findPrescriptionsForPatient(tx, search, today).then(async (rows) => {
            await recordAudit(tx, { clinicId: ctx.clinicId, actorUserId: ctx.userId, action: "PATIENT_SEARCH", details: { query: search, results: rows.length, from: "pharmacy" }, meta });
            return rows;
          })
        : [],
    sales: await salesBetween(tx, dayStart, dayEnd),
    totals: await salesTotal(tx, dayStart, dayEnd),
    stock: await listStock(tx, today, now),
  }));
  const money = (v: string) => formatMoney(v, data.currency);
  const attention = data.stock.filter((s) => s.flags.some((f) => f === "out" || f === "low" || f === "expired" || f === "expiring"));

  return (
    <PageShell>
      <AutoRefresh seconds={60} />
      <PageHeader
        icon={Pill}
        eyebrow={ctx.clinicName}
        title="Pharmacy"
        description="Signed prescriptions waiting to be filled, counter sales and stock that needs attention."
        actions={
          <>
            {can(ctx, "pharmacy:return") && (
              <ButtonLink href="/pharmacy/returns/old-bill" variant="secondary">
                Return on an old bill
              </ButtonLink>
            )}
            {canSell && (
              <ButtonLink href="/pharmacy/sale">
                <ShoppingCart className="h-4 w-4" /> New sale
              </ButtonLink>
            )}
          </>
        }
      />

      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Prescriptions waiting" value={data.queue.length} icon={ClipboardList} hint={`${data.queue.filter((q) => q.dispenseStatus === "partial").length} part-filled`} />
        <StatCard label="Sales today" value={money(data.totals.total)} icon={Banknote} hint={`${data.totals.count} ${data.totals.count === 1 ? "sale" : "sales"}${data.totals.returned !== "0.00" ? ` · ${money(data.totals.returned)} returned` : ""}`} />
        <StatCard label="Low or out of stock" value={data.stock.filter((s) => s.flags.includes("low") || s.flags.includes("out")).length} icon={PackageX} />
        <StatCard label="Expiring / expired" value={data.stock.filter((s) => s.flags.includes("expiring") || s.flags.includes("expired")).length} icon={AlertTriangle} hint="Within 90 days" />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="min-w-0 space-y-6 xl:col-span-2">
          {canDispense && (
            <form action="/pharmacy" className="relative">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" aria-hidden />
              <input
                type="search"
                name="q"
                defaultValue={search}
                aria-label="Find a patient's prescription"
                placeholder="Patient name, phone or record number"
                autoComplete="off"
                className={cn(inputClass, "h-12 pl-10 text-base")}
              />
            </form>
          )}
          {canDispense && search && (
            <Panel flush title={`Prescriptions for “${search}”`} description="Newest first, including older and part-filled ones.">
              <DataTable
                rows={data.found}
                rowKey={(q) => q.prescriptionId}
                empty={<EmptyState icon={ClipboardList} title="No prescriptions found" description="Check the spelling, or try the phone number or record number." />}
                columns={[
                  {
                    key: "patient",
                    header: "Patient",
                    cell: (q) => (
                      <div>
                        <p className="font-medium text-zinc-900 dark:text-zinc-100">{q.patientName}</p>
                        <p className="text-xs text-zinc-500">
                          {q.patientMrn} · {q.patientAge ?? "—"} y
                        </p>
                      </div>
                    ),
                  },
                  {
                    key: "from",
                    header: "From",
                    hideOnMobile: true,
                    cell: (q) => (
                      <div className="text-sm">
                        {q.doctorName}
                        <p className="text-xs text-zinc-500">
                          {formatDate(q.signedAt, ctx.timezone)} · {q.items} {q.items === 1 ? "item" : "items"}
                        </p>
                      </div>
                    ),
                  },
                  { key: "status", header: "", cell: (q) => <StatusBadge tone={STATUS_TONES[q.dispenseStatus] ?? "neutral"}>{STATUS_LABELS[q.dispenseStatus] ?? q.dispenseStatus}</StatusBadge> },
                  {
                    key: "open",
                    header: "",
                    align: "right",
                    cell: (q) => (
                      <ButtonLink href={`/pharmacy/rx/${q.prescriptionId}`} variant="secondary" size="sm">
                        {q.dispenseStatus === "pending" || q.dispenseStatus === "partial" ? "Fill" : "View"}
                      </ButtonLink>
                    ),
                  },
                ]}
              />
            </Panel>
          )}
          {canDispense && (
            <Panel flush title="Prescription queue" description="Signed prescriptions from the last 30 days, oldest first.">
              <DataTable
                rows={data.queue}
                rowKey={(q) => q.prescriptionId}
                empty={<EmptyState icon={ClipboardList} title="Nothing to fill" description="Prescriptions appear here as soon as the doctor signs." />}
                columns={[
                  {
                    key: "patient",
                    header: "Patient",
                    cell: (q) => (
                      <div>
                        <p className="font-medium text-zinc-900 dark:text-zinc-100">{q.patientName}</p>
                        <p className="text-xs text-zinc-500">
                          {q.patientMrn} · {q.patientAge ?? "—"} y
                        </p>
                      </div>
                    ),
                  },
                  {
                    key: "from",
                    header: "From",
                    hideOnMobile: true,
                    cell: (q) => (
                      <div className="text-sm">
                        {q.doctorName}
                        <p className="text-xs text-zinc-500">{formatRelative(q.signedAt, now)}</p>
                      </div>
                    ),
                  },
                  {
                    key: "status",
                    header: "",
                    cell: (q) => (
                      <span className="flex flex-wrap gap-1">
                        <StatusBadge tone={q.dispenseStatus === "partial" ? "warning" : "info"}>{q.dispenseStatus === "partial" ? "Part filled" : `${q.items} ${q.items === 1 ? "item" : "items"}`}</StatusBadge>
                        {q.openQueries > 0 && <StatusBadge tone="accent">Asked doctor</StatusBadge>}
                      </span>
                    ),
                  },
                  {
                    key: "open",
                    header: "",
                    align: "right",
                    cell: (q) => (
                      <ButtonLink href={`/pharmacy/rx/${q.prescriptionId}`} variant="secondary" size="sm">
                        Fill
                      </ButtonLink>
                    ),
                  },
                ]}
              />
            </Panel>
          )}

          <Panel flush title="Today's sales">
            {data.sales.length === 0 ? (
              <div className="p-6 lg:p-8">
                <EmptyState icon={Banknote} title="No sales yet today" />
              </div>
            ) : (
              <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {data.sales.map(({ sale, patient }) => (
                  <li key={sale.id}>
                    <Link href={`/pharmacy/sales/${sale.id}`} className="flex items-center justify-between gap-3 px-6 py-3 hover:bg-zinc-50 lg:px-8 dark:hover:bg-zinc-800/40">
                      <span className="text-sm">
                        <span className="font-mono font-semibold text-(--accent-text)">{sale.number}</span>
                        <span className="text-zinc-500">
                          {" "}
                          · {formatTime(sale.soldAt, ctx.timezone)} · {patient ? patient.mrn : (sale.customerName ?? "Walk-in")}
                          {sale.prescriptionId ? " · prescription" : ""}
                        </span>
                      </span>
                      <span className="text-sm font-semibold tabular-nums">
                        {money(sale.total)} <span className="text-xs font-normal text-zinc-500">{MONEY_METHOD_LABELS[sale.method] ?? sale.method}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <Panel
          title="Needs attention"
          actions={
            can(ctx, "stock:manage") ? (
              <Link href="/pharmacy/stock" className="text-sm font-medium text-(--accent-text) hover:underline">
                Stock
              </Link>
            ) : undefined
          }
        >
          {attention.length === 0 ? (
            <EmptyState icon={Pill} title="Stock looks fine" />
          ) : (
            <ul className="space-y-2">
              {attention.slice(0, 12).map((s) => (
                <li key={s.drugId} className="flex items-center justify-between gap-2 text-sm">
                  <span className="min-w-0 truncate text-zinc-800 dark:text-zinc-200">{s.name}</span>
                  <span className="flex flex-shrink-0 gap-1">
                    {s.flags.includes("out") && <StatusBadge tone="danger">Out</StatusBadge>}
                    {s.flags.includes("low") && <StatusBadge tone="warning">Low · {s.onHand}</StatusBadge>}
                    {s.flags.includes("expired") && <StatusBadge tone="danger">Expired</StatusBadge>}
                    {s.flags.includes("expiring") && <StatusBadge tone="warning">Expiring</StatusBadge>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </PageShell>
  );
}
