import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ArrowLeft, BookOpen, Users } from "lucide-react";
import { DetailList, EmptyState, PageHeader, PageShell, Panel } from "@/components/app/page";
import { DataTable } from "@/components/app/data-table";
import { requireClinic } from "@/lib/auth/clinic-session";
import { withClinic } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { formatMoney, fromMinor, toMinor } from "@/lib/money";
import { getClinicSettings } from "@/features/settings/settings.service";
import { customerBalance, customerLedger, getCustomer } from "@/features/pharmacy/customers.service";
import { CustomerDialog, PaymentDialog } from "../../AccountForms";

export const metadata = { title: "Customer account" };

const KIND_LINKS = { sale: "/pharmacy/sales/", return: "/pharmacy/returns/", receipt: null } as const;

export default async function CustomerAccountPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireClinic({ permission: "accounts:manage", module: "pharmacy" });
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const data = await withClinic({ clinicId: ctx.clinicId, userId: ctx.userId }, async (tx) => {
    const customer = await getCustomer(tx, id);
    if (!customer) return null;
    return {
      customer,
      balance: await customerBalance(tx, id),
      ledger: (await customerLedger(tx, id)).reverse(),
      currency: (await getClinicSettings(tx, ctx.clinicId)).currency,
    };
  });
  if (!data) notFound();
  const { customer } = data;
  const money = (v: string) => formatMoney(v, data.currency);
  const owes = fromMinor(Math.max(0, data.balance));

  return (
    <PageShell>
      <Link href="/pharmacy/accounts" className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-white">
        <ArrowLeft className="h-4 w-4" /> Accounts
      </Link>
      <PageHeader
        icon={Users}
        eyebrow="Customer account"
        title={customer.name}
        description={data.balance > 0 ? `Owes ${money(owes)}` : "Nothing owed"}
        actions={
          <>
            <CustomerDialog
              canSetCredit
              values={{
                id: customer.id,
                name: customer.name,
                phone: customer.phone ?? "",
                address: customer.address ?? "",
                gstin: customer.gstin ?? "",
                stateCode: customer.stateCode ?? "",
                creditLimit: customer.creditLimit ?? "",
              }}
            />
            {data.balance > 0 && <PaymentDialog side="customer" partyId={customer.id} partyName={customer.name} outstanding={owes} />}
          </>
        }
      />
      <Panel title="Details">
        <DetailList
          items={[
            { label: "Phone", value: customer.phone ?? "—" },
            { label: "GSTIN", value: customer.gstin ? <span className="font-mono">{customer.gstin}</span> : "—" },
            { label: "Address", value: customer.address ?? "—" },
            { label: "Credit limit", value: customer.creditLimit ? money(customer.creditLimit) : "No limit" },
            ...(customer.creditLimit ? [{ label: "Credit available", value: money(fromMinor(Math.max(0, toMinor(customer.creditLimit) - data.balance))) }] : []),
          ]}
        />
      </Panel>
      <Panel flush title="Statement" description="Newest first. Credit sales add to the balance; returns to the account and payments take it down.">
        <DataTable
          rows={data.ledger}
          rowKey={(e) => `${e.kind}-${e.id}`}
          empty={<EmptyState icon={BookOpen} title="No credit sales yet" />}
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
            { key: "debit", header: "Charged", align: "right", cell: (e) => (toMinor(e.debit) ? money(e.debit) : "") },
            { key: "credit", header: "Paid / returned", align: "right", cell: (e) => (toMinor(e.credit) ? money(e.credit) : "") },
            { key: "balance", header: "Balance", align: "right", hideOnMobile: true, cell: (e) => <span className="font-medium tabular-nums">{money(e.balance)}</span> },
          ]}
        />
      </Panel>
    </PageShell>
  );
}
