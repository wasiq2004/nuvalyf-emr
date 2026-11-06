import "server-only";

// Pharmacy sales: over the counter, or filling a signed prescription. One
// transaction takes the money and moves the stock; the idempotency key makes
// a double-tap or a retry return the first sale instead of selling twice.
import { and, asc, desc, eq, gte, inArray, lt, sql, type SQL } from "drizzle-orm";
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
  saleReturns,
  stockBatches,
  users,
} from "@/lib/db/schema";
import { AppError } from "@/lib/errors";
import { idempotent } from "@/lib/idempotency";
import { fromMinor, toMinor } from "@/lib/money";
import { ageOn, displayPatientName } from "@/features/patients/patient-rules";
import { nextCounter, searchPatients } from "@/features/patients/patients.service";
import { staffName } from "@/features/clinical/encounters.service";
import type { PaymentMethod } from "@/features/billing/billing-rules";
import { moveStock } from "./stock.service";
import { checkAgainstPatient } from "@/features/clinical/prescriptions.service";
import { addSourceCharge, getAdmission } from "@/features/inpatient/inpatient.service";
import { needsOverride } from "@/features/clinical/prescribing-rules";
import { classifyLine, daysLeft, dosageText, type Dosage } from "./dispensing-rules";
import { isExpired, suggestQuantity } from "./stock-rules";
import { batchPrice, packWord, unitsFor, type SoldAs } from "./selling-rules";
import { priceSale, stateOfGstin, taxModeFor } from "./gst-rules";
import { counterKey, documentNumber, fiscalYear } from "./numbering";
import { missingDetails } from "./schedule-rules";
import { effectiveGst, getPharmacySettings } from "./settings.service";
import { customerBalance, ensurePatientCustomer, getCustomer, type CustomerRow } from "./customers.service";

/** How to take it, as dispensed. Anything left out keeps what the doctor wrote. */
export type LineDosage = { dose?: string; frequency?: string; durationDays?: number | null; instructions?: string };

/**
 * `quantity` counts units, or packs when `soldAs` is "pack" (default "unit").
 * When dispensing, no `prescriptionItemId` means the pharmacist added the item.
 */
export type SaleLine = { drugId: string; batchId: string; quantity: number; soldAs?: SoldAs; prescriptionItemId?: string | null; dosage?: LineDosage };

export type SaleInput = {
  lines: SaleLine[];
  prescriptionId?: string | null;
  patientId?: string | null;
  customerName?: string;
  customerPhone?: string;
  /** Named customer: required for credit, makes the sale B2B when it has a GSTIN. */
  customerId?: string | null;
  method: PaymentMethod | "credit" | "inpatient";
  /** With method "inpatient": the stay the sale is charged to. */
  admissionId?: string | null;
  reference?: string;
  /** Bill discount in rupees, tax-inclusive. */
  discount?: string;
  /** Schedule H / H1 / X details (filled from the prescription when dispensing). */
  prescriberName?: string;
  prescriberRegNo?: string;
  patientAddress?: string;
  /** Pharmacist's note on a prescription filled differently. */
  dispenseNote?: string;
  /** The pharmacist has read the allergy / interaction warnings for changed medicines. */
  warningsChecked?: boolean;
  idempotencyKey: string;
};

export type SaleResult = { saleId: string; number: string; total: string; patientId: string | null; dispenseStatus: string | null; changedLines: number };

/** What the caller may do beyond the counter defaults. */
export type SaleAuthority = { overrideDiscountLimit: boolean };

export async function sell(tx: Tx, clinicId: string, input: SaleInput, actorId: string, today: string, authority: SaleAuthority = { overrideDiscountLimit: false }) {
  const { idempotencyKey, ...request } = input;
  return idempotent(tx, { clinicId, name: input.prescriptionId ? "dispense" : "sale", key: idempotencyKey, input: request }, () =>
    doSell(tx, clinicId, request, actorId, today, authority),
  );
}

