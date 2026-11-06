import "server-only";

// Credit notes: items taken back, or a whole sale cancelled
// (docs/PHARMACY_DESIGN.md 4.2). The sale is never edited: the credit note
// points at its lines, refunds their exact share and puts the units back into
// the same batches through the ledger.
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import { drugs, pharmacySaleItems, pharmacySales, saleReturnItems, saleReturns, stockBatches, users } from "@/lib/db/schema";
import { AppError } from "@/lib/errors";
import { idempotent } from "@/lib/idempotency";
import { fromMinor, toMinor } from "@/lib/money";
import { toZonedDateTime } from "@/lib/time";
import { nextCounter } from "@/features/patients/patients.service";
import { staffName } from "@/features/clinical/encounters.service";
import { counterKey, documentNumber, fiscalYear } from "./numbering";
import { addValues, emptyValue, returnValue, returnable, type LineValue } from "./return-rules";
import { addSourceCharge, chargeForSource } from "@/features/inpatient/inpatient.service";
import { ensureBatch, moveStock } from "./stock.service";
import { getSale, refreshDispenseStatus } from "./sales.service";
import { priceSale, stateOfGstin, taxModeFor } from "./gst-rules";
import { effectiveGst, getPharmacySettings } from "./settings.service";
import { getCustomer, type CustomerRow } from "./customers.service";

type SaleItem = typeof pharmacySaleItems.$inferSelect;

/** A sale line's value in paise; sales from before GST have no tax split. */
function lineValue(item: SaleItem): LineValue {
  const net = toMinor(item.net ?? item.amount);
  if (item.taxable === null) return { net, taxable: net, cgst: 0, sgst: 0, igst: 0 };
  return { net, taxable: toMinor(item.taxable), cgst: toMinor(item.cgst), sgst: toMinor(item.sgst), igst: toMinor(item.igst) };
}

/** Units and value already returned per sale line. */
async function returnedSoFar(tx: Tx, saleItemIds: string[]) {
  const map = new Map<string, { units: number; value: LineValue }>();
  if (saleItemIds.length === 0) return map;
  const rows = await tx.select().from(saleReturnItems).where(inArray(saleReturnItems.saleItemId, saleItemIds));
  for (const r of rows) {
    if (!r.saleItemId) continue;
    const prev = map.get(r.saleItemId) ?? { units: 0, value: emptyValue() };
    map.set(r.saleItemId, {
      units: prev.units + r.quantity,
      value: addValues(prev.value, { net: toMinor(r.net), taxable: toMinor(r.taxable), cgst: toMinor(r.cgst), sgst: toMinor(r.sgst), igst: toMinor(r.igst) }),
    });
  }
  return map;
}

export type ReturnState = "none" | "partial" | "returned" | "cancelled";

export async function returnStateOf(tx: Tx, saleId: string): Promise<ReturnState> {
  const notes = await tx.select({ kind: saleReturns.kind }).from(saleReturns).where(eq(saleReturns.saleId, saleId));
  if (notes.length === 0) return "none";
  if (notes.some((n) => n.kind === "cancellation")) return "cancelled";
  const [row] = await tx
    .select({
      sold: sql<number>`(select coalesce(sum(quantity), 0) from app.pharmacy_sale_items where sale_id = ${saleId})::int`,
      back: sql<number>`(select coalesce(sum(ri.quantity), 0) from app.sale_return_items ri join app.sale_returns r on r.id = ri.return_id where r.sale_id = ${saleId})::int`,
    })
    .from(sql`(select 1) as one`);
  return row.back >= row.sold ? "returned" : "partial";
}

export type SaleReturnInput = {
  saleId: string;
  kind: "return" | "cancellation";
  reason: string;
  /** Units per sale line (ignored for a cancellation, which takes everything). */
  lines: { saleItemId: string; quantity: number }[];
  idempotencyKey: string;
};

