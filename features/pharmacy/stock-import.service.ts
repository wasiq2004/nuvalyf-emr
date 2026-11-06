import "server-only";

// Items and opening stock from a spreadsheet: check everything, then create
// the new items, their other names and every batch in one transaction - or
// nothing. A row whose name (or other name) is already in the clinic's list
// adds stock to that item instead of creating a duplicate.
//
// Opening stock is loaded once. A batch already in stock is refused, because
// a second upload of the file (or a corrected copy) would otherwise add every
// quantity again. A wrong load is taken out with reverseStockImport; a wrong
// quantity after that is a stock count, never another upload.
import { randomUUID } from "crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import { drugs, idempotencyKeys, importJobs, stockBatches, stockMovements } from "@/lib/db/schema";
import { AppError } from "@/lib/errors";
import { idempotent } from "@/lib/idempotency";
import { fromMinor, toMinor } from "@/lib/money";
import { createDrug } from "@/features/catalog/catalog.service";
import { addAlias, nameIndex } from "@/features/catalog/items.service";
import { normalizeItemName } from "@/features/catalog/item-rules";
import { parseCsv, validateStockRows, type QuantityBasis, type StockImportProblem, type StockImportRow } from "./stock-import-rules";
import { packWord, unitWord } from "./selling-rules";
import { costValue, mrpValue } from "./stock-rules";
import { moveStock, receiveStock } from "./stock.service";

export type StockImportReport = {
  rows: number;
  newItems: number;
  existingItems: number;
  batches: number;
  units: number;
  basis: QuantityBasis;
  /** Control totals, to set against the old software's closing stock. */
  costValue: string;
  mrpValue: string;
  /** Batches the totals leave out, for want of a cost or an MRP. */
  missingCost: number;
  missingMrp: number;
  expiredBatches: number;
  expiredUnits: number;
  /** A few lines spelled out, so a file of strips cannot pass as tablets unseen. */
  examples: string[];
  problems: StockImportProblem[];
};

/** A row's stock, in the only terms the ledger knows: single units. */
type Stocked = {
  row: StockImportRow;
  batch: NonNullable<StockImportRow["batch"]>;
  drugId: string | null;
  packSize: number;
  units: number;
  unitCost: string | null;
  packCost: string | null;
  mrp: string | null;
};

type Resolved = {
  rowCount: number;
  rows: StockImportRow[];
  stocked: Stocked[];
  problems: StockImportProblem[];
  existing: Map<string, string>;
  newItems: Map<string, number>;
  /** Units per pack of each new item, from the first row that states it. */
  newPackSizes: Map<string, number>;
};