async function doSell(tx: Tx, clinicId: string, input: Omit<SaleInput, "idempotencyKey">, actorId: string, today: string, authority: SaleAuthority): Promise<SaleResult> {
  if (input.lines.length === 0) throw new AppError("Add at least one medicine.");
  const settings = await getPharmacySettings(tx, clinicId);

  const drugRows = await tx.select().from(drugs).where(inArray(drugs.id, [...new Set(input.lines.map((l) => l.drugId))]));
  // Units leaving stock per line: packs are converted at the item's pack size.
  const sized = input.lines.map((line) => {
    const drug = drugRows.find((d) => d.id === line.drugId);
    if (!drug) throw new AppError("A selected item was not found.");
    const soldAs: SoldAs = line.soldAs ?? "unit";
    if (soldAs === "pack" && drug.packSize < 2) throw new AppError(`${drug.name} is not sold in packs.`);
    return { line, drug, soldAs, units: unitsFor(line.quantity, soldAs, drug.packSize) };
  });

  let patientId = input.patientId ?? null;
  let rxItems: (typeof prescriptionItems.$inferSelect)[] = [];
  const details = {
    prescriberName: input.prescriberName?.trim() || null,
    prescriberRegNo: input.prescriberRegNo?.trim() || null,
    patientName: input.customerName?.trim() || null,
    patientAddress: input.patientAddress?.trim() || null,
  };
  if (input.prescriptionId) {
    const [rx] = await tx.select().from(prescriptions).where(eq(prescriptions.id, input.prescriptionId)).for("update").limit(1);
    if (!rx || rx.status !== "signed") throw new AppError("Only a signed prescription can be dispensed.");
    if (rx.dispenseStatus === "dispensed" || rx.dispenseStatus === "not_required") throw new AppError("This prescription is already closed.");
    patientId = rx.patientId;
    rxItems = await tx.select().from(prescriptionItems).where(eq(prescriptionItems.prescriptionId, rx.id));
    // The pharmacist decides what is given: less than the course, more (a whole
    // strip), another medicine or an extra one. A medicine the doctor did not
    // write is still checked against the patient before it leaves the counter.
    for (const { line, drug } of sized) {
      const item = line.prescriptionItemId ? rxItems.find((i) => i.id === line.prescriptionItemId) : null;
      if (line.prescriptionItemId && !item) throw new AppError("A line does not belong to this prescription.");
      if (item?.drugId === drug.id || drug.itemType !== "medicine") continue;
      const warnings = await checkAgainstPatient(tx, rx.patientId, drug, rxItems.filter((i) => i.id !== item?.id));
      if (needsOverride(warnings) && !input.warningsChecked) throw new AppError(`${drug.name}: ${warnings[0].message} Confirm you have checked this before dispensing.`);
    }
    // The register details come from the signed prescription itself.
    const snapshot = (rx.signedSnapshot ?? {}) as { prescriber?: { name?: string; registrationNumber?: string } };
    const [patient] = await tx.select().from(patients).where(eq(patients.id, rx.patientId)).limit(1);
    details.prescriberName = snapshot.prescriber?.name ?? details.prescriberName;
    details.prescriberRegNo = snapshot.prescriber?.registrationNumber ?? details.prescriberRegNo;
    details.patientName = patient ? displayPatientName(patient) : details.patientName;
    details.patientAddress = patient ? [patient.addressLine, patient.city].filter(Boolean).join(", ") || details.patientAddress : details.patientAddress;
  }

  // Charged to a stay: the bill collects it, and the admission names the patient and doctor.
  let admission: { id: string } | null = null;
  if (input.method === "inpatient") {
    const stay = input.admissionId ? await getAdmission(tx, input.admissionId, today) : null;
    if (!stay || stay.status !== "admitted") throw new AppError("Choose a patient who is admitted.");
    if (patientId && patientId !== stay.patientId) throw new AppError("That admission is for another patient.");
    admission = { id: stay.id };
    patientId = stay.patientId;
    details.prescriberName ??= stay.doctorName;
    details.patientName ??= stay.patient.name;
    details.patientAddress ??= [stay.patient.addressLine, stay.patient.city].filter(Boolean).join(", ") || null;
  }

  // Scheduled drugs leave the counter only with the details the law asks for.
  const missing = missingDetails(sized.map((s) => s.drug.schedule), details);
  if (missing.length) throw new AppError(`This sale has scheduled medicines: enter the ${missing.join(", ")}.`);

  // The buyer: credit needs a named customer; a GSTIN makes it B2B.
  let customer: CustomerRow | null = null;
  if (input.customerId) {
    customer = await getCustomer(tx, input.customerId);
    if (!customer || !customer.isActive) throw new AppError("Choose an active customer.");
  } else if (input.method === "credit" && patientId) {
    customer = await ensurePatientCustomer(tx, clinicId, patientId);
  }
  if (input.method === "credit" && !customer) throw new AppError("A credit sale needs a named customer.");
  const mode = taxModeFor(settings.gstScheme, settings.stateCode, customer?.stateCode ?? stateOfGstin(customer?.gstin));

  // Lock every batch involved in a fixed order so two sales cannot deadlock.
  const batchIds = [...new Set(input.lines.map((l) => l.batchId))].sort();
  const batches = await tx.select().from(stockBatches).where(inArray(stockBatches.id, batchIds)).orderBy(asc(stockBatches.id)).for("update");

  const lines = sized.map(({ line, drug, soldAs, units }) => {
    const batch = batches.find((b) => b.id === line.batchId);
    if (!batch || batch.drugId !== drug.id) throw new AppError("A selected batch does not match its medicine.");
    if (isExpired(batch.expiryDate, today)) throw new AppError(`Batch ${batch.batchNo} of ${drug.name} has expired and cannot be sold.`);
    // Never above what is printed on the batch in the customer's hand.
    const price = batchPrice(drug, batch, soldAs);
    if (!price) throw new AppError(`${drug.name} has no selling price${soldAs === "pack" ? ` per ${packWord(drug.form)}` : ""}. Set one in Medicines & supplies first.`);
    const each = toMinor(price);
    return { line, batch, drug, soldAs, units, each, gross: each * line.quantity, ...effectiveGst(drug, settings) };
  });

  // The same batch may appear on two lines: check the combined quantity.
  for (const batch of batches) {
    const wanted = lines.filter((p) => p.batch.id === batch.id).reduce((n, p) => n + p.units, 0);
    if (wanted > batch.quantity) {
      const drug = drugRows.find((d) => d.id === batch.drugId);
      throw new AppError(`Only ${batch.quantity} of ${drug?.name ?? "that medicine"} left in batch ${batch.batchNo}.`);
    }
  }

  const gross = lines.reduce((s, l) => s + l.gross, 0);
  const discount = toMinor(input.discount || "0");
  if (discount > gross) throw new AppError("The discount is more than the bill.");
  if (!authority.overrideDiscountLimit && discount * 100 > gross * settings.maxDiscountPercent) {
    throw new AppError(`Discounts above ${settings.maxDiscountPercent} % need a manager.`);
  }
  const priced = priceSale(
    lines.map((l) => ({ gross: l.gross, gstRate: l.gstRate })),
    { discount, roundOff: settings.roundOff, mode },
  );

  if (input.method === "credit" && customer?.creditLimit) {
    const owed = await customerBalance(tx, customer.id);
    if (owed + priced.total > toMinor(customer.creditLimit)) {
      throw new AppError(`${customer.name} would owe ${fromMinor(owed + priced.total)}, above their credit limit of ${customer.creditLimit}.`);
    }
  }

  // The invoice number is taken last: the counter row stays locked until commit.
  const fy = fiscalYear(today);
  const number = documentNumber("sale", fy, await nextCounter(tx, clinicId, counterKey("sale", fy)));
  const [sale] = await tx
    .insert(pharmacySales)
    .values({
      clinicId,
      number,
      patientId,
      prescriptionId: input.prescriptionId ?? null,
      customerName: details.patientName ?? customer?.name ?? null,
      customerPhone: input.customerPhone || customer?.phone || null,
      customerId: customer?.id ?? null,
      customerGstin: customer?.gstin ?? null,
      fiscalYear: fy,
      documentType: settings.gstScheme === "regular" ? "tax_invoice" : "bill_of_supply",
      interState: mode === "inter",
      discount: fromMinor(priced.discount),
      roundOff: fromMinor(priced.roundOff),
      taxTotal: fromMinor(priced.tax),
      prescriberName: details.prescriberName,
      prescriberRegNo: details.prescriberRegNo,
      patientAddress: details.patientAddress,
      total: fromMinor(priced.total),
      method: input.method,
      reference: input.reference ?? null,
      dispenseNote: input.dispenseNote?.trim() || null,
      soldBy: actorId,
    })
    .returning({ id: pharmacySales.id });

  let changedLines = 0;
  await tx.insert(pharmacySaleItems).values(
    lines.map((p, i) => {
      const t = priced.lines[i];
      const copy = pharmacyCopy(p.line, p.drug.id, rxItems, Boolean(input.prescriptionId));
      if (copy.lineChange !== "none" && copy.lineChange !== "as_prescribed") changedLines += 1;
      return {
        clinicId,
        saleId: sale.id,
        drugId: p.drug.id,
        batchId: p.batch.id,
        prescriptionItemId: p.line.prescriptionItemId ?? null,
        description: [p.drug.name, p.drug.strength].filter(Boolean).join(" "),
        batchNo: p.batch.batchNo,
        expiryDate: p.batch.expiryDate,
        quantity: p.units,
        soldAs: p.soldAs,
        packSize: p.soldAs === "pack" ? p.drug.packSize : 1,
        packs: p.soldAs === "pack" ? p.line.quantity : null,
        unitPrice: fromMinor(p.each),
        amount: fromMinor(t.gross),
        discount: fromMinor(t.discount),
        hsn: p.hsn,
        gstRate: String(t.gstRate),
        taxable: fromMinor(t.taxable),
        cgst: fromMinor(t.cgst),
        sgst: fromMinor(t.sgst),
        igst: fromMinor(t.igst),
        schedule: p.drug.schedule,
        unitCost: p.batch.unitCost,
        ...copy,
      };
    }),
  );
  for (const p of lines) {
    await moveStock(
      tx,
      clinicId,
      { drugId: p.drug.id, batchId: p.batch.id, change: -p.units, reason: input.prescriptionId ? "dispense" : "sale", sourceType: "pharmacy_sale", sourceId: sale.id },
      actorId,
    );
  }

  if (admission) {
    await addSourceCharge(tx, clinicId, admission.id, { kind: "pharmacy", description: `Pharmacy ${number}: ${lines.map((l) => l.drug.name).join(", ")}`.slice(0, 300), amount: fromMinor(priced.total), sourceType: "pharmacy_sale", sourceId: sale.id }, actorId);
  }

  let dispenseStatus: string | null = null;
  if (input.prescriptionId) {
    dispenseStatus = await refreshDispenseStatus(tx, input.prescriptionId, rxItems);
  }
  return { saleId: sale.id, number, total: fromMinor(priced.total), patientId, dispenseStatus, changedLines };
}

