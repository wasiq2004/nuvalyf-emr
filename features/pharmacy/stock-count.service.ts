import "server-only";

// Counting the shelves. Stock is counted blind: neither the screen nor the
// sheet shows what the system expects. Saving a count records the ledger's
// figure at that moment, unseen, so anything sold afterwards cannot read as a
// shortage and the pharmacy need not close to count. Differences are recounted,
// explained and posted through the ledger in one step.
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import { drugs, stockBatches, stockCountLines, stockCounts, users } from "@/lib/db/schema";
import { AppError, isUniqueViolation } from "@/lib/errors";
import { nextCounter } from "@/features/patients/patients.service";
import { addDaysToDateString } from "@/lib/time";
import { CONTROLLED_COUNT_DAYS, COUNT_REASONS, CYCLE_SIZE, difference, lineProblem, movementReason, pickCycleItems, type CountReason } from "./stock-count-rules";
import { ensureBatch, moveStock } from "./stock.service";

export type StartCountInput = { scope: "all" | "rack" | "cycle"; rack?: string };

async function cycleItems(tx: Tx, today: string) {
  const rows = await tx.execute(sql`
    select d.id as "drugId", d.schedule,
           (select max(c.posted_at)::date::text from app.stock_count_lines l join app.stock_counts c on c.id = l.count_id
            where l.drug_id = d.id and c.status = 'posted' and l.first_count is not null) as "lastCounted",
           coalesce((select sum(-m.change) from app.stock_movements m where m.drug_id = d.id and m.reason in ('sale', 'dispense') and m.created_at >= ${addDaysToDateString(today, -30)}::date), 0)::int as "unitsSold"
    from app.drugs d
    where exists (select 1 from app.stock_batches b where b.drug_id = d.id and b.quantity > 0)`);
  return pickCycleItems(rows as unknown as Parameters<typeof pickCycleItems>[0], CYCLE_SIZE, addDaysToDateString(today, -CONTROLLED_COUNT_DAYS));
}

export async function startCount(tx: Tx, clinicId: string, input: StartCountInput, actorId: string, today: string) {
  const [open] = await tx.select({ number: stockCounts.number }).from(stockCounts).where(inArray(stockCounts.status, ["counting", "review"])).limit(1);
  if (open) throw new AppError(`${open.number} is still open. Post or cancel it first: two open counts would both correct the same stock.`);

  const rack = input.rack?.trim() ?? "";
  if (input.scope === "rack" && !rack) throw new AppError("Choose a rack.");
  const picked = input.scope === "cycle" ? await cycleItems(tx, today) : null;
  const held = await tx
    .select({ batchId: stockBatches.id, drugId: stockBatches.drugId })
    .from(stockBatches)
    .innerJoin(drugs, eq(drugs.id, stockBatches.drugId))
    .where(and(sql`${stockBatches.quantity} > 0`, input.scope === "rack" ? eq(drugs.rack, rack) : undefined, picked ? inArray(stockBatches.drugId, picked.length ? picked : ["00000000-0000-0000-0000-000000000000"]) : undefined));
  if (held.length === 0) throw new AppError("There is no stock to count there.");

  const number = `SC-${String(await nextCounter(tx, clinicId, "stock_count")).padStart(6, "0")}`;
  const scopeLabel = input.scope === "all" ? "Whole pharmacy" : input.scope === "rack" ? `Rack ${rack}` : `Daily count (${new Set(held.map((h) => h.drugId)).size} items)`;
  try {
    const [count] = await tx.insert(stockCounts).values({ clinicId, number, scope: input.scope, scopeLabel, createdBy: actorId }).returning({ id: stockCounts.id });
    await tx.insert(stockCountLines).values(held.map((h) => ({ clinicId, countId: count.id, drugId: h.drugId, batchId: h.batchId })));
    return { id: count.id, number, lines: held.length, scopeLabel };
  } catch (error) {
    if (isUniqueViolation(error)) throw new AppError("Another count was just started. Open it from the list.");
    throw error;
  }
}

