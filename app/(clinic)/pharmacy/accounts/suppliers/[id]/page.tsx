import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { ArrowLeft, BookOpen, Truck } from "lucide-react";
import { DetailList, EmptyState, PageHeader, PageShell, Panel } from "@/components/app/page";
import { DataTable } from "@/components/app/data-table";
import { requireClinic } from "@/lib/auth/clinic-session";
import { withClinic } from "@/lib/db";
import { suppliers } from "@/lib/db/schema";
import { formatDateTime } from "@/lib/format";
import { formatMoney, fromMinor, toMinor } from "@/lib/money";
import { getClinicSettings } from "@/features/settings/settings.service";
import { supplierBalance, supplierLedger } from "@/features/pharmacy/supplier-accounts.service";
import { OpeningDialog, PaymentDialog } from "../../AccountForms";

export const metadata = { title: "Supplier account" };

const KIND_LINKS = { opening: null, bill: "/pharmacy/purchases/bills/", debit_note: "/pharmacy/purchases/returns/", payment: null } as const;

export default async function SupplierAccountPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireClinic({ permission: "accounts:manage", module: "pharmacy" });
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const data = await withClinic({ clinicId: ctx.clinicId, userId: ctx.userId }, async (tx) => {
    const [supplier] = await tx.select().from(suppliers).where(eq(suppliers.id, id)).limit(1);
    if (!supplier) return null;
    return {
      supplier,
      owed: await supplierBalance(tx, id),
      ledger: (await supplierLedger(tx, id)).reverse(),
      currency: (await getClinicSettings(tx, ctx.clinicId)).currency,
    };
  });
  if (!data) notFound();
  const { supplier } = data;
  const money = (v: string) => formatMoney(v, data.currency);
  const owed = fromMinor(Math.max(0, data.owed));

  return (
    <PageShell>
      <Link href="/pharmacy/accounts?tab=suppliers" className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-white">
        <ArrowLeft className="h-4 w-4" /> Accounts
      </Link>
      <PageHeader
        icon={Truck}
        eyebrow="Supplier account"
        title={supplier.name}
        description={data.owed > 0 ? `Owed ${money(owed)}` : "Nothing owed"}
        actions={
          <>
            <OpeningDialog side="supplier" partyId={supplier.id} partyName={supplier.name} />
            {data.owed > 0 && <PaymentDialog side="supplier" partyId={supplier.id} partyName={supplier.name} outstanding={owed} />}
          </>
        }
      />
      <Panel title="Details">
        <DetailList
          items={[
            { label: "Contact", value: supplier.contactName ?? "—" },
            { label: "Phone", value: supplier.phone ?? "—" },
            { label: "Email", value: supplier.email ?? "—" },
            { label: "GSTIN", value: supplier.taxId ? <span className="font-mono">{supplier.taxId}</span> : "—" },
          ]}
        />
      </Panel>
      <Panel flush title="Statement" description="Newest first. Bills add to what is owed; debit notes and payments take it down.">
        <DataTable
          rows={data.ledger}
          rowKey={(e) => `${e.kind}-${e.id}`}
          empty={<EmptyState icon={BookOpen} title="No bills from this supplier yet" />}
          columns={[
            { key: "date", header: "Date", cell: (e) => formatDateTime(e.date, ctx.timezone) },
            {
              key: "doc",
              header: "Document",
              cell: (e) => {
                const href = KIND_LINKS[e.kind];
                return (
                  <div>
                    {href ? (
                      <Link href={`${href}${e.id}`} className="font-mono text-sm font-semibold text-(--accent-text) hover:underline">
                        {e.number}
                      </Link>
                    ) : (
                      <span className="font-mono text-sm font-semibold">{e.number}</span>
                    )}
                    <p className="text-xs text-zinc-500">{e.note}</p>
                  </div>
                );
              },
            },
            { key: "credit", header: "Billed", align: "right", cell: (e) => (toMinor(e.credit) ? money(e.credit) : "") },
            { key: "debit", header: "Paid / returned", align: "right", cell: (e) => (toMinor(e.debit) ? money(e.debit) : "") },
            { key: "owed", header: "Owed", align: "right", hideOnMobile: true, cell: (e) => <span className="font-medium tabular-nums">{money(e.owed)}</span> },
          ]}
        />
      </Panel>
    </PageShell>
  );
}