async function resolve(tx: Tx, csv: string, today: string, basis: QuantityBasis): Promise<Resolved> {
  const parsed = parseCsv(csv);
  const { valid, problems } = validateStockRows(parsed, today, basis);
  const index = await nameIndex(tx);

  // Item key (normalised name) -> existing item id, or a new item.
  const existing = new Map<string, string>();
  const newItems = new Map<string, number>();
  const newPackSizes = new Map<string, number>();
  for (const row of valid) {
    const hit = index.get(row.normalized);
    if (hit) existing.set(row.normalized, hit.drugId);
    else {
      if (!newItems.has(row.normalized)) {
        newItems.set(row.normalized, row.line);
        if (row.itemType === "medicine" && !row.genericName) {
          problems.push({ line: row.line, field: "genericName", message: `${row.name} is new: a medicine needs its generic name` });
        }
      }
      if (row.packSizeGiven) {
        const size = newPackSizes.get(row.normalized);
        if (size !== undefined && size !== row.packSize) problems.push({ line: row.line, field: "packSize", message: `${row.name} has ${size} units per pack on an earlier line` });
        else newPackSizes.set(row.normalized, row.packSize);
      }
    }
    // Another name must not already belong to a different item.
    for (const other of row.otherNames) {
      const owner = index.get(normalizeItemName(other));
      const self = existing.get(row.normalized);
      if (owner && owner.drugId !== self) {
        problems.push({ line: row.line, field: "otherNames", message: `"${other}" is already the name of ${owner.name}` });
      }
    }
  }

  const existingIds = [...new Set(existing.values())];
  const sizes = existingIds.length ? await tx.select({ id: drugs.id, packSize: drugs.packSize }).from(drugs).where(inArray(drugs.id, existingIds)) : [];
  const sizeOf = new Map(sizes.map((s) => [s.id, s.packSize]));

  const stocked: Stocked[] = [];
  const seen = new Map<string, number>();
  for (const row of valid) {
    const drugId = existing.get(row.normalized) ?? null;
    const packSize = drugId ? (sizeOf.get(drugId) ?? 1) : (newPackSizes.get(row.normalized) ?? 1);
    if (drugId && row.packSizeGiven && row.packSize !== packSize) {
      problems.push({ line: row.line, field: "packSize", message: `${row.name} has ${packSize} units per pack in your list, not ${row.packSize}. Quantities and MRPs would not match` });
    }
    const batch = row.batch;
    if (!batch) continue;
    if (basis === "packs" && !drugId && !newPackSizes.has(row.normalized)) {
      problems.push({ line: row.line, field: "packSize", message: `${row.name}: quantities are in packs, so units per pack is needed` });
    }
    if (basis === "packs" && batch.loose >= packSize && packSize > 1) {
      problems.push({ line: row.line, field: "quantity", message: `${batch.loose} loose is a full pack or more of ${packSize}` });
    }

    // Two names of one item in a file are still one item.
    const key = `${drugId ?? row.normalized}|${batch.batchNo}|${batch.expiryDate}`;
    const earlier = seen.get(key);
    if (earlier !== undefined) problems.push({ line: row.line, field: "batchNo", message: `Same item, batch and expiry as line ${earlier}` });
    else seen.set(key, row.line);

    const packCost = batch.packCost;
    const mrp = row.packPrice ?? (packSize === 1 ? row.price : null);
    stocked.push({
      row,
      batch,
      drugId,
      packSize,
      units: basis === "packs" ? batch.packs * packSize + batch.loose : batch.quantity,
      unitCost: batch.unitCost ?? (packCost ? fromMinor(Math.round(toMinor(packCost) / packSize)) : null),
      packCost,
      mrp,
    });
  }

  problems.sort((a, b) => a.line - b.line);
  const bad = new Set(problems.map((p) => p.line));
  return { rowCount: Math.max(0, parsed.length - 1), rows: valid.filter((r) => !bad.has(r.line)), stocked: stocked.filter((s) => !bad.has(s.row.line)), problems, existing, newItems, newPackSizes };
}

const valued = (s: Stocked) => ({ quantity: s.units, unitCost: s.unitCost, packCost: s.packCost, packSize: s.packCost || s.mrp ? s.packSize : null, mrp: s.mrp });

function totalsOf(stocked: Stocked[]) {
  let cost = 0;
  let mrp = 0;
  let missingCost = 0;
  let missingMrp = 0;
  for (const s of stocked) {
    const atCost = costValue(valued(s));
    const atMrp = mrpValue(valued(s), s.packSize);
    if (atCost === null) missingCost += 1;
    else cost += atCost;
    if (atMrp === null) missingMrp += 1;
    else mrp += atMrp;
  }
  return { costValue: fromMinor(cost), mrpValue: fromMinor(mrp), missingCost, missingMrp };
}

function exampleOf(s: Stocked, basis: QuantityBasis): string {
  const form = s.row.form;
  const units = `${s.units} ${unitWord(form, s.units)}`;
  if (basis === "units" || s.packSize < 2) return `${s.row.name}, batch ${s.batch.batchNo}: ${units}`;
  const loose = s.batch.loose ? ` and ${s.batch.loose} loose` : "";
  return `${s.row.name}, batch ${s.batch.batchNo}: ${s.batch.packs} ${packWord(form, s.batch.packs)}${loose} of ${s.packSize} = ${units}`;
}

