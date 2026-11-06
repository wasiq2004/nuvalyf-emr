import "server-only";

// The supplier side (docs/PHARMACY_DESIGN.md 4.3 and 4.4): debit notes for
// stock sent back (typically expired or damaged), payments, and what each
// supplier is owed = opening balance + bills - debit notes - payments, summed
// from documents.
import { asc, desc, eq, gt, inArray, sql } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import { accountOpenings, drugs, purchaseBillItems, purchaseBills, purchaseReturnItems, purchaseReturns, stockBatches, supplierPayments, suppliers, users } from "@/lib/db/schema";
import { AppError } from "@/lib/errors";
import { idempotent } from "@/lib/idempotency";
import { fromMinor, toMinor } from "@/lib/money";
import { nextCounter } from "@/features/patients/patients.service";
import { staffName } from "@/features/clinical/encounters.service";
import { counterKey, documentNumber, fiscalYear } from "./numbering";
import { purchaseReturnValue } from "./return-rules";
import { moveStock } from "./stock.service";
import { isExpired } from "./stock-rules";

/** Batches that can go back: anything on hand, expired first, with the supplier it came from. */
export async function returnableBatches(tx: Tx, today: string) {
  const rows = await tx
    .select({
      batch: stockBatches,
      drugName: drugs.name,
      form: drugs.form,
      gstRate: drugs.gstRate,
      lastSupplierId: sql<string | null>`(select b.supplier_id from app.purchase_bill_items i join app.purchase_bills b on b.id = i.bill_id where i.batch_id = ${sql.raw('"stock_batches"."id"')} order by b.bill_date desc limit 1)`,
      billRate: sql<string | null>`(select i.gst_rate from app.purchase_bill_items i where i.batch_id = ${sql.raw('"stock_batches"."id"')} order by i.id desc limit 1)`,
    })
    .from(stockBatches)
    .innerJoin(drugs, eq(drugs.id, stockBatches.drugId))
    .where(gt(stockBatches.quantity, 0))
    .orderBy(asc(stockBatches.expiryDate), asc(drugs.name));
  return rows.map((r) => ({
    batchId: r.batch.id,
    drugId: r.batch.drugId,
    drugName: r.drugName,
    form: r.form,
    batchNo: r.batch.batchNo,
    expiryDate: r.batch.expiryDate,
    expired: isExpired(r.batch.expiryDate, today),
    onHand: r.batch.quantity,
    unitCost: r.batch.unitCost,
    gstRate: r.billRate ?? r.gstRate ?? "0",
    supplierId: r.lastSupplierId,
  }));
}

export type PurchaseReturnInput = {
  supplierId: string;
  reason: string;
  lines: { batchId: string; quantity: number }[];
  idempotencyKey: string;
};

