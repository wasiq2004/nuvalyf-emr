import "server-only";

// Named pharmacy customers and what they owe (docs/PHARMACY_DESIGN.md 4.4).
// A balance is never stored: it is what was owed on moving to NuvaLyf + credit
// sales - credit notes put back on the account - receipts, summed from the
// documents each time.
import { and, asc, desc, eq, ilike, or, sql } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import { accountOpenings, customerReceipts, patients, pharmacyCustomers, pharmacySales, saleReturns, users } from "@/lib/db/schema";
import { AppError, isUniqueViolation } from "@/lib/errors";
import { fromMinor, toMinor } from "@/lib/money";
import { displayPatientName } from "@/features/patients/patient-rules";
import { nextCounter } from "@/features/patients/patients.service";
import { staffName } from "@/features/clinical/encounters.service";
import { stateOfGstin } from "./gst-rules";
import { counterKey, documentNumber, fiscalYear } from "./numbering";

export type CustomerInput = {
  name: string;
  phone?: string;
  address?: string;
  gstin?: string;
  stateCode?: string;
  creditLimit?: string;
};

export type CustomerRow = typeof pharmacyCustomers.$inferSelect;

export async function listCustomers(tx: Tx, query = "", limit = 50) {
  const term = query.trim().replace(/[%_\\]/g, "");
  const where = term ? or(ilike(pharmacyCustomers.name, `%${term}%`), ilike(pharmacyCustomers.phone, `%${term}%`), ilike(pharmacyCustomers.gstin, `%${term}%`)) : undefined;
  return tx.select().from(pharmacyCustomers).where(where).orderBy(desc(pharmacyCustomers.isActive), asc(pharmacyCustomers.name)).limit(limit);
}

export async function getCustomer(tx: Tx, id: string) {
  const [row] = await tx.select().from(pharmacyCustomers).where(eq(pharmacyCustomers.id, id)).limit(1);
  return row ?? null;
}

export async function saveCustomer(tx: Tx, clinicId: string, id: string | null, input: CustomerInput, isActive = true) {
  const gstin = input.gstin?.toUpperCase() || null;
  const values = {
    name: input.name,
    phone: input.phone || null,
    address: input.address || null,
    gstin,
    stateCode: input.stateCode || stateOfGstin(gstin),
    creditLimit: input.creditLimit || null,
    isActive,
  };
  if (id) {
    const [row] = await tx.update(pharmacyCustomers).set(values).where(eq(pharmacyCustomers.id, id)).returning({ id: pharmacyCustomers.id });
    if (!row) throw new AppError("Customer not found.");
    return row;
  }
  const [row] = await tx.insert(pharmacyCustomers).values({ clinicId, ...values }).returning({ id: pharmacyCustomers.id });
  return row;
}

/** The customer record for a registered patient, created the first time. */
export async function ensurePatientCustomer(tx: Tx, clinicId: string, patientId: string) {
  const [existing] = await tx.select().from(pharmacyCustomers).where(eq(pharmacyCustomers.patientId, patientId)).limit(1);
  if (existing) return existing;
  const [patient] = await tx.select().from(patients).where(eq(patients.id, patientId)).limit(1);
  if (!patient) throw new AppError("Patient not found.");
  try {
    const [row] = await tx
      .insert(pharmacyCustomers)
      .values({
        clinicId,
        patientId,
        name: displayPatientName(patient),
        phone: patient.mobile,
        address: [patient.addressLine, patient.city].filter(Boolean).join(", ") || null,
      })
      .returning();
    return row;
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const [row] = await tx.select().from(pharmacyCustomers).where(eq(pharmacyCustomers.patientId, patientId)).limit(1);
    return row;
  }
}

/** What each customer owes, in paise (positive = owes the pharmacy). */
const balanceSql = sql<string>`(
  coalesce((select sum(o.amount) from app.account_openings o where o.customer_id = ${sql.raw('"pharmacy_customers"."id"')}), 0)
  + coalesce((select sum(s.total) from app.pharmacy_sales s where s.customer_id = ${sql.raw('"pharmacy_customers"."id"')} and s.method = 'credit'), 0)
  - coalesce((select sum(r.total) from app.sale_returns r join app.pharmacy_sales s2 on s2.id = r.sale_id where s2.customer_id = ${sql.raw('"pharmacy_customers"."id"')} and r.refund_method = 'account'), 0)
  - coalesce((select sum(r.total) from app.sale_returns r where r.customer_id = ${sql.raw('"pharmacy_customers"."id"')} and r.sale_id is null and r.refund_method = 'account'), 0)
  - coalesce((select sum(c.amount) from app.customer_receipts c where c.customer_id = ${sql.raw('"pharmacy_customers"."id"')}), 0)
)::numeric(12,2)::text`;

export async function customerBalance(tx: Tx, customerId: string): Promise<number> {
  const [row] = await tx.select({ balance: balanceSql }).from(pharmacyCustomers).where(eq(pharmacyCustomers.id, customerId)).limit(1);
  if (!row) throw new AppError("Customer not found.");
  return toMinor(row.balance);
}

