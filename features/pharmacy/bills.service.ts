import "server-only";

// Supplier bills: the paper bill typed in once. Saving books every line into
// stock through the ledger (units = (qty + free) x pack size), records the
// bill permanently and learns any new spelling of an item the person
// confirmed. All of it happens in one transaction, once per form (idempotent).
import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import { drugs, purchaseBillItems, purchaseBills, suppliers, users } from "@/lib/db/schema";
import { AppError, isUniqueViolation } from "@/lib/errors";
import { idempotent } from "@/lib/idempotency";
import { nextCounter } from "@/features/patients/patients.service";
import { staffName } from "@/features/clinical/encounters.service";
import { addAlias, nameIndex } from "@/features/catalog/items.service";
import { billTotals, duplicateLines, lineTotals } from "./purchase-rules";
import { receiveStock } from "./stock.service";

export type BillLine = {
  drugId: string;
  /** The name as printed on the bill. */
  description: string;
  batchNo: string;
  expiryDate: string;
  quantity: number;
  freeQuantity: number;
  packSize: number;
  rate: string;
  mrp?: string;
  gstRate: number;
  /** Remember `description` as another name of the item. */
  rememberName: boolean;
};

export type BillInput = {
  supplierId: string;
  billNo: string;
  billDate: string;
  notes?: string;
  /** Set each item's selling prices (per unit, and per pack) from the MRP on this bill. */
  updatePrices: boolean;
  lines: BillLine[];
  idempotencyKey: string;
};

export async function enterBill(tx: Tx, clinicId: string, input: BillInput, actorId: string, today: string) {
  return idempotent(tx, { clinicId, name: "purchase-bill", key: input.idempotencyKey, input: { ...input, idempotencyKey: undefined } }, async () => {
    const [supplier] = await tx.select().from(suppliers).where(and(eq(suppliers.id, input.supplierId), eq(suppliers.isActive, true))).limit(1);
    if (!supplier) throw new AppError("Choose an active supplier.");
    if (input.billDate > today) throw new AppError("The bill date is in the future.");
    if (input.lines.length === 0) throw new AppError("Add at least one line.");
    const dupes = duplicateLines(input.lines);
    if (dupes.length) throw new AppError(`Line ${dupes[0] + 1} repeats an earlier line (same item, batch and expiry). Put the quantities on one line.`);

    const billNo = input.billNo.trim().toUpperCase();
    const [existing] = await tx
      .select({ number: purchaseBills.number })
      .from(purchaseBills)
      .where(and(eq(purchaseBills.supplierId, supplier.id), eq(purchaseBills.billNo, billNo)))
      .limit(1);
    if (existing) throw new AppError(`Bill ${billNo} from ${supplier.name} is already entered (${existing.number}).`);

    const totals = billTotals(input.lines);
    const number = `PB-${String(await nextCounter(tx, clinicId, "purchase_bill")).padStart(6, "0")}`;
    let bill: { id: string };
    try {
      [bill] = await tx
        .insert(purchaseBills)
        .values({
          clinicId,
          number,
          supplierId: supplier.id,
          billNo,
          billDate: input.billDate,
          subtotal: totals.subtotal,
          taxTotal: totals.tax,
          total: totals.total,
          notes: input.notes ?? null,
          enteredBy: actorId,
        })
        .returning({ id: purchaseBills.id });
    } catch (error) {
      if (isUniqueViolation(error)) throw new AppError(`Bill ${billNo} from ${supplier.name} is already entered.`);
      throw error;
    }

    const index = await nameIndex(tx);
    const learned: string[] = [];
    for (const [i, line] of input.lines.entries()) {
      const [item] = await tx.select().from(drugs).where(eq(drugs.id, line.drugId)).limit(1);
      if (!item) throw new AppError(`Line ${i + 1}: item not found.`);
      const t = lineTotals(line);
      const received = await receiveStock(
        tx,
        clinicId,
        {
          drugId: item.id,
          batchNo: line.batchNo,
          expiryDate: line.expiryDate,
          quantity: t.units,
          unitCost: t.unitCost,
          reason: "receipt",
          sourceType: "purchase_bill",
          sourceId: bill.id,
          note: `${supplier.name} bill ${billNo}`,
        },
        actorId,
        today,
      );
      await tx.insert(purchaseBillItems).values({
        clinicId,
        billId: bill.id,
        drugId: item.id,
        batchId: received.batchId,
        description: line.description.trim().slice(0, 200) || item.name,
        batchNo: received.batchNo,
        expiryDate: line.expiryDate,
        quantity: line.quantity,
        freeQuantity: line.freeQuantity,
        packSize: line.packSize,
        rate: line.rate,
        mrp: line.mrp ?? null,
        gstRate: String(line.gstRate),
        amount: t.amount,
        taxAmount: t.taxAmount,
        units: t.units,
      });

      // Remember how this supplier names the item, and how it is packed.
      if (line.rememberName && line.description.trim()) {
        try {
          const added = await addAlias(tx, clinicId, { drugId: item.id, alias: line.description, manufacturer: null }, actorId, index);
          if (added) learned.push(`${added.alias} → ${added.itemName}`);
        } catch (error) {
          if (!(error instanceof AppError)) throw error;
          throw new AppError(`Line ${i + 1}: ${error.message} Untick "remember this name" for that line.`);
        }
      }
      const updates: Partial<typeof drugs.$inferInsert> = {};
      if (line.packSize !== item.packSize) updates.packSize = line.packSize;
      if (input.updatePrices && t.unitMrp && line.mrp) {
        if (t.unitMrp !== item.price) updates.price = t.unitMrp;
        // A strip sells at exactly its printed MRP, not units x a rounded unit price.
        const packPrice = line.packSize > 1 ? line.mrp : null;
        if (packPrice !== item.packPrice) updates.packPrice = packPrice;
      }
      if (Object.keys(updates).length) await tx.update(drugs).set({ ...updates, updatedAt: new Date() }).where(eq(drugs.id, item.id));
    }

    return { billId: bill.id, number, lines: input.lines.length, units: totals.units, total: totals.total, learned };
  });
}