export async function createPurchaseReturn(tx: Tx, clinicId: string, input: PurchaseReturnInput, actorId: string, today: string) {
  return idempotent(tx, { clinicId, name: "purchase-return", key: input.idempotencyKey, input: { ...input, idempotencyKey: undefined } }, async () => {
    const [supplier] = await tx.select().from(suppliers).where(eq(suppliers.id, input.supplierId)).limit(1);
    if (!supplier) throw new AppError("Supplier not found.");
    const wanted = input.lines.filter((l) => l.quantity > 0);
    if (wanted.length === 0) throw new AppError("Choose what is going back.");
    if (new Set(wanted.map((l) => l.batchId)).size !== wanted.length) throw new AppError("Each batch can appear once.");

    // Lock in a fixed order, like sales, so concurrent stock changes cannot deadlock.
    const ids = wanted.map((l) => l.batchId).sort();
    const batches = await tx.select().from(stockBatches).where(inArray(stockBatches.id, ids)).orderBy(asc(stockBatches.id)).for("update");
    const items = await tx.select().from(drugs).where(inArray(drugs.id, batches.map((b) => b.drugId)));
    const billLines = await tx
      .select({ batchId: purchaseBillItems.batchId, id: purchaseBillItems.id, gstRate: purchaseBillItems.gstRate, billId: purchaseBillItems.billId })
      .from(purchaseBillItems)
      .where(inArray(purchaseBillItems.batchId, ids))
      .orderBy(desc(purchaseBillItems.id));

    const lines = wanted.map((l) => {
      const batch = batches.find((b) => b.id === l.batchId);
      if (!batch) throw new AppError("A batch was not found.");
      const item = items.find((d) => d.id === batch.drugId)!;
      if (l.quantity > batch.quantity) throw new AppError(`${item.name} batch ${batch.batchNo}: only ${batch.quantity} on hand.`);
      const billLine = billLines.find((b) => b.batchId === batch.id);
      const gstRate = Number(billLine?.gstRate ?? item.gstRate ?? 0);
      const unitCost = toMinor(batch.unitCost ?? "0");
      const value = purchaseReturnValue(unitCost, l.quantity, gstRate);
      return { batch, item, quantity: l.quantity, unitCost, gstRate, billLine, ...value };
    });
    const billIds = [...new Set(lines.map((l) => l.billLine?.billId).filter(Boolean))];
    const taxable = lines.reduce((s, l) => s + l.taxable, 0);
    const tax = lines.reduce((s, l) => s + l.tax, 0);

    const fy = fiscalYear(today);
    const number = documentNumber("debitNote", fy, await nextCounter(tx, clinicId, counterKey("debitNote", fy)));
    const [note] = await tx
      .insert(purchaseReturns)
      .values({
        clinicId,
        number,
        fiscalYear: fy,
        supplierId: supplier.id,
        billId: billIds.length === 1 ? billIds[0]! : null,
        reason: input.reason,
        taxable: fromMinor(taxable),
        taxTotal: fromMinor(tax),
        total: fromMinor(taxable + tax),
        createdBy: actorId,
      })
      .returning({ id: purchaseReturns.id });
    await tx.insert(purchaseReturnItems).values(
      lines.map((l) => ({
        clinicId,
        returnId: note.id,
        drugId: l.item.id,
        batchId: l.batch.id,
        billItemId: l.billLine?.id ?? null,
        quantity: l.quantity,
        unitCost: fromMinor(l.unitCost),
        gstRate: String(l.gstRate),
        taxable: fromMinor(l.taxable),
        tax: fromMinor(l.tax),
      })),
    );
    for (const l of lines) {
      await moveStock(
        tx,
        clinicId,
        { drugId: l.item.id, batchId: l.batch.id, change: -l.quantity, reason: "supplier_return", sourceType: "purchase_return", sourceId: note.id, note: `${supplier.name}: ${input.reason}`.slice(0, 300) },
        actorId,
      );
    }
    return { returnId: note.id, number, supplierName: supplier.name, total: fromMinor(taxable + tax), units: lines.reduce((n, l) => n + l.quantity, 0) };
  });
}

export async function listPurchaseReturns(tx: Tx, limit = 100) {
  const rows = await tx
    .select({ note: purchaseReturns, supplier: suppliers.name })
    .from(purchaseReturns)
    .innerJoin(suppliers, eq(suppliers.id, purchaseReturns.supplierId))
    .orderBy(desc(purchaseReturns.createdAt))
    .limit(limit);
  return rows.map((r) => ({ ...r.note, supplierName: r.supplier }));
}

export async function getPurchaseReturn(tx: Tx, id: string) {
  const [row] = await tx
    .select({ note: purchaseReturns, supplier: suppliers, title: users.title, firstName: users.firstName, lastName: users.lastName })
    .from(purchaseReturns)
    .innerJoin(suppliers, eq(suppliers.id, purchaseReturns.supplierId))
    .innerJoin(users, eq(users.id, purchaseReturns.createdBy))
    .where(eq(purchaseReturns.id, id))
    .limit(1);
  if (!row) return null;
  const items = await tx
    .select({ line: purchaseReturnItems, drugName: drugs.name, batchNo: stockBatches.batchNo, expiryDate: stockBatches.expiryDate })
    .from(purchaseReturnItems)
    .innerJoin(drugs, eq(drugs.id, purchaseReturnItems.drugId))
    .innerJoin(stockBatches, eq(stockBatches.id, purchaseReturnItems.batchId))
    .where(eq(purchaseReturnItems.returnId, id))
    .orderBy(asc(drugs.name));
  return { ...row.note, supplier: row.supplier, createdByName: staffName(row), items: items.map((i) => ({ ...i.line, drugName: i.drugName, batchNo: i.batchNo, expiryDate: i.expiryDate })) };
}

/** What the pharmacy owes each supplier (positive = owes the supplier). */
const owedSql = sql<string>`(
  coalesce((select sum(o.amount) from app.account_openings o where o.supplier_id = ${sql.raw('"suppliers"."id"')}), 0)
  + coalesce((select sum(b.total) from app.purchase_bills b where b.supplier_id = ${sql.raw('"suppliers"."id"')}), 0)
  - coalesce((select sum(r.total) from app.purchase_returns r where r.supplier_id = ${sql.raw('"suppliers"."id"')}), 0)
  - coalesce((select sum(p.amount) from app.supplier_payments p where p.supplier_id = ${sql.raw('"suppliers"."id"')}), 0)
)::numeric(12,2)::text`;

