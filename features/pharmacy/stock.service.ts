import "server-only";

// Stock: batches per medicine and the movement ledger. Quantities only ever
// change by inserting a movement (the database applies it and refuses
// anything that would take a batch below zero).
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import { drugs, stockBatches, stockMovements, users } from "@/lib/db/schema";
import { AppError, pgError } from "@/lib/errors";
import { staffName } from "@/features/clinical/encounters.service";
import { isExpired, stockFlags, type StockFlag } from "./stock-rules";

export type MovementReason = "opening" | "receipt" | "sale" | "dispense" | "adjustment" | "expired" | "damaged" | "return";

/** Inserts a ledger row; maps "would go below zero" to a clear message. */
export async function moveStock(
  tx: Tx,
  clinicId: string,
  input: { drugId: string; batchId: string; change: number; reason: MovementReason; sourceType?: string; sourceId?: string; note?: string },
  actorId: string,
) {
  try {
    await tx.insert(stockMovements).values({
      clinicId,
      drugId: input.drugId,
      batchId: input.batchId,
      change: input.change,
      reason: input.reason,
      sourceType: input.sourceType ?? null,
      sourceId: input.sourceId ?? null,
      note: input.note ?? null,
      actorId,
    });
  } catch (error) {
    if (pgError(error)?.code === "23514") throw new AppError("Not enough stock in that batch.");
    throw error;
  }
}

export type StockRow = {
  drugId: string;
  name: string;
  genericName: string;
  form: string;
  strength: string | null;
  price: string | null;
  reorderLevel: number;
  isActive: boolean;
  onHand: number;
  nearestExpiry: string | null;
  flags: StockFlag[];
};

export async function listStock(tx: Tx, today: string, now = new Date()): Promise<StockRow[]> {
  const drugRows = await tx.select().from(drugs).orderBy(asc(drugs.name));
  const batches = await tx.select().from(stockBatches);
  const moved = await tx
    .select({
      drugId: stockMovements.drugId,
      lastOut: sql<Date | null>`max(${stockMovements.createdAt}) filter (where ${stockMovements.change} < 0)`,
      firstIn: sql<Date | null>`min(${stockMovements.createdAt}) filter (where ${stockMovements.change} > 0)`,
    })
    .from(stockMovements)
    .groupBy(stockMovements.drugId);
  const movedBy = new Map(moved.map((m) => [m.drugId, m]));

  return drugRows
    .map((d) => {
      const own = batches.filter((b) => b.drugId === d.id);
      const onHand = own.reduce((sum, b) => sum + b.quantity, 0);
      const held = own.filter((b) => b.quantity > 0 && !isExpired(b.expiryDate, today)).sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));
      const m = movedBy.get(d.id);
      const last = m?.lastOut ?? m?.firstIn ?? null;
      return {
        drugId: d.id,
        name: d.name,
        genericName: d.genericName,
        form: d.form,
        strength: d.strength,
        price: d.price,
        reorderLevel: d.reorderLevel,
        isActive: d.isActive,
        onHand,
        nearestExpiry: held[0]?.expiryDate ?? null,
        flags: stockFlags({ onHand, reorderLevel: d.reorderLevel, batches: own, lastMovedAt: last ? new Date(last) : null, today, now }),
      };
    })
    // Inactive medicines only matter while stock remains.
    .filter((row) => row.isActive || row.onHand > 0);
}

export async function getDrugStock(tx: Tx, drugId: string) {
  const [drug] = await tx.select().from(drugs).where(eq(drugs.id, drugId)).limit(1);
  if (!drug) return null;
  const batches = await tx.select().from(stockBatches).where(eq(stockBatches.drugId, drugId)).orderBy(asc(stockBatches.expiryDate));
  const movements = await tx
    .select({ m: stockMovements, batchNo: stockBatches.batchNo, title: users.title, firstName: users.firstName, lastName: users.lastName })
    .from(stockMovements)
    .innerJoin(stockBatches, eq(stockBatches.id, stockMovements.batchId))
    .innerJoin(users, eq(users.id, stockMovements.actorId))
    .where(eq(stockMovements.drugId, drugId))
    .orderBy(desc(stockMovements.createdAt))
    .limit(100);
  return { drug, batches, movements: movements.map((r) => ({ ...r.m, batchNo: r.batchNo, actorName: staffName(r) })) };
}

/** Usable batches for these medicines, earliest expiry first. */
export async function batchesFor(tx: Tx, drugIds: string[]) {
  if (drugIds.length === 0) return [];
  return tx
    .select()
    .from(stockBatches)
    .where(and(inArray(stockBatches.drugId, drugIds), sql`${stockBatches.quantity} > 0`))
    .orderBy(asc(stockBatches.expiryDate));
}

export type ReceiveInput = {
  drugId: string;
  batchNo: string;
  expiryDate: string;
  quantity: number;
  unitCost?: string;
  reason: "opening" | "receipt" | "return";
  sourceType?: string;
  sourceId?: string;
  note?: string;
};

/** Adds stock to a batch (creating the batch the first time it is seen). */
export async function receiveStock(tx: Tx, clinicId: string, input: ReceiveInput, actorId: string, today: string) {
  const [drug] = await tx.select().from(drugs).where(eq(drugs.id, input.drugId)).limit(1);
  if (!drug) throw new AppError("Medicine not found.");
  if (isExpired(input.expiryDate, today)) throw new AppError(`Batch ${input.batchNo} has already expired.`);

  const batchNo = input.batchNo.trim().toUpperCase();
  await tx
    .insert(stockBatches)
    .values({ clinicId, drugId: input.drugId, batchNo, expiryDate: input.expiryDate, unitCost: input.unitCost ?? null })
    .onConflictDoNothing();
  const [batch] = await tx
    .select()
    .from(stockBatches)
    .where(and(eq(stockBatches.drugId, input.drugId), eq(stockBatches.batchNo, batchNo), eq(stockBatches.expiryDate, input.expiryDate)))
    .limit(1);
  await moveStock(
    tx,
    clinicId,
    { drugId: input.drugId, batchId: batch.id, change: input.quantity, reason: input.reason, sourceType: input.sourceType, sourceId: input.sourceId, note: input.note },
    actorId,
  );
  return { batchId: batch.id, drugName: drug.name, batchNo };
}

/** A counted correction, or stock written off as expired / damaged. */
export async function adjustStock(
  tx: Tx,
  clinicId: string,
  input: { batchId: string; change: number; reason: "adjustment" | "expired" | "damaged"; note: string },
  actorId: string,
) {
  const [batch] = await tx.select().from(stockBatches).where(eq(stockBatches.id, input.batchId)).for("update").limit(1);
  if (!batch) throw new AppError("Batch not found.");
  if (input.reason !== "adjustment" && input.change > 0) throw new AppError("Write-offs remove stock.");
  if (batch.quantity + input.change < 0) throw new AppError(`Batch ${batch.batchNo} only has ${batch.quantity}.`);
  await moveStock(tx, clinicId, { drugId: batch.drugId, batchId: batch.id, change: input.change, reason: input.reason, note: input.note }, actorId);
  return { drugId: batch.drugId, batchNo: batch.batchNo };
}

export async function setReorderLevel(tx: Tx, drugId: string, level: number) {
  const [row] = await tx.update(drugs).set({ reorderLevel: level, updatedAt: new Date() }).where(eq(drugs.id, drugId)).returning({ id: drugs.id, name: drugs.name });
  if (!row) throw new AppError("Medicine not found.");
  return row;
}
