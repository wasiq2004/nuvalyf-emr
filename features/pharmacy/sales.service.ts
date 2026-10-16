import "server-only";

// Pharmacy sales: over the counter, or filling a signed prescription. One
// transaction takes the money and moves the stock; the idempotency key makes
// a double-tap or a retry return the first sale instead of selling twice.
import { and, asc, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import {
  allergies,
  drugs,
  encounters,
  patients,
  pharmacySaleItems,
  pharmacySales,
  prescriptionItems,
  prescriptionQueries,
  prescriptions,
  stockBatches,
  users,
} from "@/lib/db/schema";
import { AppError } from "@/lib/errors";
import { idempotent } from "@/lib/idempotency";
import { fromMinor, toMinor } from "@/lib/money";
import { ageOn, displayPatientName } from "@/features/patients/patient-rules";
import { nextCounter } from "@/features/patients/patients.service";
import { staffName } from "@/features/clinical/encounters.service";
import type { PaymentMethod } from "@/features/billing/billing-rules";
import { moveStock } from "./stock.service";
import { isExpired, suggestQuantity } from "./stock-rules";

export type SaleLine = { drugId: string; batchId: string; quantity: number; prescriptionItemId?: string | null };

export type SaleInput = {
  lines: SaleLine[];
  prescriptionId?: string | null;
  patientId?: string | null;
  customerName?: string;
  customerPhone?: string;
  method: PaymentMethod;
  reference?: string;
  idempotencyKey: string;
};

export type SaleResult = { saleId: string; number: string; total: string; patientId: string | null; dispenseStatus: string | null };

export async function sell(tx: Tx, clinicId: string, input: SaleInput, actorId: string, today: string) {
  const { idempotencyKey, ...request } = input;
  return idempotent(tx, { clinicId, name: input.prescriptionId ? "dispense" : "sale", key: idempotencyKey, input: request }, () =>
    doSell(tx, clinicId, request, actorId, today),
  );
}

async function doSell(tx: Tx, clinicId: string, input: Omit<SaleInput, "idempotencyKey">, actorId: string, today: string): Promise<SaleResult> {
  if (input.lines.length === 0) throw new AppError("Add at least one medicine.");

  let patientId = input.patientId ?? null;
  let rxItems: (typeof prescriptionItems.$inferSelect)[] = [];
  if (input.prescriptionId) {
    const [rx] = await tx.select().from(prescriptions).where(eq(prescriptions.id, input.prescriptionId)).for("update").limit(1);
    if (!rx || rx.status !== "signed") throw new AppError("Only a signed prescription can be dispensed.");
    if (rx.dispenseStatus === "dispensed" || rx.dispenseStatus === "not_required") throw new AppError("This prescription is already closed.");
    patientId = rx.patientId;
    rxItems = await tx.select().from(prescriptionItems).where(eq(prescriptionItems.prescriptionId, rx.id));
    // Never more than the prescribed course (when the prescription states it).
    const given = await dispensedQuantities(tx, rx.id);
    for (const item of rxItems) {
      const needed = suggestQuantity(item);
      if (needed === null) continue;
      const now = input.lines.filter((l) => l.prescriptionItemId === item.id).reduce((n, l) => n + l.quantity, 0);
      const remaining = Math.max(0, needed - (given.get(item.id) ?? 0));
      if (now > remaining) throw new AppError(`${item.drugName}: only ${remaining} left to dispense on this prescription.`);
    }
    for (const line of input.lines) {
      const item = rxItems.find((i) => i.id === line.prescriptionItemId);
      if (!item) throw new AppError("A line does not belong to this prescription.");
      if (item.drugId && item.drugId !== line.drugId) {
        // Substitution: same generic only - the pharmacist cannot change the medicine.
        const [chosen] = await tx.select({ genericName: drugs.genericName }).from(drugs).where(eq(drugs.id, line.drugId)).limit(1);
        if (!chosen || chosen.genericName.trim().toLowerCase() !== item.genericName.trim().toLowerCase()) {
          throw new AppError(`${item.drugName} can only be filled with the same medicine or the same generic.`);
        }
      }
    }
  }

  // Lock every batch involved in a fixed order so two sales cannot deadlock.
  const batchIds = [...new Set(input.lines.map((l) => l.batchId))].sort();
  const batches = await tx.select().from(stockBatches).where(inArray(stockBatches.id, batchIds)).orderBy(asc(stockBatches.id)).for("update");
  const drugRows = await tx.select().from(drugs).where(inArray(drugs.id, [...new Set(input.lines.map((l) => l.drugId))]));

  const priced = input.lines.map((line) => {
    const batch = batches.find((b) => b.id === line.batchId);
    const drug = drugRows.find((d) => d.id === line.drugId);
    if (!batch || !drug || batch.drugId !== drug.id) throw new AppError("A selected batch does not match its medicine.");
    if (isExpired(batch.expiryDate, today)) throw new AppError(`Batch ${batch.batchNo} of ${drug.name} has expired and cannot be sold.`);
    if (!drug.price) throw new AppError(`${drug.name} has no selling price. Set one in Medicines first.`);
    const unit = toMinor(drug.price);
    return { line, batch, drug, unit, amount: unit * line.quantity };
  });

  // The same batch may appear on two lines: check the combined quantity.
  for (const batch of batches) {
    const wanted = priced.filter((p) => p.batch.id === batch.id).reduce((n, p) => n + p.line.quantity, 0);
    if (wanted > batch.quantity) {
      const drug = drugRows.find((d) => d.id === batch.drugId);
      throw new AppError(`Only ${batch.quantity} of ${drug?.name ?? "that medicine"} left in batch ${batch.batchNo}.`);
    }
  }

  const total = priced.reduce((sum, p) => sum + p.amount, 0);
  const number = `S-${String(await nextCounter(tx, clinicId, "sale")).padStart(6, "0")}`;
  const [sale] = await tx
    .insert(pharmacySales)
    .values({
      clinicId,
      number,
      patientId,
      prescriptionId: input.prescriptionId ?? null,
      customerName: input.customerName ?? null,
      customerPhone: input.customerPhone ?? null,
      total: fromMinor(total),
      method: input.method,
      reference: input.reference ?? null,
      soldBy: actorId,
    })
    .returning({ id: pharmacySales.id });

  await tx.insert(pharmacySaleItems).values(
    priced.map((p) => ({
      clinicId,
      saleId: sale.id,
      drugId: p.drug.id,
      batchId: p.batch.id,
      prescriptionItemId: p.line.prescriptionItemId ?? null,
      description: [p.drug.name, p.drug.strength].filter(Boolean).join(" "),
      batchNo: p.batch.batchNo,
      expiryDate: p.batch.expiryDate,
      quantity: p.line.quantity,
      unitPrice: fromMinor(p.unit),
      amount: fromMinor(p.amount),
    })),
  );
  for (const p of priced) {
    await moveStock(
      tx,
      clinicId,
      { drugId: p.drug.id, batchId: p.batch.id, change: -p.line.quantity, reason: input.prescriptionId ? "dispense" : "sale", sourceType: "pharmacy_sale", sourceId: sale.id },
      actorId,
    );
  }

  let dispenseStatus: string | null = null;
  if (input.prescriptionId) {
    dispenseStatus = await refreshDispenseStatus(tx, input.prescriptionId, rxItems);
  }
  return { saleId: sale.id, number, total: fromMinor(total), patientId, dispenseStatus };
}

/** Dispensed when every line has had its full quantity; otherwise partial. */
async function refreshDispenseStatus(tx: Tx, prescriptionId: string, items: (typeof prescriptionItems.$inferSelect)[]) {
  const given = await dispensedQuantities(tx, prescriptionId);
  const complete = items.every((item) => {
    const needed = suggestQuantity(item) ?? 1;
    return (given.get(item.id) ?? 0) >= needed;
  });
  const status = complete ? "dispensed" : "partial";
  await tx.update(prescriptions).set({ dispenseStatus: status, updatedAt: new Date() }).where(eq(prescriptions.id, prescriptionId));
  return status;
}

async function dispensedQuantities(tx: Tx, prescriptionId: string) {
  const rows = await tx
    .select({ itemId: pharmacySaleItems.prescriptionItemId, qty: sql<number>`sum(${pharmacySaleItems.quantity})::int` })
    .from(pharmacySaleItems)
    .innerJoin(pharmacySales, eq(pharmacySales.id, pharmacySaleItems.saleId))
    .where(eq(pharmacySales.prescriptionId, prescriptionId))
    .groupBy(pharmacySaleItems.prescriptionItemId);
  return new Map(rows.filter((r) => r.itemId).map((r) => [r.itemId!, r.qty]));
}

/** Patient will not take it from here (bought elsewhere, declined): close it. */
export async function closePrescription(tx: Tx, prescriptionId: string) {
  const [rx] = await tx
    .update(prescriptions)
    .set({ dispenseStatus: "not_required", updatedAt: new Date() })
    .where(and(eq(prescriptions.id, prescriptionId), eq(prescriptions.status, "signed"), inArray(prescriptions.dispenseStatus, ["pending", "partial"])))
    .returning({ id: prescriptions.id, patientId: prescriptions.patientId });
  if (!rx) throw new AppError("This prescription is not waiting at the pharmacy.");
  return rx;
}

// ---------------------------------------------------------------------------
// The prescription queue (pharmacist view: name, age, allergies, source only)
// ---------------------------------------------------------------------------

export type PharmacyQueueItem = {
  prescriptionId: string;
  dispenseStatus: string;
  signedAt: Date;
  patientName: string;
  patientMrn: string;
  patientAge: number | null;
  doctorName: string;
  items: number;
  openQueries: number;
};

export async function listPrescriptionQueue(tx: Tx, today: string, since: Date): Promise<PharmacyQueueItem[]> {
  const rows = await tx
    .select({ rx: prescriptions, patient: patients, title: users.title, firstName: users.firstName, lastName: users.lastName })
    .from(prescriptions)
    .innerJoin(patients, eq(patients.id, prescriptions.patientId))
    .innerJoin(users, eq(users.id, prescriptions.prescriberId))
    .where(and(eq(prescriptions.status, "signed"), inArray(prescriptions.dispenseStatus, ["pending", "partial"]), gte(prescriptions.signedAt, since)))
    .orderBy(asc(prescriptions.signedAt));
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.rx.id);
  const counts = await tx
    .select({ id: prescriptionItems.prescriptionId, n: sql<number>`count(*)::int` })
    .from(prescriptionItems)
    .where(inArray(prescriptionItems.prescriptionId, ids))
    .groupBy(prescriptionItems.prescriptionId);
  const open = await tx
    .select({ id: prescriptionQueries.prescriptionId, n: sql<number>`count(*)::int` })
    .from(prescriptionQueries)
    .where(and(inArray(prescriptionQueries.prescriptionId, ids), sql`${prescriptionQueries.answeredAt} is null`))
    .groupBy(prescriptionQueries.prescriptionId);
  return rows.map((r) => ({
    prescriptionId: r.rx.id,
    dispenseStatus: r.rx.dispenseStatus,
    signedAt: r.rx.signedAt!,
    patientName: displayPatientName(r.patient),
    patientMrn: r.patient.mrn,
    patientAge: ageOn(r.patient, today),
    doctorName: staffName(r),
    items: counts.find((c) => c.id === r.rx.id)?.n ?? 0,
    openQueries: open.find((o) => o.id === r.rx.id)?.n ?? 0,
  }));
}