export async function listCounts(tx: Tx, limit = 30) {
  return tx
    .select({
      count: stockCounts,
      lines: sql<number>`(select count(*) from app.stock_count_lines l where l.count_id = ${stockCounts.id})::int`,
      counted: sql<number>`(select count(*) from app.stock_count_lines l where l.count_id = ${stockCounts.id} and l.first_count is not null)::int`,
      moved: sql<number>`(select count(*) from app.stock_count_lines l where l.count_id = ${stockCounts.id} and coalesce(l.posted_change, 0) <> 0)::int`,
    })
    .from(stockCounts)
    .orderBy(desc(stockCounts.createdAt))
    .limit(limit)
    .then((rows) => rows.map((r) => ({ ...r.count, lines: r.lines, counted: r.counted, moved: r.moved })));
}

async function loadLines(tx: Tx, countId: string) {
  const rows = await tx
    .select({
      line: stockCountLines,
      name: drugs.name,
      form: drugs.form,
      rack: drugs.rack,
      schedule: drugs.schedule,
      itemPack: drugs.packSize,
      batch: stockBatches,
      firstByName: sql<string | null>`(select trim(concat_ws(' ', u.title, u.first_name, u.last_name)) from app.users u where u.id = ${stockCountLines.firstBy})`,
      recountByName: sql<string | null>`(select trim(concat_ws(' ', u.title, u.first_name, u.last_name)) from app.users u where u.id = ${stockCountLines.recountBy})`,
    })
    .from(stockCountLines)
    .innerJoin(drugs, eq(drugs.id, stockCountLines.drugId))
    .innerJoin(stockBatches, eq(stockBatches.id, stockCountLines.batchId))
    .where(eq(stockCountLines.countId, countId))
    .orderBy(sql`${drugs.rack} nulls last`, asc(drugs.name), asc(stockBatches.expiryDate));
  return rows;
}

export async function getCountHeader(tx: Tx, id: string) {
  const [row] = await tx
    .select({ count: stockCounts, title: users.title, firstName: users.firstName, lastName: users.lastName })
    .from(stockCounts)
    .innerJoin(users, eq(users.id, stockCounts.createdBy))
    .where(eq(stockCounts.id, id))
    .limit(1);
  return row ? { ...row.count, createdByName: [row.title, row.firstName, row.lastName].filter(Boolean).join(" ") } : null;
}

export type BlindLine = { id: string; name: string; form: string; rack: string | null; schedule: string; packSize: number; batchNo: string; expiryDate: string; found: boolean; firstCount: number | null };

/** The lines for counting. No system figure leaves the server here. */
export async function blindLines(tx: Tx, countId: string): Promise<BlindLine[]> {
  return (await loadLines(tx, countId)).map((r) => ({
    id: r.line.id,
    name: r.name,
    form: r.form,
    rack: r.rack,
    schedule: r.schedule,
    packSize: r.itemPack,
    batchNo: r.batch.batchNo,
    expiryDate: r.batch.expiryDate,
    found: r.line.found,
    firstCount: r.line.firstCount,
  }));
}

/** The lines with the ledger's figures, once counting is finished. */
export async function reviewLines(tx: Tx, countId: string) {
  return (await loadLines(tx, countId)).map((r) => ({
    ...r.line,
    name: r.name,
    form: r.form,
    rack: r.rack,
    schedule: r.schedule,
    packSize: r.itemPack,
    batchNo: r.batch.batchNo,
    expiryDate: r.batch.expiryDate,
    unitCost: r.batch.unitCost,
    packCost: r.batch.packCost,
    batchPackSize: r.batch.packSize,
    mrp: r.batch.mrp,
    firstByName: r.firstByName,
    recountByName: r.recountByName,
    change: difference(r.line),
  }));
}