/** Batches in this file that already hold stock, or came in on an import not reversed. */
async function alreadyLoaded(tx: Tx, stocked: Stocked[]): Promise<StockImportProblem[]> {
  const ids = [...new Set(stocked.map((s) => s.drugId).filter((id): id is string => id !== null))];
  if (ids.length === 0) return [];
  const rows = await tx
    .select({
      drugId: stockBatches.drugId,
      batchNo: stockBatches.batchNo,
      expiryDate: stockBatches.expiryDate,
      quantity: stockBatches.quantity,
      imported: sql<number>`coalesce((select sum(m.change) from app.stock_movements m where m.batch_id = ${sql.raw('"stock_batches"."id"')} and m.source_type in ('import', 'import_reversal')), 0)::int`,
    })
    .from(stockBatches)
    .where(inArray(stockBatches.drugId, ids));
  const problems: StockImportProblem[] = [];
  for (const s of stocked) {
    const found = rows.find((r) => r.drugId === s.drugId && r.batchNo === s.batch.batchNo && r.expiryDate === s.batch.expiryDate);
    if (!found || (found.quantity === 0 && found.imported === 0)) continue;
    problems.push({
      line: s.row.line,
      field: "batchNo",
      message: `${s.row.name} batch ${s.batch.batchNo} is already in stock (${found.quantity} on hand). Loading it again would add to that. Correct a quantity with a stock count, or reverse the earlier import`,
    });
  }
  return problems;
}

type Plan = { report: StockImportReport; resolved: Resolved };

async function plan(tx: Tx, csv: string, today: string, basis: QuantityBasis): Promise<Plan> {
  const resolved = await resolve(tx, csv, today, basis);
  resolved.problems.push(...(await alreadyLoaded(tx, resolved.stocked)));
  resolved.problems.sort((a, b) => a.line - b.line);
  const { stocked } = resolved;
  const expired = stocked.filter((s) => s.batch.expired);
  return {
    resolved,
    report: {
      rows: resolved.rowCount,
      newItems: resolved.newItems.size,
      existingItems: resolved.existing.size,
      batches: stocked.length,
      units: stocked.reduce((n, s) => n + s.units, 0),
      basis,
      ...totalsOf(stocked),
      expiredBatches: expired.length,
      expiredUnits: expired.reduce((n, s) => n + s.units, 0),
      examples: stocked.slice(0, 3).map((s) => exampleOf(s, basis)),
      problems: resolved.problems,
    },
  };
}

/** The report without changing anything. */
export async function checkStockImport(tx: Tx, csv: string, today: string, basis: QuantityBasis = "units") {
  return (await plan(tx, csv, today, basis)).report;
}

/** True once this form's import has gone through: a retry returns that result. */
export async function stockImportDone(tx: Tx, key: string) {
  const [row] = await tx.select({ key: idempotencyKeys.key }).from(idempotencyKeys).where(and(eq(idempotencyKeys.scope, "stock-import"), eq(idempotencyKeys.key, key))).limit(1);
  return Boolean(row);
}

