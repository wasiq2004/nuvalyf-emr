import "server-only";

// Suppliers and purchase orders: draft -> submitted -> approved (by someone
// holding purchase:approve, never the person who raised it) -> received.
// Receiving adds the stock through the ledger and is idempotent.
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import { drugs, purchaseOrderItems, purchaseOrders, suppliers, users } from "@/lib/db/schema";
import { AppError } from "@/lib/errors";
import { idempotent } from "@/lib/idempotency";
import { fromMinor, toMinor } from "@/lib/money";
import { nextCounter } from "@/features/patients/patients.service";
import { staffName } from "@/features/clinical/encounters.service";
import { receiveStock } from "./stock.service";

export type SupplierInput = { name: string; contactName?: string; phone?: string; email?: string; taxId?: string };

export function listSuppliers(tx: Tx) {
  return tx.select().from(suppliers).orderBy(asc(suppliers.name));
}

export async function saveSupplier(tx: Tx, clinicId: string, id: string | null, input: SupplierInput, isActive = true) {
  const values = {
    name: input.name,
    contactName: input.contactName ?? null,
    phone: input.phone ?? null,
    email: input.email ?? null,
    taxId: input.taxId ?? null,
    isActive,
  };
  if (id) {
    const [row] = await tx.update(suppliers).set(values).where(eq(suppliers.id, id)).returning({ id: suppliers.id });
    if (!row) throw new AppError("Supplier not found.");
    return row;
  }
  const [row] = await tx.insert(suppliers).values({ clinicId, ...values }).returning({ id: suppliers.id });
  return row;
}

async function lockOrder(tx: Tx, id: string) {
  const [row] = await tx.select().from(purchaseOrders).where(eq(purchaseOrders.id, id)).for("update").limit(1);
  if (!row) throw new AppError("Purchase order not found.");
  return row;
}

async function lockDraft(tx: Tx, id: string) {
  const row = await lockOrder(tx, id);
  if (row.status !== "draft") throw new AppError("Only a draft order can be changed.");
  return row;
}

export async function createOrder(tx: Tx, clinicId: string, supplierId: string, actorId: string) {
  const [supplier] = await tx.select().from(suppliers).where(and(eq(suppliers.id, supplierId), eq(suppliers.isActive, true))).limit(1);
  if (!supplier) throw new AppError("Choose an active supplier.");
  const number = `PO-${String(await nextCounter(tx, clinicId, "purchase_order")).padStart(6, "0")}`;
  const [row] = await tx.insert(purchaseOrders).values({ clinicId, number, supplierId, createdBy: actorId }).returning({ id: purchaseOrders.id });
  return { id: row.id, number };
}

export async function setOrderItem(tx: Tx, clinicId: string, orderId: string, input: { drugId: string; quantity: number; unitCost?: string }) {
  await lockDraft(tx, orderId);
  const [drug] = await tx.select({ id: drugs.id, name: drugs.name }).from(drugs).where(eq(drugs.id, input.drugId)).limit(1);
  if (!drug) throw new AppError("Medicine not found.");
  const unitCost = input.unitCost ? fromMinor(toMinor(input.unitCost)) : null;
  await tx
    .insert(purchaseOrderItems)
    .values({ clinicId, purchaseOrderId: orderId, drugId: input.drugId, quantity: input.quantity, unitCost })
    .onConflictDoUpdate({ target: [purchaseOrderItems.purchaseOrderId, purchaseOrderItems.drugId], set: { quantity: input.quantity, unitCost } });
  return { drugName: drug.name };
}

export async function removeOrderItem(tx: Tx, itemId: string) {
  const [item] = await tx.select().from(purchaseOrderItems).where(eq(purchaseOrderItems.id, itemId)).limit(1);
  if (!item) throw new AppError("Line not found.");
  await lockDraft(tx, item.purchaseOrderId);
  await tx.delete(purchaseOrderItems).where(eq(purchaseOrderItems.id, itemId));
  return { orderId: item.purchaseOrderId };
}

export async function submitOrder(tx: Tx, orderId: string) {
  const order = await lockDraft(tx, orderId);
  const items = await tx.select({ id: purchaseOrderItems.id }).from(purchaseOrderItems).where(eq(purchaseOrderItems.purchaseOrderId, orderId));
  if (items.length === 0) throw new AppError("Add at least one medicine before submitting.");
  await tx.update(purchaseOrders).set({ status: "submitted", submittedAt: new Date(), updatedAt: new Date() }).where(eq(purchaseOrders.id, orderId));
  return { number: order.number };
}

