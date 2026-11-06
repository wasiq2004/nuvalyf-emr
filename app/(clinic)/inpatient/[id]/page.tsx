import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ArrowLeft, BedDouble, FileDown, FileText, Stethoscope } from "lucide-react";
import { ButtonLink, buttonClass } from "@/components/app/buttons";
import { DetailList, EmptyState, PageHeader, PageShell, Panel } from "@/components/app/page";
import { DataTable } from "@/components/app/data-table";
import { StatusBadge } from "@/components/app/status-badge";
import { can, requireClinic } from "@/lib/auth/clinic-session";
import { withClinic } from "@/lib/db";
import { formatDateTime, formatRelative } from "@/lib/format";
import { formatMoney, toMinor } from "@/lib/money";
import { toZonedDateTime, todayInTimeZone } from "@/lib/time";
import { cn } from "@/lib/utils";
import { getClinicSettings } from "@/features/settings/settings.service";
import { BILLING_MODE_LABELS, hoursText } from "@/features/inpatient/bed-billing-rules";
import { admissionBill, bedBoard, getAdmission } from "@/features/inpatient/inpatient.service";
import { getSummary } from "@/features/inpatient/summary.service";
import { AdjustBedDialog, ChargeDialog, DischargeDialog, DiscountDialog, PaymentDialog, TransferDialog, VoidChargeDialog } from "../InpatientForms";

export const metadata = { title: "Admission" };

const KIND: Record<string, string> = { doctor: "Doctor", nursing: "Nursing", procedure: "Procedure", lab: "Lab", pharmacy: "Pharmacy", other: "Other" };
const PAYMENT: Record<string, string> = { advance: "Advance", payment: "Payment", refund: "Refund" };