export async function runStockImport(tx: Tx, clinicId: string, input: { fileName: string; csv: string; basis?: QuantityBasis; idempotencyKey: string }, actorId: string, today: string) {
  const basis = input.basis ?? "units";
  return idempotent(tx, { clinicId, name: "stock-import", key: input.idempotencyKey, input: { fileName: input.fileName, csv: input.csv, basis } }, async () => {
    // Two people uploading at once must each see what the other loaded.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`stock-import:${clinicId}`}, 0))`);
    const { report, resolved } = await plan(tx, input.csv, today, basis);
    if (report.problems.length > 0) throw new AppError(`Nothing was imported: ${report.problems.length} problem(s) in the file. Fix them and try again.`);
    if (resolved.rows.length === 0) throw new AppError("The file has no item rows.");

    // Batches of one item can carry different MRPs. The item keeps the highest,
    // and each batch's own MRP brings its price down from there.
    const highestMrp = new Map<string, string>();
    for (const s of resolved.stocked) {
      const best = highestMrp.get(s.row.normalized);
      if (s.mrp && (!best || toMinor(s.mrp) > toMinor(best))) highestMrp.set(s.row.normalized, s.mrp);
    }

    const jobId = randomUUID();
    const ids = new Map(resolved.existing);
    const index = await nameIndex(tx);
    const stockedByLine = new Map(resolved.stocked.map((s) => [s.row.line, s]));
    for (const row of resolved.rows) {
      let drugId = ids.get(row.normalized);
      if (!drugId) {
        const packSize = resolved.newPackSizes.get(row.normalized) ?? row.packSize;
        const packPrice = highestMrp.get(row.normalized) ?? row.packPrice;
        const created = await createDrug(tx, clinicId, {
          name: row.name,
          itemType: row.itemType,
          genericName: row.genericName ?? undefined,
          form: row.form,
          strength: row.strength ?? undefined,
          category: row.category ?? undefined,
          manufacturer: row.manufacturer ?? undefined,
          packSize,
          price: row.price ?? (packPrice ? fromMinor(Math.floor(toMinor(packPrice) / packSize)) : undefined),
          packPrice: packSize > 1 ? (packPrice ?? undefined) : undefined,
          hsn: row.hsn ?? undefined,
          gstRate: row.gstRate,
          schedule: row.schedule,
          rack: row.rack ?? undefined,
          barcode: row.barcode ?? undefined,
          defaultDurationDays: null,
          allergyClassIds: [],
        });
        drugId = created.id;
        ids.set(row.normalized, drugId);
        index.set(row.normalized, { drugId, name: row.name, via: "name" });
      }
      for (const other of row.otherNames) {
        await addAlias(tx, clinicId, { drugId, alias: other, manufacturer: row.manufacturer }, actorId, index);
      }
      const stocked = stockedByLine.get(row.line);
      if (stocked) {
        await receiveStock(
          tx,
          clinicId,
          {
            drugId,
            batchNo: stocked.batch.batchNo,
            expiryDate: stocked.batch.expiryDate,
            quantity: stocked.units,
            unitCost: stocked.unitCost ?? undefined,
            packCost: stocked.packCost ?? undefined,
            mrp: stocked.mrp ?? undefined,
            packSize: stocked.mrp || stocked.packCost ? stocked.packSize : undefined,
            reason: "opening",
            sourceType: "import",
            sourceId: jobId,
            note: input.fileName.slice(0, 200),
          },
          actorId,
          today,
        );
      }
    }
    const summary = {
      basis,
      batches: report.batches,
      units: report.units,
      costValue: report.costValue,
      mrpValue: report.mrpValue,
      missingCost: report.missingCost,
      missingMrp: report.missingMrp,
      expiredUnits: report.expiredUnits,
      newItems: report.newItems,
    };
    await tx.insert(importJobs).values({ id: jobId, clinicId, kind: "stock", fileName: input.fileName, rowCount: report.rows, imported: resolved.rows.length, status: "imported", summary, createdBy: actorId });
    return { jobId, newItems: report.newItems, batches: report.batches, units: report.units };
  });
}

/**
 * Takes a load back out, for a file found to be wrong (strips read as tablets,
 * the wrong branch's export). Only while nothing has touched those batches:
 * after a sale, a count corrects what is there. Items stay; they are harmless
 * and a corrected file matches them by name.
 */
export async function reverseStockImport(tx: Tx, clinicId: string, jobId: string, note: string, actorId: string) {
  const [job] = await tx.select().from(importJobs).where(and(eq(importJobs.id, jobId), eq(importJobs.kind, "stock"))).for("update").limit(1);
  if (!job) throw new AppError("Import not found.");
  if (job.status !== "imported") throw new AppError("Only a completed import can be reversed.");
  const loaded = await tx
    .select()
    .from(stockMovements)
    .where(and(eq(stockMovements.sourceType, "import"), eq(stockMovements.sourceId, job.id)));
  if (loaded.length === 0) throw new AppError("This import added no stock that can be reversed.");

  const batchIds = [...new Set(loaded.map((m) => m.batchId))].sort();
  const batches = await tx.select().from(stockBatches).where(inArray(stockBatches.id, batchIds)).orderBy(stockBatches.id).for("update");
  const others = await tx
    .select({ batchId: stockMovements.batchId, n: sql<number>`count(*)::int` })
    .from(stockMovements)
    .where(and(inArray(stockMovements.batchId, batchIds), sql`(${stockMovements.sourceId} is distinct from ${job.id})`))
    .groupBy(stockMovements.batchId);
  if (others.length > 0) {
    const names = batches.filter((b) => others.some((o) => o.batchId === b.id)).slice(0, 5).map((b) => b.batchNo);
    throw new AppError(`${others.length} batch(es) have moved since this import (${names.join(", ")}). Correct what is on the shelf with a stock count instead.`);
  }

  for (const movement of loaded) {
    await moveStock(tx, clinicId, { drugId: movement.drugId, batchId: movement.batchId, change: -movement.change, reason: "adjustment", sourceType: "import_reversal", sourceId: job.id, note: `Import reversed: ${note}`.slice(0, 300) }, actorId);
  }
  await tx.update(importJobs).set({ status: "reversed", reversedNote: note }).where(eq(importJobs.id, job.id));
  return { fileName: job.fileName, batches: batchIds.length, units: loaded.reduce((n, m) => n + m.change, 0) };
}