export async function decideOrder(tx: Tx, orderId: string, decision: "approved" | "rejected", note: string | undefined, actorId: string) {
  const order = await lockOrder(tx, orderId);
  if (order.status !== "submitted") throw new AppError("Only a submitted order can be approved or rejected.");
  if (order.createdBy === actorId) throw new AppError("Someone other than the person who raised an order must approve it.");
  if (decision === "rejected" && !note) throw new AppError("Give a reason for rejecting the order.");
  await tx
    .update(purchaseOrders)
    .set({ status: decision, decidedBy: actorId, decidedAt: new Date(), decisionNote: note ?? null, updatedAt: new Date() })
    .where(eq(purchaseOrders.id, orderId));
  return { number: order.number };
}

export async function cancelOrder(tx: Tx, orderId: string) {
  const order = await lockOrder(tx, orderId);
  if (!["draft", "submitted", "approved"].includes(order.status)) throw new AppError("This order can no longer be cancelled.");
  await tx.update(purchaseOrders).set({ status: "cancelled", updatedAt: new Date() }).where(eq(purchaseOrders.id, orderId));
  return { number: order.number };
}

export type ReceiptLine = { itemId: string; batchNo: string; expiryDate: string; quantity: number; unitCost?: string };

/** Books the delivery into stock, once - a retry returns the first result. */
export async function receiveOrder(tx: Tx, clinicId: string, orderId: string, lines: ReceiptLine[], key: string, actorId: string, today: string) {
  return idempotent(tx, { clinicId, name: "po-receive", key, input: { orderId, lines } }, async () => {
    const order = await lockOrder(tx, orderId);
    if (order.status !== "approved") throw new AppError("Only an approved order can be received.");
    const items = await tx.select().from(purchaseOrderItems).where(eq(purchaseOrderItems.purchaseOrderId, orderId));
    if (lines.length === 0 || lines.every((l) => l.quantity === 0)) throw new AppError("Enter what arrived.");
    for (const line of lines) {
      const item = items.find((i) => i.id === line.itemId);
      if (!item) throw new AppError("A line does not belong to this order.");
      if (line.quantity <= 0) continue;
      await receiveStock(
        tx,
        clinicId,
        {
          drugId: item.drugId,
          batchNo: line.batchNo,
          expiryDate: line.expiryDate,
          quantity: line.quantity,
          unitCost: line.unitCost ?? item.unitCost ?? undefined,
          reason: "receipt",
          sourceType: "purchase_order",
          sourceId: orderId,
        },
        actorId,
        today,
      );
      await tx
        .update(purchaseOrderItems)
        .set({ receivedQuantity: item.receivedQuantity + line.quantity })
        .where(eq(purchaseOrderItems.id, item.id));
    }
    await tx.update(purchaseOrders).set({ status: "received", receivedBy: actorId, receivedAt: new Date(), updatedAt: new Date() }).where(eq(purchaseOrders.id, orderId));
    return { number: order.number, lines: lines.filter((l) => l.quantity > 0).length };
  });
}

export async function listOrders(tx: Tx) {
  const rows = await tx
    .select({ order: purchaseOrders, supplier: suppliers.name })
    .from(purchaseOrders)
    .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
    .orderBy(desc(purchaseOrders.createdAt))
    .limit(200);
  return rows.map((r) => ({ ...r.order, supplierName: r.supplier }));
}

export async function getOrder(tx: Tx, id: string) {
  const [row] = await tx
    .select({ order: purchaseOrders, supplier: suppliers })
    .from(purchaseOrders)
    .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
    .where(eq(purchaseOrders.id, id))
    .limit(1);
  if (!row) return null;
  const items = await tx
    .select({ item: purchaseOrderItems, drugName: drugs.name, strength: drugs.strength, form: drugs.form })
    .from(purchaseOrderItems)
    .innerJoin(drugs, eq(drugs.id, purchaseOrderItems.drugId))
    .where(eq(purchaseOrderItems.purchaseOrderId, id))
    .orderBy(asc(drugs.name));
  const people = await tx
    .select({ id: users.id, title: users.title, firstName: users.firstName, lastName: users.lastName })
    .from(users)
    .where(inArray(users.id, [row.order.createdBy, row.order.decidedBy, row.order.receivedBy].filter((v): v is string => Boolean(v))));
  const name = (id: string | null) => {
    const p = people.find((x) => x.id === id);
    return p ? staffName(p) : null;
  };
  const total = items.reduce((sum, i) => sum + (i.item.unitCost ? toMinor(i.item.unitCost) * i.item.quantity : 0), 0);
  return {
    ...row.order,
    supplier: row.supplier,
    items: items.map((i) => ({ ...i.item, drugName: i.drugName, strength: i.strength, form: i.form })),
    createdByName: name(row.order.createdBy),
    decidedByName: name(row.order.decidedBy),
    receivedByName: name(row.order.receivedBy),
    estimatedTotal: fromMinor(total),
  };
}