export async function createSaleReturn(tx: Tx, clinicId: string, input: SaleReturnInput, actorId: string, today: string, timezone: string) {
  return idempotent(tx, { clinicId, name: "sale-return", key: input.idempotencyKey, input: { ...input, idempotencyKey: undefined } }, async () => {
    const [sale] = await tx.select().from(pharmacySales).where(eq(pharmacySales.id, input.saleId)).for("update").limit(1);
    if (!sale) throw new AppError("Sale not found.");
    const items = await tx.select().from(pharmacySaleItems).where(eq(pharmacySaleItems.saleId, sale.id)).orderBy(asc(pharmacySaleItems.id));
    const already = await returnedSoFar(tx, items.map((i) => i.id));
    const notes = await tx.select({ kind: saleReturns.kind }).from(saleReturns).where(eq(saleReturns.saleId, sale.id));
    if (notes.some((n) => n.kind === "cancellation")) throw new AppError(`Sale ${sale.number} is already cancelled.`);

    let wanted: { item: SaleItem; units: number }[];
    if (input.kind === "cancellation") {
      if (notes.length > 0) throw new AppError("Items from this sale were already returned; return the rest instead of cancelling.");
      if (toZonedDateTime(sale.soldAt, timezone).date !== today) throw new AppError("Only today's sales can be cancelled. Take the items back as a return instead.");
      wanted = items.map((item) => ({ item, units: item.quantity }));
    } else {
      wanted = input.lines
        .filter((l) => l.quantity > 0)
        .map((l) => {
          const item = items.find((i) => i.id === l.saleItemId);
          if (!item) throw new AppError("A line does not belong to this sale.");
          const left = returnable(item.quantity, already.get(item.id)?.units ?? 0);
          if (l.quantity > left) throw new AppError(`${item.description}: only ${left} can still be returned.`);
          return { item, units: l.quantity };
        });
      if (wanted.length === 0) throw new AppError("Choose what is being returned.");
    }

    const lines = wanted.map(({ item, units }) => {
      const before = already.get(item.id) ?? { units: 0, value: emptyValue() };
      return { item, units, value: returnValue(lineValue(item), item.quantity, before.units, before.value, units) };
    });
    const roundOff = input.kind === "cancellation" ? toMinor(sale.roundOff) : 0;
    const refund = lines.reduce((s, l) => s + l.value.net, 0) + roundOff;
    const tax = lines.reduce((s, l) => s + l.value.cgst + l.value.sgst + l.value.igst, 0);

    const fy = fiscalYear(today);
    const number = documentNumber("creditNote", fy, await nextCounter(tx, clinicId, counterKey("creditNote", fy)));
    const [note] = await tx
      .insert(saleReturns)
      .values({
        clinicId,
        number,
        fiscalYear: fy,
        saleId: sale.id,
        kind: input.kind,
        reason: input.reason,
        refundMethod: sale.method === "credit" ? "account" : sale.method,
        total: fromMinor(refund),
        roundOff: fromMinor(roundOff),
        taxTotal: fromMinor(tax),
        createdBy: actorId,
      })
      .returning({ id: saleReturns.id });
    await tx.insert(saleReturnItems).values(
      lines.map((l) => ({
        clinicId,
        returnId: note.id,
        saleItemId: l.item.id,
        drugId: l.item.drugId,
        batchId: l.item.batchId,
        quantity: l.units,
        net: fromMinor(l.value.net),
        taxable: fromMinor(l.value.taxable),
        cgst: fromMinor(l.value.cgst),
        sgst: fromMinor(l.value.sgst),
        igst: fromMinor(l.value.igst),
      })),
    );
    // Back into the same batch, even if it has expired since (it then cannot be sold).
    for (const l of lines) {
      await moveStock(tx, clinicId, { drugId: l.item.drugId, batchId: l.item.batchId, change: l.units, reason: "return", sourceType: "sale_return", sourceId: note.id }, actorId);
    }
    if (sale.prescriptionId) await refreshDispenseStatus(tx, sale.prescriptionId);

    if (sale.method === "inpatient") {
      const original = await chargeForSource(tx, "pharmacy_sale", sale.id);
      if (original) await addSourceCharge(tx, clinicId, original.admissionId, { kind: "pharmacy", description: `Returned on ${number}`, amount: fromMinor(-refund), sourceType: "sale_return", sourceId: note.id }, actorId);
    }

    return { returnId: note.id, number, saleNumber: sale.number, refund: fromMinor(refund), refundMethod: sale.method === "credit" ? "account" : sale.method, units: lines.reduce((n, l) => n + l.units, 0) };
  });
}