async function openCount(tx: Tx, id: string, status: "counting" | "review") {
  const [count] = await tx.select().from(stockCounts).where(eq(stockCounts.id, id)).for("update").limit(1);
  if (!count) throw new AppError("Stock count not found.");
  if (count.status !== status) throw new AppError(status === "counting" ? "Counting on this sheet has finished." : "This count is not waiting for review.");
  return count;
}

/** Locks batches in a fixed order, like a sale, so a count cannot deadlock with one. */
async function batchesFor(tx: Tx, batchIds: string[]) {
  if (batchIds.length === 0) return new Map<string, number>();
  const rows = await tx.select({ id: stockBatches.id, quantity: stockBatches.quantity }).from(stockBatches).where(inArray(stockBatches.id, [...new Set(batchIds)].sort())).orderBy(asc(stockBatches.id)).for("update");
  return new Map(rows.map((r) => [r.id, r.quantity]));
}

/** Saves what was counted. A blank clears a line; an unchanged figure keeps its moment. */
export async function saveCounts(tx: Tx, countId: string, entries: { lineId: string; counted: number | null }[], actorId: string) {
  await openCount(tx, countId, "counting");
  const lines = entries.length ? await tx.select().from(stockCountLines).where(and(eq(stockCountLines.countId, countId), inArray(stockCountLines.id, entries.map((e) => e.lineId)))) : [];
  const changed = lines.flatMap((line) => {
    const entry = entries.find((e) => e.lineId === line.id);
    return entry && entry.counted !== line.firstCount ? [{ line, counted: entry.counted }] : [];
  });
  const quantities = await batchesFor(tx, changed.map((c) => c.line.batchId));
  const now = new Date();
  for (const { line, counted } of changed) {
    await tx
      .update(stockCountLines)
      .set(counted === null ? { firstCount: null, firstSystem: null, firstBy: null, firstAt: null } : { firstCount: counted, firstSystem: quantities.get(line.batchId) ?? 0, firstBy: actorId, firstAt: now })
      .where(eq(stockCountLines.id, line.id));
  }
  return { saved: changed.length };
}

export type FoundBatchInput = { countId: string; drugId: string; batchNo: string; expiryDate: string; counted: number };

/** Stock on the shelf that the sheet did not list: often a batch never entered. */
export async function addFoundBatch(tx: Tx, clinicId: string, input: FoundBatchInput, actorId: string) {
  await openCount(tx, input.countId, "counting");
  const [drug] = await tx.select({ name: drugs.name }).from(drugs).where(eq(drugs.id, input.drugId)).limit(1);
  if (!drug) throw new AppError("Item not found.");
  const batch = await ensureBatch(tx, clinicId, input);
  const quantities = await batchesFor(tx, [batch.id]);
  const [listed] = await tx.select({ id: stockCountLines.id }).from(stockCountLines).where(and(eq(stockCountLines.countId, input.countId), eq(stockCountLines.batchId, batch.id))).limit(1);
  if (listed) throw new AppError(`${drug.name} batch ${batch.batchNo} is already on this count.`);
  await tx.insert(stockCountLines).values({ clinicId, countId: input.countId, drugId: input.drugId, batchId: batch.id, found: true, firstCount: input.counted, firstSystem: quantities.get(batch.id) ?? 0, firstBy: actorId, firstAt: new Date() });
  return { name: drug.name, batchNo: batch.batchNo };
}

export async function submitCount(tx: Tx, countId: string, actorId: string) {
  const count = await openCount(tx, countId, "counting");
  const [{ counted }] = await tx.select({ counted: sql<number>`count(*)::int` }).from(stockCountLines).where(and(eq(stockCountLines.countId, countId), sql`${stockCountLines.firstCount} is not null`));
  if (counted === 0) throw new AppError("Nothing has been counted yet.");
  await tx.update(stockCounts).set({ status: "review", submittedBy: actorId, submittedAt: new Date() }).where(eq(stockCounts.id, countId));
  return { number: count.number, counted };
}

