import Link from "next/link";
import { Building2, Search, Truck, Users, Wallet } from "lucide-react";
import { EmptyState, PageHeader, PageShell, Panel, StatCard } from "@/components/app/page";
import { DataTable } from "@/components/app/data-table";
import { TabNav } from "@/components/app/tabs";
import { inputClass } from "@/components/app/styles";
import { requireClinic } from "@/lib/auth/clinic-session";
import { withClinic } from "@/lib/db";
import { formatMoney, fromMinor, toMinor } from "@/lib/money";
import { cn } from "@/lib/utils";
import { getClinicSettings } from "@/features/settings/settings.service";
import { customerBalances } from "@/features/pharmacy/customers.service";
import { supplierBalances } from "@/features/pharmacy/supplier-accounts.service";
import { CustomerDialog } from "./AccountForms";

export const metadata = { title: "Pharmacy accounts" };

export default async function AccountsPage({ searchParams }: { searchParams: Promise<{ tab?: string; q?: string }> }) {
  const ctx = await requireClinic({ permission: "accounts:manage", module: "pharmacy" });
  const { tab: rawTab, q = "" } = await searchParams;
  const tab = rawTab === "suppliers" ? "suppliers" : "customers";
  const query = tab === "customers" ? q.slice(0, 100) : "";
  const data = await withClinic({ clinicId: ctx.clinicId, userId: ctx.userId }, async (tx) => ({
    currency: (await getClinicSettings(tx, ctx.clinicId)).currency,
    customers: await customerBalances(tx, query),
    suppliers: await supplierBalances(tx),
  }));
  const money = (v: string) => formatMoney(v, data.currency);
  const receivable = data.customers.reduce((s, c) => s + Math.max(0, toMinor(c.balance)), 0);
  const payable = data.suppliers.reduce((s, c) => s + Math.max(0, toMinor(c.owed)), 0);

  return (
    <PageShell>
      <PageHeader
        icon={Wallet}
        title="Pharmacy accounts"
        description="What customers owe on credit sales, and what the pharmacy owes its suppliers. Every balance is added up from the documents behind it."
        actions={tab === "customers" ? <CustomerDialog canSetCredit /> : undefined}
      />
      <div className="grid gap-5 sm:grid-cols-2">
        <StatCard
          label="Customers owe"
          value={money(fromMinor(receivable))}
          icon={Users}
          hint={`${data.customers.filter((c) => toMinor(c.balance) > 0).length} with a balance${query ? " (filtered)" : ""}`}
        />
        <StatCard label="Owed to suppliers" value={money(fromMinor(payable))} icon={Truck} hint={`${data.suppliers.filter((s) => toMinor(s.owed) > 0).length} suppliers`} />
      </div>
      <TabNav
        label="Accounts"
        active={tab}
        tabs={[
          { key: "customers", label: "Customers", href: "/pharmacy/accounts" },
          { key: "suppliers", label: "Suppliers", href: "/pharmacy/accounts?tab=suppliers" },
        ]}
      />

      {tab === "customers" ? (
        <Panel
          flush
          title="Customers"
          actions={
            <form className="relative w-64 max-w-full" action="/pharmacy/accounts">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" aria-hidden />
              <input type="search" name="q" defaultValue={query} aria-label="Find a customer" placeholder="Name or phone" className={cn(inputClass, "h-10 pl-9")} />
            </form>
          }
        >
          <DataTable
            rows={data.customers}
            rowKey={(c) => c.id}
            empty={<EmptyState icon={Users} title={query ? "No customer matches" : "No customers yet"} description="Customers are added at the counter for credit sales, or here." />}
            columns={[
              {
                key: "name",
                header: "Customer",
                cell: (c) => (
                  <Link href={`/pharmacy/accounts/customers/${c.id}`} className="group block">
                    <p className="flex items-center gap-2 font-medium text-zinc-900 group-hover:underline dark:text-zinc-100">
                      {c.gstin && <Building2 className="h-4 w-4 text-(--accent-text)" aria-label="GST registered" />}
                      {c.name}
                      {!c.isActive && <span className="text-xs font-normal text-zinc-500">(inactive)</span>}
                    </p>
                    <p className="text-xs text-zinc-500">{[c.phone, c.gstin].filter(Boolean).join(" · ") || "—"}</p>
                  </Link>
                ),
              },
              { key: "limit", header: "Credit limit", align: "right", hideOnMobile: true, cell: (c) => (c.creditLimit ? money(c.creditLimit) : "No limit") },
              {
                key: "balance",
                header: "Owes",
                align: "right",
                cell: (c) => <span className={cn("font-semibold tabular-nums", toMinor(c.balance) > 0 ? "text-amber-700 dark:text-amber-400" : "text-zinc-500")}>{money(c.balance)}</span>,
              },
            ]}
          />
        </Panel>
      ) : (
        <Panel flush title="Suppliers" description="Bills entered, less debit notes and payments.">
          <DataTable
            rows={data.suppliers}
            rowKey={(s) => s.id}
            empty={<EmptyState icon={Truck} title="No suppliers yet" />}
            columns={[
              {
                key: "name",
                header: "Supplier",
                cell: (s) => (
                  <Link href={`/pharmacy/accounts/suppliers/${s.id}`} className="group block">
                    <p className="font-medium text-zinc-900 group-hover:underline dark:text-zinc-100">{s.name}</p>
                    <p className="text-xs text-zinc-500">{[s.contactName, s.phone, s.taxId].filter(Boolean).join(" · ") || "—"}</p>
                  </Link>
                ),
              },
              {
                key: "owed",
                header: "Owed",
                align: "right",
                cell: (s) => <span className={cn("font-semibold tabular-nums", toMinor(s.owed) > 0 ? "text-amber-700 dark:text-amber-400" : "text-zinc-500")}>{money(s.owed)}</span>,
              },
            ]}
          />
        </Panel>
      )}
    </PageShell>
  );
}