export async function supplierBalances(tx: Tx) {
  const rows = await tx.select({ supplier: suppliers, owed: owedSql }).from(suppliers).orderBy(desc(sql`(${owedSql})::numeric`), asc(suppliers.name));
  return rows.map((r) => ({ ...r.supplier, owed: r.owed }));
}

export async function supplierBalance(tx: Tx, supplierId: string): Promise<number> {
  const [row] = await tx.select({ owed: owedSql }).from(suppliers).where(eq(suppliers.id, supplierId)).limit(1);
  if (!row) throw new AppError("Supplier not found.");
  return toMinor(row.owed);
}

/** Bills, debit notes and payments, oldest first, with what is owed after each. */
export async function supplierLedger(tx: Tx, supplierId: string) {
  const bills = await tx
    .select({ id: purchaseBills.id, number: purchaseBills.number, billNo: purchaseBills.billNo, date: purchaseBills.createdAt, total: purchaseBills.total })
    .from(purchaseBills)
    .where(eq(purchaseBills.supplierId, supplierId));
  const notes = await tx
    .select({ id: purchaseReturns.id, number: purchaseReturns.number, date: purchaseReturns.createdAt, total: purchaseReturns.total, reason: purchaseReturns.reason })
    .from(purchaseReturns)
    .where(eq(purchaseReturns.supplierId, supplierId));
  const payments = await tx
    .select({ id: supplierPayments.id, number: supplierPayments.number, date: supplierPayments.createdAt, amount: supplierPayments.amount, method: supplierPayments.method, reference: supplierPayments.reference })
    .from(supplierPayments)
    .where(eq(supplierPayments.supplierId, supplierId));
  const openings = await tx.select().from(accountOpenings).where(eq(accountOpenings.supplierId, supplierId));
  const entries = [
    ...openings.map((o) => {
      const owed = toMinor(o.amount) > 0;
      return { kind: "opening" as const, id: o.id, number: o.reference ?? "Opening", date: o.createdAt, credit: owed ? o.amount : "0.00", debit: owed ? "0.00" : o.amount.replace("-", ""), note: [`Opening balance as of ${o.asOf}`, o.note].filter(Boolean).join(" · ") };
    }),
    ...bills.map((b) => ({ kind: "bill" as const, id: b.id, number: b.number, date: b.date, credit: b.total, debit: "0.00", note: `Bill ${b.billNo}` })),
    ...notes.map((n) => ({ kind: "debit_note" as const, id: n.id, number: n.number, date: n.date, credit: "0.00", debit: n.total, note: n.reason })),
    ...payments.map((p) => ({ kind: "payment" as const, id: p.id, number: p.number, date: p.date, credit: "0.00", debit: p.amount, note: `${p.method.toUpperCase()}${p.reference ? ` ${p.reference}` : ""}` })),
  ].sort((a, b) => a.date.getTime() - b.date.getTime());
  let running = 0;
  return entries.map((e) => {
    running += toMinor(e.credit) - toMinor(e.debit);
    return { ...e, owed: fromMinor(running) };
  });
}

export type SupplierPaymentInput = { supplierId: string; amount: string; method: string; reference?: string; note?: string };

/** Money paid to a supplier; never more than is owed. */
export async function recordSupplierPayment(tx: Tx, clinicId: string, input: SupplierPaymentInput, actorId: string, today: string) {
  const [supplier] = await tx.select().from(suppliers).where(eq(suppliers.id, input.supplierId)).for("update").limit(1);
  if (!supplier) throw new AppError("Supplier not found.");
  const owed = await supplierBalance(tx, supplier.id);
  const amount = toMinor(input.amount);
  if (amount <= 0) throw new AppError("Enter the amount paid.");
  if (amount > owed) throw new AppError(`${supplier.name} is owed ${fromMinor(Math.max(0, owed))}; a payment cannot be more than that.`);
  const fy = fiscalYear(today);
  const number = documentNumber("payment", fy, await nextCounter(tx, clinicId, counterKey("payment", fy)));
  const [row] = await tx
    .insert(supplierPayments)
    .values({ clinicId, number, supplierId: supplier.id, amount: fromMinor(amount), method: input.method, reference: input.reference || null, note: input.note || null, paidBy: actorId })
    .returning({ id: supplierPayments.id });
  return { id: row.id, number, supplierName: supplier.name, owed: fromMinor(owed - amount) };
}