export async function listBills(tx: Tx, limit = 100) {
  const rows = await tx
    .select({
      bill: purchaseBills,
      supplier: suppliers.name,
      lines: sql<number>`(select count(*) from ${purchaseBillItems} i where i.bill_id = ${purchaseBills.id})::int`,
    })
    .from(purchaseBills)
    .innerJoin(suppliers, eq(suppliers.id, purchaseBills.supplierId))
    .orderBy(desc(purchaseBills.billDate), desc(purchaseBills.createdAt))
    .limit(limit);
  return rows.map((r) => ({ ...r.bill, supplierName: r.supplier, lineCount: r.lines }));
}

export async function getBill(tx: Tx, id: string) {
  const [row] = await tx
    .select({ bill: purchaseBills, supplier: suppliers, title: users.title, firstName: users.firstName, lastName: users.lastName })
    .from(purchaseBills)
    .innerJoin(suppliers, eq(suppliers.id, purchaseBills.supplierId))
    .innerJoin(users, eq(users.id, purchaseBills.enteredBy))
    .where(eq(purchaseBills.id, id))
    .limit(1);
  if (!row) return null;
  const items = await tx
    .select({ item: purchaseBillItems, itemName: drugs.name, itemType: drugs.itemType })
    .from(purchaseBillItems)
    .innerJoin(drugs, eq(drugs.id, purchaseBillItems.drugId))
    .where(eq(purchaseBillItems.billId, id))
    .orderBy(asc(drugs.name));
  return {
    ...row.bill,
    supplier: row.supplier,
    enteredByName: staffName(row),
    items: items.map((i) => ({ ...i.item, itemName: i.itemName, itemType: i.itemType })),
  };
}