/** What the pharmacist needs to fill a prescription, and nothing more. */
export async function getPrescriptionForDispensing(tx: Tx, prescriptionId: string, today: string) {
  const [row] = await tx
    .select({ rx: prescriptions, patient: patients, encounterOpenedAt: encounters.openedAt, title: users.title, firstName: users.firstName, lastName: users.lastName })
    .from(prescriptions)
    .innerJoin(patients, eq(patients.id, prescriptions.patientId))
    .innerJoin(encounters, eq(encounters.id, prescriptions.encounterId))
    .innerJoin(users, eq(users.id, prescriptions.prescriberId))
    .where(and(eq(prescriptions.id, prescriptionId), eq(prescriptions.status, "signed")))
    .limit(1);
  if (!row) return null;

  const items = await tx.select().from(prescriptionItems).where(eq(prescriptionItems.prescriptionId, prescriptionId)).orderBy(asc(prescriptionItems.sortOrder));
  const given = await dispensedQuantities(tx, prescriptionId);
  const patientAllergies = await tx
    .select({ substance: allergies.substance, severity: allergies.severity, reaction: allergies.reaction })
    .from(allergies)
    .where(and(eq(allergies.patientId, row.patient.id), eq(allergies.status, "active")));

  // Stock for the prescribed medicine and anything with the same generic.
  const generics = [...new Set(items.map((i) => i.genericName.trim().toLowerCase()))];
  const options = generics.length
    ? await tx
        .select({ drug: drugs, batch: stockBatches })
        .from(drugs)
        .innerJoin(stockBatches, eq(stockBatches.drugId, drugs.id))
        .where(and(sql`lower(trim(${drugs.genericName})) in ${generics}`, sql`${stockBatches.quantity} > 0`, sql`${stockBatches.expiryDate} >= ${today}`))
        .orderBy(asc(stockBatches.expiryDate))
    : [];

  return {
    prescriptionId: row.rx.id,
    dispenseStatus: row.rx.dispenseStatus,
    signedAt: row.rx.signedAt!,
    patient: {
      id: row.patient.id,
      name: displayPatientName(row.patient),
      mrn: row.patient.mrn,
      age: ageOn(row.patient, today),
      sex: row.patient.sex,
      allergies: patientAllergies,
      noKnownAllergies: Boolean(row.patient.noKnownAllergiesAt),
    },
    source: { doctorName: staffName(row), visitDate: row.encounterOpenedAt },
    items: items.map((item) => {
      const needed = suggestQuantity(item);
      const dispensed = given.get(item.id) ?? 0;
      return {
        id: item.id,
        drugId: item.drugId,
        drugName: item.drugName,
        genericName: item.genericName,
        form: item.form,
        strength: item.strength,
        dose: item.dose,
        frequency: item.frequency,
        durationDays: item.durationDays,
        instructions: item.instructions,
        needed,
        dispensed,
        remaining: needed === null ? null : Math.max(0, needed - dispensed),
        stock: options
          .filter((o) => o.drug.genericName.trim().toLowerCase() === item.genericName.trim().toLowerCase())
          .map((o) => ({
            drugId: o.drug.id,
            drugName: o.drug.name,
            price: o.drug.price,
            batchId: o.batch.id,
            batchNo: o.batch.batchNo,
            expiryDate: o.batch.expiryDate,
            quantity: o.batch.quantity,
            prescribed: o.drug.id === item.drugId,
          })),
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Sales history
// ---------------------------------------------------------------------------

export async function salesBetween(tx: Tx, from: Date, to: Date) {
  return tx
    .select({ sale: pharmacySales, patient: patients })
    .from(pharmacySales)
    .leftJoin(patients, eq(patients.id, pharmacySales.patientId))
    .where(and(gte(pharmacySales.soldAt, from), lt(pharmacySales.soldAt, to)))
    .orderBy(desc(pharmacySales.soldAt));
}

export async function salesTotal(tx: Tx, from: Date, to: Date) {
  const [row] = await tx
    .select({ total: sql<string>`coalesce(sum(${pharmacySales.total}), 0)::numeric(12,2)::text`, count: sql<number>`count(*)::int` })
    .from(pharmacySales)
    .where(and(gte(pharmacySales.soldAt, from), lt(pharmacySales.soldAt, to)));
  return { total: row?.total ?? "0.00", count: row?.count ?? 0 };
}

export async function getSale(tx: Tx, saleId: string) {
  const [row] = await tx
    .select({ sale: pharmacySales, patient: patients, title: users.title, firstName: users.firstName, lastName: users.lastName })
    .from(pharmacySales)
    .leftJoin(patients, eq(patients.id, pharmacySales.patientId))
    .innerJoin(users, eq(users.id, pharmacySales.soldBy))
    .where(eq(pharmacySales.id, saleId))
    .limit(1);
  if (!row) return null;
  const items = await tx.select().from(pharmacySaleItems).where(eq(pharmacySaleItems.saleId, saleId));
  return {
    ...row.sale,
    soldByName: staffName(row),
    customer: row.patient ? `${displayPatientName(row.patient)} (${row.patient.mrn})` : (row.sale.customerName ?? "Walk-in customer"),
    items,
  };
}

/** Medicines that can be sold now, with their usable batches (counter sale). */
export async function sellableStock(tx: Tx, query: string, today: string) {
  const term = query.trim().replace(/[%_\\]/g, "");
  if (!term) return [];
  const rows = await tx
    .select({ drug: drugs, batch: stockBatches })
    .from(drugs)
    .innerJoin(stockBatches, eq(stockBatches.drugId, drugs.id))
    .where(
      and(
        eq(drugs.isActive, true),
        sql`(${drugs.name} ilike ${`%${term}%`} or ${drugs.genericName} ilike ${`%${term}%`})`,
        sql`${stockBatches.quantity} > 0`,
        sql`${stockBatches.expiryDate} >= ${today}`,
      ),
    )
    .orderBy(asc(drugs.name), asc(stockBatches.expiryDate))
    .limit(60);
  const byDrug = new Map<string, { drugId: string; name: string; genericName: string; form: string; strength: string | null; price: string | null; batches: { id: string; batchNo: string; expiryDate: string; quantity: number }[] }>();
  for (const r of rows) {
    const entry = byDrug.get(r.drug.id) ?? {
      drugId: r.drug.id,
      name: r.drug.name,
      genericName: r.drug.genericName,
      form: r.drug.form,
      strength: r.drug.strength,
      price: r.drug.price,
      batches: [],
    };
    entry.batches.push({ id: r.batch.id, batchNo: r.batch.batchNo, expiryDate: r.batch.expiryDate, quantity: r.batch.quantity });
    byDrug.set(r.drug.id, entry);
  }
  return [...byDrug.values()];
}

export type SellableDrug = Awaited<ReturnType<typeof sellableStock>>[number];