export type OldBillLine = { drugId: string; batchNo: string; expiryDate: string; quantity: number; amount: string; resaleable: boolean };

export type OldBillReturnInput = {
  oldBillNo: string;
  oldBillDate: string;
  customerId?: string | null;
  customerName?: string;
  refundMethod: "cash" | "upi" | "card" | "other" | "account";
  reason: string;
  lines: OldBillLine[];
  /** The person has seen the earlier note on this bill and this is a further return. */
  confirmRepeat?: boolean;
  idempotencyKey: string;
};

/**
 * A customer returns something billed by the old software. There is no sale to
 * check against, so the pharmacist states the amount from the paper bill, and
 * the note carries the tax and stock details a sale line would have.
 */
export async function createOldBillReturn(tx: Tx, clinicId: string, input: OldBillReturnInput, actorId: string, today: string) {
  return idempotent(tx, { clinicId, name: "old-bill-return", key: input.idempotencyKey, input: { ...input, idempotencyKey: undefined } }, async () => {
    if (input.lines.length === 0) throw new AppError("Add what is being returned.");
    if (input.oldBillDate > today) throw new AppError("The bill date is in the future.");
    const oldBillNo = input.oldBillNo.trim().toUpperCase();
    const settings = await getPharmacySettings(tx, clinicId);

    let customer: CustomerRow | null = null;
    if (input.customerId) {
      customer = await getCustomer(tx, input.customerId);
      if (!customer) throw new AppError("Customer not found.");
    }
    if (input.refundMethod === "account" && !customer) throw new AppError("Crediting an account needs a named customer.");

    const earlier = await tx.select({ number: saleReturns.number }).from(saleReturns).where(eq(saleReturns.oldBillNo, oldBillNo)).orderBy(desc(saleReturns.createdAt)).limit(1);
    if (earlier[0] && !input.confirmRepeat) throw new AppError(`Old bill ${oldBillNo} already has credit note ${earlier[0].number}. Tick "further return" if this is a second return on it.`);

    const items = await tx.select().from(drugs).where(inArray(drugs.id, [...new Set(input.lines.map((l) => l.drugId))]));
    const lines = input.lines.map((line) => {
      const item = items.find((d) => d.id === line.drugId);
      if (!item) throw new AppError("A selected item was not found.");
      return { line, item, gross: toMinor(line.amount), ...effectiveGst(item, settings) };
    });
    const mode = taxModeFor(settings.gstScheme, settings.stateCode, customer?.stateCode ?? stateOfGstin(customer?.gstin));
    const priced = priceSale(lines.map((l) => ({ gross: l.gross, gstRate: l.gstRate })), { discount: 0, roundOff: false, mode });

    const fy = fiscalYear(today);
    const number = documentNumber("creditNote", fy, await nextCounter(tx, clinicId, counterKey("creditNote", fy)));
    const [note] = await tx
      .insert(saleReturns)
      .values({
        clinicId,
        number,
        fiscalYear: fy,
        saleId: null,
        oldBillNo,
        oldBillDate: input.oldBillDate,
        customerId: customer?.id ?? null,
        customerName: customer?.name ?? (input.customerName?.trim() || null),
        customerGstin: customer?.gstin ?? null,
        kind: "return",
        reason: input.reason,
        refundMethod: input.refundMethod,
        total: fromMinor(priced.total),
        roundOff: "0",
        taxTotal: fromMinor(priced.tax),
        createdBy: actorId,
      })
      .returning({ id: saleReturns.id });

    for (const [i, l] of lines.entries()) {
      const t = priced.lines[i];
      const batch = await ensureBatch(tx, clinicId, { drugId: l.item.id, batchNo: l.line.batchNo, expiryDate: l.line.expiryDate });
      await tx.insert(saleReturnItems).values({
        clinicId,
        returnId: note.id,
        drugId: l.item.id,
        batchId: batch.id,
        quantity: l.line.quantity,
        net: fromMinor(t.net),
        taxable: fromMinor(t.taxable),
        cgst: fromMinor(t.cgst),
        sgst: fromMinor(t.sgst),
        igst: fromMinor(t.igst),
        description: [l.item.name, l.item.strength].filter(Boolean).join(" "),
        hsn: l.hsn,
        gstRate: String(t.gstRate),
        unitCost: batch.unitCost,
      });
      await moveStock(tx, clinicId, { drugId: l.item.id, batchId: batch.id, change: l.line.quantity, reason: "return", sourceType: "sale_return", sourceId: note.id, note: `Old bill ${oldBillNo}` }, actorId);
      // Back on the record, but not on the shelf: it must not be sold again.
      if (!l.line.resaleable) {
        await moveStock(tx, clinicId, { drugId: l.item.id, batchId: batch.id, change: -l.line.quantity, reason: "damaged", sourceType: "sale_return", sourceId: note.id, note: `Returned on ${number}, not fit to resell` }, actorId);
      }
    }
    return { returnId: note.id, number, oldBillNo, refund: fromMinor(priced.total), refundMethod: input.refundMethod, units: input.lines.reduce((n, l) => n + l.quantity, 0) };
  });
}