/** The sale line's own copy of the dosage, and how it differs from the doctor's. */
function pharmacyCopy(line: SaleLine, drugId: string, rxItems: (typeof prescriptionItems.$inferSelect)[], dispensing: boolean) {
  if (!dispensing) return { dose: null, frequency: null, durationDays: null, instructions: null, lineChange: "none" as const, prescribedText: null };
  const item = rxItems.find((i) => i.id === line.prescriptionItemId) ?? null;
  const given: Dosage = {
    dose: line.dosage?.dose?.trim() || item?.dose || null,
    frequency: line.dosage?.frequency?.trim() || item?.frequency || null,
    durationDays: line.dosage?.durationDays === undefined ? (item?.durationDays ?? null) : line.dosage.durationDays,
    instructions: line.dosage?.instructions === undefined ? (item?.instructions ?? null) : line.dosage.instructions.trim() || null,
  };
  const lineChange = classifyLine(item, given, drugId);
  const prescribedText = item && lineChange !== "as_prescribed" ? `${item.drugName}: ${dosageText(item)}`.slice(0, 400) : null;
  return { ...given, lineChange, prescribedText };
}

/** Dispensed when every line has had its full quantity; partial if some; pending if none (after returns). */
export async function refreshDispenseStatus(tx: Tx, prescriptionId: string, items?: (typeof prescriptionItems.$inferSelect)[]) {
  const rxItems = items ?? (await tx.select().from(prescriptionItems).where(eq(prescriptionItems.prescriptionId, prescriptionId)));
  const given = await dispensedQuantities(tx, prescriptionId);
  const complete = rxItems.every((item) => (given.get(item.id) ?? 0) >= (suggestQuantity(item) ?? 1));
  const any = [...given.values()].some((n) => n > 0);
  const status = complete ? "dispensed" : any ? "partial" : "pending";
  await tx.update(prescriptions).set({ dispenseStatus: status, updatedAt: new Date() }).where(eq(prescriptions.id, prescriptionId));
  return status;
}