export async function customerBalances(tx: Tx, query = "") {
  const term = query.trim().replace(/[%_\\]/g, "");
  const rows = await tx
    .select({ customer: pharmacyCustomers, balance: balanceSql })
    .from(pharmacyCustomers)
    .where(term ? or(ilike(pharmacyCustomers.name, `%${term}%`), ilike(pharmacyCustomers.phone, `%${term}%`)) : undefined)
    .orderBy(desc(sql`(${balanceSql})::numeric`), asc(pharmacyCustomers.name))
    .limit(200);
  return rows.map((r) => ({ ...r.customer, balance: r.balance }));
}

export type LedgerEntry = { date: Date; kind: "opening" | "sale" | "return" | "receipt"; number: string; id: string; debit: string; credit: string; note: string | null };

/** Every document on the account, oldest first, with a running balance. */
export async function customerLedger(tx: Tx, customerId: string) {
  const sales = await tx
    .select({ id: pharmacySales.id, number: pharmacySales.number, date: pharmacySales.soldAt, total: pharmacySales.total })
    .from(pharmacySales)
    .where(and(eq(pharmacySales.customerId, customerId), eq(pharmacySales.method, "credit")));
  const returns = await tx
    .select({ id: saleReturns.id, number: saleReturns.number, date: saleReturns.createdAt, total: saleReturns.total, kind: saleReturns.kind })
    .from(saleReturns)
    .innerJoin(pharmacySales, eq(pharmacySales.id, saleReturns.saleId))
    .where(and(eq(pharmacySales.customerId, customerId), eq(saleReturns.refundMethod, "account")));
  const oldBillReturns = await tx
    .select({ id: saleReturns.id, number: saleReturns.number, date: saleReturns.createdAt, total: saleReturns.total, oldBillNo: saleReturns.oldBillNo })
    .from(saleReturns)
    .where(and(eq(saleReturns.customerId, customerId), eq(saleReturns.refundMethod, "account")));
  const openings = await tx.select().from(accountOpenings).where(eq(accountOpenings.customerId, customerId));
  const receipts = await tx
    .select({ id: customerReceipts.id, number: customerReceipts.number, date: customerReceipts.createdAt, amount: customerReceipts.amount, method: customerReceipts.method, reference: customerReceipts.reference, title: users.title, firstName: users.firstName, lastName: users.lastName })
    .from(customerReceipts)
    .innerJoin(users, eq(users.id, customerReceipts.receivedBy))
    .where(eq(customerReceipts.customerId, customerId));
  const entries: LedgerEntry[] = [
    ...openings.map((o) => {
      const owed = toMinor(o.amount) > 0;
      return { date: o.createdAt, kind: "opening" as const, number: o.reference ?? "Opening", id: o.id, debit: owed ? o.amount : "0.00", credit: owed ? "0.00" : o.amount.replace("-", ""), note: [`Opening balance as of ${o.asOf}`, o.note].filter(Boolean).join(" · ") };
    }),
    ...oldBillReturns.map((r) => ({ date: r.date, kind: "return" as const, number: r.number, id: r.id, debit: "0.00", credit: r.total, note: `Items returned, old bill ${r.oldBillNo}` })),
    ...sales.map((s) => ({ date: s.date, kind: "sale" as const, number: s.number, id: s.id, debit: s.total, credit: "0.00", note: "Credit sale" })),
    ...returns.map((r) => ({ date: r.date, kind: "return" as const, number: r.number, id: r.id, debit: "0.00", credit: r.total, note: r.kind === "cancellation" ? "Sale cancelled" : "Items returned" })),
    ...receipts.map((r) => ({ date: r.date, kind: "receipt" as const, number: r.number, id: r.id, debit: "0.00", credit: r.amount, note: `${r.method.toUpperCase()}${r.reference ? ` ${r.reference}` : ""} · ${staffName(r)}` })),
  ].sort((a, b) => a.date.getTime() - b.date.getTime());
  let running = 0;
  return entries.map((e) => {
    running += toMinor(e.debit) - toMinor(e.credit);
    return { ...e, balance: fromMinor(running) };
  });
}

export type ReceiptInput = { customerId: string; amount: string; method: string; reference?: string; note?: string };

/** Money received against the balance; never more than is owed. */
export async function recordReceipt(tx: Tx, clinicId: string, input: ReceiptInput, actorId: string, today: string) {
  const [customer] = await tx.select().from(pharmacyCustomers).where(eq(pharmacyCustomers.id, input.customerId)).for("update").limit(1);
  if (!customer) throw new AppError("Customer not found.");
  const owed = await customerBalance(tx, customer.id);
  const amount = toMinor(input.amount);
  if (amount <= 0) throw new AppError("Enter the amount received.");
  if (amount > owed) throw new AppError(`${customer.name} owes ${fromMinor(Math.max(0, owed))}; a receipt cannot be more than that.`);
  const fy = fiscalYear(today);
  const number = documentNumber("receipt", fy, await nextCounter(tx, clinicId, counterKey("receipt", fy)));
  const [row] = await tx
    .insert(customerReceipts)
    .values({ clinicId, number, customerId: customer.id, amount: fromMinor(amount), method: input.method, reference: input.reference || null, note: input.note || null, receivedBy: actorId })
    .returning({ id: customerReceipts.id });
  return { id: row.id, number, customerName: customer.name, balance: fromMinor(owed - amount) };
}