export type StockDifference = { line: number; name: string; batchNo: string; expiryDate: string; file: number; system: number };
export type StockComparison = {
  basis: QuantityBasis;
  problems: StockImportProblem[];
  matched: number;
  fileUnits: number;
  systemUnits: number;
  fileCost: string;
  systemCost: string;
  /** In both, at different quantities. */
  different: StockDifference[];
  /** In the file, not in stock here. */
  missing: StockDifference[];
  /** In stock here, not in the file. */
  extra: { name: string; batchNo: string; expiryDate: string; system: number }[];
};

/**
 * The old software's closing stock, line by line, against what is here now.
 * Grand totals can agree while two batches are wrong in opposite directions.
 * Changes nothing, so it can be run as often as it takes.
 */
export async function compareStock(tx: Tx, csv: string, today: string, basis: QuantityBasis): Promise<StockComparison> {
  const resolved = await resolve(tx, csv, today, basis);
  const empty = { basis, problems: resolved.problems, matched: 0, fileUnits: 0, systemUnits: 0, fileCost: "0.00", systemCost: "0.00", different: [], missing: [], extra: [] };
  if (resolved.problems.length > 0) return empty;

  const held = await tx
    .select({ batch: stockBatches, name: drugs.name, itemPack: drugs.packSize })
    .from(stockBatches)
    .innerJoin(drugs, eq(drugs.id, stockBatches.drugId))
    .where(sql`${stockBatches.quantity} > 0`);
  const key = (drugId: string | null, batchNo: string, expiry: string) => `${drugId}|${batchNo}|${expiry}`;
  const byKey = new Map(held.map((h) => [key(h.batch.drugId, h.batch.batchNo, h.batch.expiryDate), h]));

  const different: StockDifference[] = [];
  const missing: StockDifference[] = [];
  const counted = new Set<string>();
  let matched = 0;
  for (const s of resolved.stocked) {
    const k = key(s.drugId, s.batch.batchNo, s.batch.expiryDate);
    const here = s.drugId ? byKey.get(k) : undefined;
    const line = { line: s.row.line, name: s.row.name, batchNo: s.batch.batchNo, expiryDate: s.batch.expiryDate, file: s.units, system: here?.batch.quantity ?? 0 };
    counted.add(k);
    if (!here) missing.push(line);
    else if (here.batch.quantity !== s.units) different.push(line);
    else matched += 1;
  }
  const extra = held
    .filter((h) => !counted.has(key(h.batch.drugId, h.batch.batchNo, h.batch.expiryDate)))
    .map((h) => ({ name: h.name, batchNo: h.batch.batchNo, expiryDate: h.batch.expiryDate, system: h.batch.quantity }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    ...empty,
    matched,
    different,
    missing,
    extra,
    fileUnits: resolved.stocked.reduce((n, s) => n + s.units, 0),
    systemUnits: held.reduce((n, h) => n + h.batch.quantity, 0),
    fileCost: totalsOf(resolved.stocked).costValue,
    systemCost: fromMinor(held.reduce((n, h) => n + (costValue(h.batch) ?? 0), 0)),
  };
}

export async function recordRejectedStockImport(tx: Tx, clinicId: string, fileName: string, report: StockImportReport, actorId: string) {
  await tx.insert(importJobs).values({
    clinicId,
    kind: "stock",
    fileName,
    rowCount: report.rows,
    imported: 0,
    status: "rejected",
    errors: report.problems.slice(0, 200),
    createdBy: actorId,
  });
}

export function listStockImports(tx: Tx) {
  return tx.select().from(importJobs).where(and(eq(importJobs.kind, "stock"))).orderBy(desc(importJobs.createdAt)).limit(20);
}