export type ReviewEntry = { lineId: string; recount: number | null; reason: CountReason | null; note: string | null };

export async function saveReview(tx: Tx, countId: string, entries: ReviewEntry[], actorId: string) {
  await openCount(tx, countId, "review");
  const lines = entries.length ? await tx.select().from(stockCountLines).where(and(eq(stockCountLines.countId, countId), inArray(stockCountLines.id, entries.map((e) => e.lineId)))) : [];
  const recounted = lines.filter((line) => entries.find((e) => e.lineId === line.id)?.recount !== line.recount);
  const quantities = await batchesFor(tx, recounted.map((l) => l.batchId));
  const now = new Date();
  for (const line of lines) {
    const entry = entries.find((e) => e.lineId === line.id)!;
    const again = entry.recount !== line.recount;
    await tx
      .update(stockCountLines)
      .set({
        reason: entry.reason,
        note: entry.note,
        ...(again ? (entry.recount === null ? { recount: null, recountSystem: null, recountBy: null, recountAt: null } : { recount: entry.recount, recountSystem: quantities.get(line.batchId) ?? 0, recountBy: actorId, recountAt: now }) : {}),
      })
      .where(eq(stockCountLines.id, line.id));
  }
}

/** Moves every difference through the ledger, all together or not at all. */
export async function postCount(tx: Tx, clinicId: string, countId: string, actorId: string) {
  const count = await openCount(tx, countId, "review");
  const rows = await loadLines(tx, countId);
  for (const r of rows) {
    const problem = lineProblem({ ...r.line, name: r.name, batchNo: r.batch.batchNo });
    if (problem) throw new AppError(problem);
  }
  const moves = rows.flatMap((r) => {
    const change = difference(r.line);
    return change ? [{ r, change }] : [];
  });
  const quantities = await batchesFor(tx, moves.map((m) => m.r.line.batchId));
  let shortage = 0;
  let excess = 0;
  for (const { r, change } of moves) {
    // A batch sold down since it was counted can still be short by more than is left.
    if ((quantities.get(r.line.batchId) ?? 0) + change < 0) throw new AppError(`${r.name} batch ${r.batch.batchNo}: only ${quantities.get(r.line.batchId) ?? 0} left. Recount it.`);
    const reason = r.line.reason as CountReason;
    await moveStock(
      tx,
      clinicId,
      {
        drugId: r.line.drugId,
        batchId: r.line.batchId,
        change,
        reason: movementReason(reason, change),
        sourceType: "stock_count",
        sourceId: count.id,
        note: [`Stock count ${count.number}: ${COUNT_REASONS[reason]}`, r.line.note].filter(Boolean).join(". ").slice(0, 300),
      },
      actorId,
    );
    await tx.update(stockCountLines).set({ postedChange: change }).where(eq(stockCountLines.id, r.line.id));
    if (change < 0) shortage += -change;
    else excess += change;
  }
  await tx.update(stockCounts).set({ status: "posted", postedBy: actorId, postedAt: new Date() }).where(eq(stockCounts.id, count.id));
  return { number: count.number, adjusted: moves.length, shortage, excess };
}

export async function cancelCount(tx: Tx, countId: string) {
  const [count] = await tx.select().from(stockCounts).where(eq(stockCounts.id, countId)).for("update").limit(1);
  if (!count) throw new AppError("Stock count not found.");
  if (count.status !== "counting" && count.status !== "review") throw new AppError("This count is already closed.");
  await tx.update(stockCounts).set({ status: "cancelled" }).where(eq(stockCounts.id, count.id));
  return { number: count.number };
}

export async function racksInUse(tx: Tx) {
  const rows = await tx.selectDistinct({ rack: drugs.rack }).from(drugs).innerJoin(stockBatches, eq(stockBatches.drugId, drugs.id)).where(sql`${stockBatches.quantity} > 0 and ${drugs.rack} is not null`).orderBy(asc(drugs.rack));
  return rows.map((r) => r.rack!);
}