/** Units given per prescription line: sold minus returned. */
async function dispensedQuantities(tx: Tx, prescriptionId: string) {
  const rows = await tx
    .select({
      itemId: pharmacySaleItems.prescriptionItemId,
      qty: sql<number>`(sum(${pharmacySaleItems.quantity}) - coalesce(sum((select sum(ri.quantity) from app.sale_return_items ri where ri.sale_item_id = ${pharmacySaleItems.id})), 0))::int`,
    })
    .from(pharmacySaleItems)
    .innerJoin(pharmacySales, eq(pharmacySales.id, pharmacySaleItems.saleId))
    .where(eq(pharmacySales.prescriptionId, prescriptionId))
    .groupBy(pharmacySaleItems.prescriptionItemId);
  return new Map(rows.filter((r) => r.itemId).map((r) => [r.itemId!, r.qty]));
}

/** Warnings for a medicine the doctor did not write, shown before it is given. */
export async function dispenseWarnings(tx: Tx, prescriptionId: string, drugId: string, replacesItemId: string | null) {
  const [rx] = await tx.select({ patientId: prescriptions.patientId }).from(prescriptions).where(eq(prescriptions.id, prescriptionId)).limit(1);
  const [drug] = await tx.select().from(drugs).where(eq(drugs.id, drugId)).limit(1);
  if (!rx || !drug) throw new AppError("Prescription or medicine not found.");
  if (drug.itemType !== "medicine") return [];
  const others = (await tx.select().from(prescriptionItems).where(eq(prescriptionItems.prescriptionId, prescriptionId))).filter((i) => i.id !== replacesItemId);
  return checkAgainstPatient(tx, rx.patientId, drug, others);
}

