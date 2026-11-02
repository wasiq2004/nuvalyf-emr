import "server-only";

// Shelf labels and barcodes (docs/PHARMACY_DESIGN.md 4.8). Items without a
// manufacturer barcode get a clinic code (NL000001...) when labels are printed.
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import { drugs } from "@/lib/db/schema";
import { nextCounter } from "@/features/patients/patients.service";

export const CLINIC_BARCODE_PREFIX = "NL";

/** Gives each chosen item without a barcode a clinic code; returns how many. */
export async function assignBarcodes(tx: Tx, clinicId: string, drugIds: string[]) {
  if (drugIds.length === 0) return 0;
  const missing = await tx
    .select({ id: drugs.id })
    .from(drugs)
    .where(and(inArray(drugs.id, drugIds), isNull(drugs.barcode)))
    .orderBy(asc(drugs.name));
  for (const item of missing) {
    const code = `${CLINIC_BARCODE_PREFIX}${String(await nextCounter(tx, clinicId, "barcode")).padStart(6, "0")}`;
    await tx.update(drugs).set({ barcode: code, updatedAt: new Date() }).where(eq(drugs.id, item.id));
  }
  return missing.length;
}

/** Items to print, with their current price and nearest usable batch. */
export async function labelItems(tx: Tx, drugIds: string[], today: string) {
  if (drugIds.length === 0) return [];
  return tx
    .select({
      id: drugs.id,
      name: drugs.name,
      strength: drugs.strength,
      form: drugs.form,
      barcode: drugs.barcode,
      rack: drugs.rack,
      price: drugs.price,
      packPrice: drugs.packPrice,
      packSize: drugs.packSize,
      batch: sql<string | null>`(select b.batch_no || ' · exp ' || to_char(b.expiry_date, 'MM/YY') from app.stock_batches b where b.drug_id = ${sql.raw('"drugs"."id"')} and b.quantity > 0 and b.expiry_date >= ${today}::date order by b.expiry_date limit 1)`,
    })
    .from(drugs)
    .where(inArray(drugs.id, drugIds))
    .orderBy(asc(drugs.name));
}

/** The item a scanned code belongs to, if any. */
export async function findByBarcode(tx: Tx, code: string) {
  const [row] = await tx.select({ id: drugs.id }).from(drugs).where(eq(drugs.barcode, code.trim())).limit(1);
  return row?.id ?? null;
}