/** What can still come back from a sale, per line. */
export async function returnableLines(tx: Tx, saleId: string) {
  const items = await tx.select().from(pharmacySaleItems).where(eq(pharmacySaleItems.saleId, saleId)).orderBy(asc(pharmacySaleItems.id));
  const already = await returnedSoFar(tx, items.map((i) => i.id));
  return items.map((i) => ({ ...i, returned: already.get(i.id)?.units ?? 0, returnable: returnable(i.quantity, already.get(i.id)?.units ?? 0) }));
}

export async function listSaleReturns(tx: Tx, saleId: string) {
  return tx
    .select({ note: saleReturns, title: users.title, firstName: users.firstName, lastName: users.lastName })
    .from(saleReturns)
    .innerJoin(users, eq(users.id, saleReturns.createdBy))
    .where(eq(saleReturns.saleId, saleId))
    .orderBy(desc(saleReturns.createdAt))
    .then((rows) => rows.map((r) => ({ ...r.note, createdByName: staffName(r) })));
}

export async function getSaleReturn(tx: Tx, id: string) {
  const [row] = await tx
    .select({ note: saleReturns, title: users.title, firstName: users.firstName, lastName: users.lastName })
    .from(saleReturns)
    .innerJoin(users, eq(users.id, saleReturns.createdBy))
    .where(eq(saleReturns.id, id))
    .limit(1);
  if (!row) return null;
  const items = await tx
    .select({ ret: saleReturnItems, line: pharmacySaleItems, batchNo: stockBatches.batchNo, expiryDate: stockBatches.expiryDate, form: drugs.form })
    .from(saleReturnItems)
    .leftJoin(pharmacySaleItems, eq(pharmacySaleItems.id, saleReturnItems.saleItemId))
    .innerJoin(stockBatches, eq(stockBatches.id, saleReturnItems.batchId))
    .innerJoin(drugs, eq(drugs.id, saleReturnItems.drugId))
    .where(and(eq(saleReturnItems.returnId, id)));
  const sale = row.note.saleId ? (await getSale(tx, row.note.saleId))! : null;
  // An old bill stands in for the sale: the page and PDF read them the same way.
  const source = sale ?? {
    number: `old bill ${row.note.oldBillNo}`,
    documentType: Number(row.note.taxTotal) > 0 ? "tax_invoice" : "bill_of_supply",
    customer: row.note.customerName ?? "Walk-in customer",
    customerGstin: row.note.customerGstin,
    soldAt: new Date(`${row.note.oldBillDate}T00:00:00Z`),
  };
  return {
    ...row.note,
    sale: source,
    createdByName: staffName(row),
    items: items.map((i) => ({
      ...i.ret,
      description: i.line?.description ?? i.ret.description ?? "",
      batchNo: i.batchNo,
      expiryDate: i.expiryDate,
      hsn: i.line?.hsn ?? i.ret.hsn,
      gstRate: i.line?.gstRate ?? i.ret.gstRate,
      form: i.form,
    })),
  };
}