/** Everything given against a prescription so far, newest first. */
export async function dispensingHistory(tx: Tx, prescriptionId: string) {
  const rows = await tx
    .select({
      item: pharmacySaleItems,
      saleNumber: pharmacySales.number,
      soldAt: pharmacySales.soldAt,
      note: pharmacySales.dispenseNote,
      form: drugs.form,
      returned: sql<number>`coalesce((select sum(ri.quantity) from app.sale_return_items ri where ri.sale_item_id = ${pharmacySaleItems.id}), 0)::int`,
      title: users.title,
      firstName: users.firstName,
      lastName: users.lastName,
    })
    .from(pharmacySaleItems)
    .innerJoin(pharmacySales, eq(pharmacySales.id, pharmacySaleItems.saleId))
    .innerJoin(drugs, eq(drugs.id, pharmacySaleItems.drugId))
    .innerJoin(users, eq(users.id, pharmacySales.soldBy))
    .where(eq(pharmacySales.prescriptionId, prescriptionId))
    .orderBy(desc(pharmacySales.soldAt));
  return rows.map((r) => ({ ...r.item, saleNumber: r.saleNumber, soldAt: r.soldAt, note: r.note, form: r.form, returned: r.returned, soldByName: staffName(r) }));
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
  return queueItems(tx, today, and(eq(prescriptions.status, "signed"), inArray(prescriptions.dispenseStatus, ["pending", "partial"]), gte(prescriptions.signedAt, since)), asc(prescriptions.signedAt));
}

/**
 * A patient at the counter gives a name, phone or record number: their
 * prescriptions, newest first, however old, whether or not fully filled.
 */
export async function findPrescriptionsForPatient(tx: Tx, query: string, today: string): Promise<PharmacyQueueItem[]> {
  if (query.trim().length < 2) return [];
  const found = await searchPatients(tx, query, today, 20);
  if (found.length === 0) return [];
  const list = await queueItems(tx, today, and(eq(prescriptions.status, "signed"), inArray(prescriptions.patientId, found.map((p) => p.id))), desc(prescriptions.signedAt));
  return list.slice(0, 30);
}