export default async function AdmissionPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireClinic({ permission: "inpatient:read", module: "inpatient" });
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const today = todayInTimeZone(ctx.timezone);
  const data = await withClinic({ clinicId: ctx.clinicId, userId: ctx.userId }, async (tx) => {
    const admission = await getAdmission(tx, id, today);
    if (!admission) return null;
    return {
      admission,
      bill: (await admissionBill(tx, id))!,
      beds: await bedBoard(tx, today),
      summary: await getSummary(tx, id),
      currency: (await getClinicSettings(tx, ctx.clinicId)).currency,
    };
  });
  if (!data) notFound();
  const { admission, bill } = data;
  const money = (v: string) => formatMoney(v, data.currency);
  const admitted = admission.status === "admitted";
  const now = toZonedDateTime(new Date(), ctx.timezone);
  const free = data.beds.filter((b) => b.isActive && !b.admissionId).map((b) => ({ value: b.id, label: `${b.ward ? `${b.ward} / ` : ""}${b.code} · ${b.categoryName} · ${money(b.dailyRate)} a day` }));
  const canBill = can(ctx, "inpatient:bill");
  const canAdjust = can(ctx, "inpatient:adjust");
  const current = bill.beds.find((b) => !b.endedAt);
  const due = bill.balance > 0 ? bill.totals.balance : null;

  return (
    <PageShell width="wide">
      <Link href="/inpatient" className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-white">
        <ArrowLeft className="h-4 w-4" /> Inpatients
      </Link>
      <PageHeader
        icon={BedDouble}
        eyebrow={<span className="font-mono normal-case tracking-normal">{admission.number} · {admission.patient.mrn}</span>}
        title={admission.patient.name}
        description={`${admission.patient.age !== null ? `${admission.patient.age} years` : "Age unknown"} · ${admission.doctorName} · admitted ${formatDateTime(admission.admittedAt, ctx.timezone)} (${formatRelative(admission.admittedAt)})`}
        actions={
          <>
            <StatusBadge tone={admitted ? "accent" : "neutral"}>{admitted ? "Admitted" : "Discharged"}</StatusBadge>
            <ButtonLink href={`/encounters/${admission.encounterId}`} variant="secondary">
              <Stethoscope className="h-4 w-4" /> Vitals &amp; notes
            </ButtonLink>
            <ButtonLink href={`/inpatient/${id}/summary`} variant="secondary">
              <FileText className="h-4 w-4" /> Discharge summary
            </ButtonLink>
            {admitted && can(ctx, "inpatient:admit") && <TransferDialog admissionId={id} beds={free} now={now} />}
            {admitted && can(ctx, "inpatient:admit") && <DischargeDialog admissionId={id} now={now} balance={due} />}
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="min-w-0 space-y-6">
          <Panel flush title="Bed charges" description={`${BILLING_MODE_LABELS[bill.billingMode]}, from the time of admission. Minimum ${bill.minimumHours} hours.${admitted ? " Still running." : ""}`}>
            <DataTable
              rows={bill.beds}
              rowKey={(b) => b.id}
              columns={[
                {
                  key: "bed",
                  header: "Bed",
                  cell: (b) => (
                    <div>
                      <p className="font-medium text-zinc-900 dark:text-zinc-100">
                        {b.categoryName} · {b.bedLabel}
                      </p>
                      <p className="text-xs text-zinc-500">
                        {formatDateTime(b.startedAt, ctx.timezone)} to {b.endedAt ? formatDateTime(b.endedAt, ctx.timezone) : "now"}
                      </p>
                      {b.overrideReason && <p className="text-xs text-amber-700 dark:text-amber-400">Changed: {b.overrideReason}</p>}
                    </div>
                  ),
                },
                { key: "hours", header: "Charged", align: "right", cell: (b) => hoursText(b.hours) },
                { key: "rate", header: "Per day", align: "right", hideOnMobile: true, cell: (b) => money(b.rate) },
                { key: "amount", header: "Amount", align: "right", cell: (b) => <span className="font-medium tabular-nums">{money(b.amount)}</span> },
                ...(canAdjust ? [{ key: "edit", header: "", align: "right" as const, cell: (b: (typeof bill.beds)[number]) => <AdjustBedDialog stayId={b.id} label={b.bedLabel} hours={b.hours} rate={b.rate} /> }] : []),
              ]}
            />
          </Panel>

          <Panel flush title="Other charges" actions={canBill ? <ChargeDialog admissionId={id} /> : undefined}>
            <DataTable
              rows={bill.charges}
              rowKey={(c) => c.id}
              empty={<EmptyState icon={FileText} title="No other charges" description="Doctor visits, procedures and lab tests go here; pharmacy adds its own." />}
              columns={[
                {
                  key: "what",
                  header: "Charge",
                  cell: (c) => (
                    <div className={cn(c.voidedAt && "text-zinc-400 line-through")}>
                      <p className="font-medium">{c.description}</p>
                      <p className="text-xs text-zinc-500">
                        {KIND[c.kind]} · {formatDateTime(c.createdAt, ctx.timezone)}
                      </p>
                    </div>
                  ),
                },
                { key: "qty", header: "Qty", align: "right", hideOnMobile: true, cell: (c) => c.quantity },
                { key: "amount", header: "Amount", align: "right", cell: (c) => <span className={cn("font-medium tabular-nums", c.voidedAt && "text-zinc-400 line-through")}>{money(c.amount)}</span> },
                ...(canAdjust ? [{ key: "void", header: "", align: "right" as const, cell: (c: (typeof bill.charges)[number]) => (c.voidedAt ? <span className="text-xs text-zinc-500">{c.voidReason}</span> : <VoidChargeDialog chargeId={c.id} label={c.description} />) }] : []),
              ]}
            />
          </Panel>

          <Panel flush title="Payments">
            <DataTable
              rows={bill.payments}
              rowKey={(p) => p.id}
              empty={<EmptyState icon={FileText} title="No payments yet" />}
              columns={[
                { key: "number", header: "Receipt", cell: (p) => <span className="font-mono text-sm">{p.number}</span> },
                { key: "kind", header: "Type", cell: (p) => PAYMENT[p.kind] },
                { key: "when", header: "When", hideOnMobile: true, cell: (p) => `${formatDateTime(p.receivedAt, ctx.timezone)} · ${p.receivedByName}` },
                { key: "method", header: "Method", hideOnMobile: true, cell: (p) => p.method.toUpperCase() },
                { key: "amount", header: "Amount", align: "right", cell: (p) => <span className="font-medium tabular-nums">{p.kind === "refund" ? "− " : ""}{money(p.amount)}</span> },
              ]}
            />
          </Panel>
        </div>

        <div className="space-y-6">
          <Panel title={admitted ? "Bill so far" : "Final bill"}>
            <dl className="space-y-2 text-sm">
              <Row label="Bed charges" value={money(bill.totals.bed)} />
              <Row label="Other charges" value={money(bill.totals.charges)} />
              {toMinor(bill.totals.discount) > 0 && <Row label={`Discount${bill.discountReason ? ` (${bill.discountReason})` : ""}`} value={`− ${money(bill.totals.discount)}`} />}
              <Row label="Bill amount" value={money(bill.totals.net)} strong />
              <Row label="Paid" value={money(bill.totals.paid)} />
              <div className="flex justify-between border-t border-zinc-100 pt-2 text-base font-bold dark:border-zinc-800">
                <dt>{bill.balance < 0 ? "To refund" : "Balance due"}</dt>
                <dd className={cn("tabular-nums", bill.balance > 0 && "text-amber-700 dark:text-amber-400")}>{money(bill.totals.balance.replace("-", ""))}</dd>
              </div>
            </dl>
            <div className="mt-4 flex flex-wrap gap-2">
              {canBill && <PaymentDialog admissionId={id} balance={bill.totals.balance} discharged={!admitted} />}
              {canAdjust && <DiscountDialog admissionId={id} current={bill.totals.discount} />}
              <a href={`/inpatient/${id}/bill`} target="_blank" rel="noopener" className={buttonClass("secondary", "sm")}>
                <FileDown className="h-4 w-4" /> {admitted ? "Interim bill" : "Final bill"}
              </a>
            </div>
          </Panel>

          <Panel title="Details">
            <DetailList
              items={[
                { label: "Reason", value: admission.reason },
                { label: "Bed", value: current ? `${current.categoryName} · ${current.bedLabel}` : "—" },
                { label: "Attendant", value: [admission.attendantName, admission.attendantPhone].filter(Boolean).join(" · ") || "—" },
                { label: "Discharged", value: admission.dischargedAt ? formatDateTime(admission.dischargedAt, ctx.timezone) : "—" },
                { label: "Summary", value: data.summary ? (data.summary.status === "signed" ? "Signed" : "Draft") : "Not started" },
              ]}
            />
          </Panel>
        </div>
      </div>
    </PageShell>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={cn("flex justify-between gap-3", strong && "font-semibold")}>
      <dt className={strong ? undefined : "text-zinc-500"}>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}
