import Link from "next/link";
import { forbidden, notFound } from "next/navigation";
import { z } from "zod";
import { ArrowLeft, FileDown, Receipt, ShoppingCart } from "lucide-react";
import { ButtonLink, buttonClass } from "@/components/app/buttons";
import { PageHeader, PageShell, Panel } from "@/components/app/page";
import { DataTable } from "@/components/app/data-table";
import { can, recordDenied, requireClinic } from "@/lib/auth/clinic-session";
import { withClinic } from "@/lib/db";
import { formatDate, formatDateTime } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { getClinicSettings } from "@/features/settings/settings.service";
import { getSale } from "@/features/pharmacy/sales.service";
import { PAYMENT_METHOD_LABELS, type PaymentMethod } from "@/features/billing/billing-rules";

export const metadata = { title: "Pharmacy receipt" };

export default async function SalePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireClinic({ module: "pharmacy" });
  if (!can(ctx, "pharmacy:sell") && !can(ctx, "pharmacy:dispense")) {
    await recordDenied(ctx, "PAGE_ACCESS_DENIED", { required: ["pharmacy:sell", "pharmacy:dispense"], path: "/pharmacy/sales/[id]" });
    forbidden();
  }
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const data = await withClinic({ clinicId: ctx.clinicId, userId: ctx.userId }, async (tx) => {
    const sale = await getSale(tx, id);
    return sale ? { sale, currency: (await getClinicSettings(tx, ctx.clinicId)).currency } : null;
  });
  if (!data) notFound();
  const { sale } = data;
  const money = (v: string) => formatMoney(v, data.currency);

  return (
    <PageShell width="default">
      <Link href="/pharmacy" className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-white">
        <ArrowLeft className="h-4 w-4" /> Pharmacy
      </Link>
      <PageHeader
        icon={Receipt}
        eyebrow={<span className="font-mono normal-case tracking-normal">{sale.number}</span>}
        title={money(sale.total)}
        description={`${sale.customer} · ${PAYMENT_METHOD_LABELS[sale.method as PaymentMethod]}${sale.reference ? ` (${sale.reference})` : ""} · ${formatDateTime(sale.soldAt, ctx.timezone)} · ${sale.soldByName}`}
        actions={
          <>
            <a href={`/pharmacy/sales/${sale.id}/pdf`} target="_blank" rel="noopener" className={buttonClass("secondary", "md")}>
              <FileDown className="h-4 w-4" /> Receipt PDF
            </a>
            {can(ctx, "pharmacy:sell") && (
              <ButtonLink href="/pharmacy/sale">
                <ShoppingCart className="h-4 w-4" /> New sale
              </ButtonLink>
            )}
          </>
        }
      />
      <Panel flush title={sale.prescriptionId ? "Dispensed against a prescription" : "Counter sale"}>
        <DataTable
          rows={sale.items}
          rowKey={(i) => i.id}
          columns={[
            {
              key: "item",
              header: "Medicine",
              cell: (i) => (
                <div>
                  <p className="font-medium text-zinc-900 dark:text-zinc-100">{i.description}</p>
                  <p className="text-xs text-zinc-500">
                    Batch {i.batchNo} · exp {formatDate(i.expiryDate, "UTC")}
                  </p>
                </div>
              ),
            },
            { key: "qty", header: "Qty", align: "right", cell: (i) => i.quantity },
            { key: "price", header: "Price", align: "right", hideOnMobile: true, cell: (i) => money(i.unitPrice) },
            { key: "amount", header: "Amount", align: "right", cell: (i) => <span className="font-medium">{money(i.amount)}</span> },
          ]}
        />
      </Panel>
    </PageShell>
  );
}
