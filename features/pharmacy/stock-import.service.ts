import "server-only";

// Items and opening stock from a spreadsheet: check everything, then create
// the new items, their other names and every batch in one transaction - or
// nothing. A row whose name (or other name) is already in the clinic's list
// adds stock to that item instead of creating a duplicate.
import { and, desc, eq } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import { importJobs } from "@/lib/db/schema";
import { AppError } from "@/lib/errors";
import { idempotent } from "@/lib/idempotency";
import { createDrug } from "@/features/catalog/catalog.service";
import { addAlias, nameIndex } from "@/features/catalog/items.service";
import { normalizeItemName } from "@/features/catalog/item-rules";
import { parseCsv, validateStockRows, type StockImportProblem, type StockImportRow } from "./stock-import-rules";
import { receiveStock } from "./stock.service";

export type StockImportReport = {
  rows: number;
  newItems: number;
  existingItems: number;
  batches: number;
  units: number;
  problems: StockImportProblem[];
};

type Plan = { report: StockImportReport; rows: StockImportRow[]; existing: Map<string, string> };

async function plan(tx: Tx, csv: string, today: string): Promise<Plan> {
  const parsed = parseCsv(csv);
  const { valid, problems } = validateStockRows(parsed, today);
  const index = await nameIndex(tx);

  // Item key (normalised name) -> existing item id, or a new item.
  const existing = new Map<string, string>();
  const newItems = new Map<string, number>();
  for (const row of valid) {
    const hit = index.get(row.normalized);
    if (hit) existing.set(row.normalized, hit.drugId);
    else if (!newItems.has(row.normalized)) {
      newItems.set(row.normalized, row.line);
      if (row.itemType === "medicine" && !row.genericName) {
        problems.push({ line: row.line, field: "genericName", message: `${row.name} is new: a medicine needs its generic name` });
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

  const bad = new Set(problems.map((p) => p.line));
  const rows = valid.filter((r) => !bad.has(r.line));
  problems.sort((a, b) => a.line - b.line);
  const stocked = rows.filter((r) => r.batch);
  return {
    report: {
      rows: Math.max(0, parsed.length - 1),
      newItems: [...newItems.keys()].length,
      existingItems: existing.size,
      batches: stocked.length,
      units: stocked.reduce((n, r) => n + (r.batch?.quantity ?? 0), 0),
      problems,
    },
    rows,
    existing,
  };
}

/** The report without changing anything. */
export async function checkStockImport(tx: Tx, csv: string, today: string) {
  return (await plan(tx, csv, today)).report;
}

export async function runStockImport(tx: Tx, clinicId: string, input: { fileName: string; csv: string; idempotencyKey: string }, actorId: string, today: string) {
  return idempotent(tx, { clinicId, name: "stock-import", key: input.idempotencyKey, input: { fileName: input.fileName, csv: input.csv } }, async () => {
    const { report, rows, existing } = await plan(tx, input.csv, today);
    if (report.problems.length > 0) throw new AppError(`Nothing was imported: ${report.problems.length} problem(s) in the file. Fix them and try again.`);
    if (rows.length === 0) throw new AppError("The file has no item rows.");

    const ids = new Map(existing);
    const index = await nameIndex(tx);
    for (const row of rows) {
      let drugId = ids.get(row.normalized);
      if (!drugId) {
        const created = await createDrug(tx, clinicId, {
          name: row.name,
          itemType: row.itemType,
          genericName: row.genericName ?? undefined,
          form: row.form,
          strength: row.strength ?? undefined,
          category: row.category ?? undefined,
          manufacturer: row.manufacturer ?? undefined,
          packSize: row.packSize,
          price: row.price ?? undefined,
          packPrice: row.packPrice ?? undefined,
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
      if (row.batch) {
        await receiveStock(
          tx,
          clinicId,
          {
            drugId,
            batchNo: row.batch.batchNo,
            expiryDate: row.batch.expiryDate,
            quantity: row.batch.quantity,
            unitCost: row.batch.unitCost ?? undefined,
            reason: "opening",
            sourceType: "import",
            note: input.fileName.slice(0, 200),
          },
          actorId,
          today,
        );
      }
    }
    const [job] = await tx
      .insert(importJobs)
      .values({ clinicId, kind: "stock", fileName: input.fileName, rowCount: report.rows, imported: rows.length, status: "imported", createdBy: actorId })
      .returning({ id: importJobs.id });
    return { jobId: job.id, newItems: report.newItems, batches: report.batches, units: report.units };
  });
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