async function queueItems(tx: Tx, today: string, where: SQL | undefined, order: SQL): Promise<PharmacyQueueItem[]> {
  const rows = await tx
    .select({ rx: prescriptions, patient: patients, title: users.title, firstName: users.firstName, lastName: users.lastName })
    .from(prescriptions)
    .innerJoin(patients, eq(patients.id, prescriptions.patientId))
    .innerJoin(users, eq(users.id, prescriptions.prescriberId))
    .where(where)
    .orderBy(order);
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
        daysLeft: daysLeft(needed, item.durationDays, needed === null ? null : Math.max(0, needed - dispensed)),
        stock: options
          .filter((o) => o.drug.genericName.trim().toLowerCase() === item.genericName.trim().toLowerCase())
          .map((o) => ({
            drugId: o.drug.id,
            drugName: o.drug.name,
            form: o.drug.form,
            price: o.drug.price,
            packPrice: o.drug.packPrice,
            packSize: o.drug.packSize,
            gstRate: o.drug.gstRate,
            rack: o.drug.rack,
            batchId: o.batch.id,
            batchNo: o.batch.batchNo,
            expiryDate: o.batch.expiryDate,
            quantity: o.batch.quantity,
            mrp: o.batch.mrp,
            mrpPackSize: o.batch.packSize,
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

/** Billed in the window, credit notes issued in it, and the net of the two. */
export async function salesTotal(tx: Tx, from: Date, to: Date) {
  const [row] = await tx
    .select({ total: sql<string>`coalesce(sum(${pharmacySales.total}), 0)::numeric(12,2)::text`, count: sql<number>`count(*)::int` })
    .from(pharmacySales)
    .where(and(gte(pharmacySales.soldAt, from), lt(pharmacySales.soldAt, to)));
  const [back] = await tx
    .select({ total: sql<string>`coalesce(sum(${saleReturns.total}), 0)::numeric(12,2)::text` })
    .from(saleReturns)
    .where(and(gte(saleReturns.createdAt, from), lt(saleReturns.createdAt, to)));
  const billed = row?.total ?? "0.00";
  const returned = back?.total ?? "0.00";
  return { billed, returned, total: fromMinor(toMinor(billed) - toMinor(returned)), count: row?.count ?? 0 };
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
  const items = (
    await tx
      .select({ item: pharmacySaleItems, form: drugs.form })
      .from(pharmacySaleItems)
      .innerJoin(drugs, eq(drugs.id, pharmacySaleItems.drugId))
      .where(eq(pharmacySaleItems.saleId, saleId))
  ).map((r) => ({ ...r.item, form: r.form }));
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
        sql`(${drugs.barcode} = ${query.trim()} or ${drugs.name} ilike ${`%${term}%`} or ${drugs.genericName} ilike ${`%${term}%`} or exists (select 1 from app.drug_aliases a where a.drug_id = ${drugs.id} and a.alias ilike ${`%${term}%`}))`,
        sql`${stockBatches.quantity} > 0`,
        sql`${stockBatches.expiryDate} >= ${today}`,
      ),
    )
    .orderBy(asc(drugs.name), asc(stockBatches.expiryDate))
    .limit(60);
  const byDrug = new Map<
    string,
    {
      drugId: string;
      name: string;
      genericName: string;
      form: string;
      strength: string | null;
      price: string | null;
      packPrice: string | null;
      packSize: number;
      hsn: string | null;
      gstRate: string | null;
      itemType: string;
      schedule: string;
      rack: string | null;
      /** The search was an exact scan of this item's barcode. */
      barcodeMatch: boolean;
      batches: { id: string; batchNo: string; expiryDate: string; quantity: number; mrp: string | null; packSize: number | null }[];
    }
  >();
  for (const r of rows) {
    const entry = byDrug.get(r.drug.id) ?? {
      drugId: r.drug.id,
      name: r.drug.name,
      genericName: r.drug.genericName,
      form: r.drug.form,
      strength: r.drug.strength,
      price: r.drug.price,
      packPrice: r.drug.packPrice,
      packSize: r.drug.packSize,
      hsn: r.drug.hsn,
      gstRate: r.drug.gstRate,
      itemType: r.drug.itemType,
      schedule: r.drug.schedule,
      rack: r.drug.rack,
      barcodeMatch: Boolean(r.drug.barcode) && r.drug.barcode === query.trim(),
      batches: [],
    };
    entry.batches.push({ id: r.batch.id, batchNo: r.batch.batchNo, expiryDate: r.batch.expiryDate, quantity: r.batch.quantity, mrp: r.batch.mrp, packSize: r.batch.packSize });
    byDrug.set(r.drug.id, entry);
  }
  return [...byDrug.values()];
}

export type SellableDrug = Awaited<ReturnType<typeof sellableStock>>[number];
