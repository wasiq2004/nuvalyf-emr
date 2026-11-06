import "server-only";

// Beds, admissions and the running bill (docs/INPATIENT_DESIGN.md). Money is
// never stored as a running total: the bill is worked out from the stays,
// charges and payments every time, and a change to it is another record.
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import { admissionCharges, admissionPayments, admissions, bedCategories, bedStays, beds, encounters, inpatientSettings, patients, users, visits } from "@/lib/db/schema";
import { AppError, pgError } from "@/lib/errors";
import { fromMinor, toMinor } from "@/lib/money";
import { ageOn, displayPatientName } from "@/features/patients/patient-rules";
import { nextCounter } from "@/features/patients/patients.service";
import { staffName } from "@/features/clinical/encounters.service";
import { counterKey, documentNumber, fiscalYear } from "@/features/pharmacy/numbering";
import { billSegments, billTotals, type BillingMode } from "./bed-billing-rules";
import { sectionsFrom, type SectionChoice } from "./summary-rules";

export type InpatientSettings = { billingMode: BillingMode; minimumHours: number; sections: SectionChoice[]; configured: boolean };

export async function getInpatientSettings(tx: Tx, clinicId: string): Promise<InpatientSettings> {
  const [row] = await tx.select().from(inpatientSettings).where(eq(inpatientSettings.clinicId, clinicId)).limit(1);
  if (!row) return { billingMode: "hourly", minimumHours: 24, sections: sectionsFrom(null), configured: false };
  return { billingMode: row.billingMode as BillingMode, minimumHours: row.minimumHours, sections: sectionsFrom(row.summarySections), configured: true };
}

export async function saveInpatientSettings(tx: Tx, clinicId: string, input: { billingMode: BillingMode; minimumHours: number; sections: SectionChoice[] }, actorId: string) {
  const values = { billingMode: input.billingMode, minimumHours: input.minimumHours, summarySections: input.sections, updatedBy: actorId, updatedAt: new Date() };
  await tx.insert(inpatientSettings).values({ clinicId, ...values }).onConflictDoUpdate({ target: inpatientSettings.clinicId, set: values });
}

// ---------------------------------------------------------------------------
// Bed categories and beds
// ---------------------------------------------------------------------------

function guardDuplicate(error: unknown, message: string): never {
  if (pgError(error)?.code === "23505") throw new AppError(message);
  throw error;
}

export function listBedCategories(tx: Tx) {
  return tx.select().from(bedCategories).orderBy(sql`${bedCategories.isActive} desc`, asc(bedCategories.name));
}

export async function saveBedCategory(tx: Tx, clinicId: string, id: string | null, input: { name: string; dailyRate: string; isActive?: boolean }) {
  const values = { name: input.name, dailyRate: input.dailyRate, isActive: input.isActive ?? true };
  try {
    if (id) {
      const [row] = await tx.update(bedCategories).set(values).where(eq(bedCategories.id, id)).returning({ id: bedCategories.id });
      if (!row) throw new AppError("Category not found.");
      return row;
    }
    const [row] = await tx.insert(bedCategories).values({ clinicId, ...values }).returning({ id: bedCategories.id });
    return row;
  } catch (error) {
    guardDuplicate(error, `There is already a category called ${input.name}.`);
  }
}

export async function saveBed(tx: Tx, clinicId: string, id: string | null, input: { categoryId: string; ward?: string; code: string; isActive?: boolean }) {
  const values = { categoryId: input.categoryId, ward: input.ward ?? null, code: input.code, isActive: input.isActive ?? true };
  try {
    if (id) {
      const [row] = await tx.update(beds).set(values).where(eq(beds.id, id)).returning({ id: beds.id });
      if (!row) throw new AppError("Bed not found.");
      return row;
    }
    const [row] = await tx.insert(beds).values({ clinicId, ...values }).returning({ id: beds.id });
    return row;
  } catch (error) {
    guardDuplicate(error, `There is already a bed ${input.code}.`);
  }
}

/** Every bed with who is in it. */
export async function bedBoard(tx: Tx, today: string) {
  const rows = await tx
    .select({ bed: beds, category: bedCategories, stay: bedStays, admission: admissions, patient: patients })
    .from(beds)
    .innerJoin(bedCategories, eq(bedCategories.id, beds.categoryId))
    .leftJoin(bedStays, and(eq(bedStays.bedId, beds.id), isNull(bedStays.endedAt)))
    .leftJoin(admissions, eq(admissions.id, bedStays.admissionId))
    .leftJoin(patients, eq(patients.id, admissions.patientId))
    .orderBy(asc(beds.ward), asc(beds.code));
  return rows.map((r) => ({
    id: r.bed.id,
    code: r.bed.code,
    ward: r.bed.ward,
    isActive: r.bed.isActive,
    categoryId: r.category.id,
    categoryName: r.category.name,
    dailyRate: r.category.dailyRate,
    admissionId: r.admission?.id ?? null,
    patientName: r.patient ? displayPatientName(r.patient) : null,
    patientMrn: r.patient?.mrn ?? null,
    patientAge: r.patient ? ageOn(r.patient, today) : null,
  }));
}

const bedLabel = (bed: { ward: string | null; code: string }) => (bed.ward ? `${bed.ward} / ${bed.code}` : bed.code);

async function freeBed(tx: Tx, bedId: string) {
  const [bed] = await tx.select().from(beds).where(eq(beds.id, bedId)).for("update").limit(1);
  if (!bed || !bed.isActive) throw new AppError("Choose a bed that is in use.");
  const [taken] = await tx.select({ id: bedStays.id }).from(bedStays).where(and(eq(bedStays.bedId, bedId), isNull(bedStays.endedAt))).limit(1);
  if (taken) throw new AppError(`Bed ${bed.code} is occupied.`);
  const [category] = await tx.select().from(bedCategories).where(eq(bedCategories.id, bed.categoryId)).limit(1);
  return { bed, category };
}

// ---------------------------------------------------------------------------
// Admission
// ---------------------------------------------------------------------------

export type AdmitInput = { patientId: string; doctorId: string; bedId: string; reason: string; admittedAt: Date; attendantName?: string; attendantPhone?: string };

export async function admitPatient(tx: Tx, clinicId: string, input: AdmitInput, actorId: string, today: string, now = new Date()) {
  if (input.admittedAt.getTime() > now.getTime() + 60_000) throw new AppError("The admission time cannot be in the future.");
  const [open] = await tx.select({ id: admissions.id }).from(admissions).where(and(eq(admissions.patientId, input.patientId), eq(admissions.status, "admitted"))).limit(1);
  if (open) throw new AppError("This patient is already admitted.");
  const { bed, category } = await freeBed(tx, input.bedId);
  const settings = await getInpatientSettings(tx, clinicId);

  // The stay is one long visit: it never joins the outpatient queue.
  const [visit] = await tx
    .insert(visits)
    .values({ clinicId, patientId: input.patientId, doctorId: input.doctorId, visitDate: today, status: "inpatient", arrivedAt: input.admittedAt, checkedInBy: actorId })
    .returning({ id: visits.id });
  const [encounter] = await tx
    .insert(encounters)
    .values({ clinicId, visitId: visit.id, patientId: input.patientId, doctorId: input.doctorId, chiefComplaint: input.reason })
    .returning({ id: encounters.id });

  const fy = fiscalYear(today);
  const number = documentNumber("admission", fy, await nextCounter(tx, clinicId, counterKey("admission", fy)));
  try {
    const [admission] = await tx
      .insert(admissions)
      .values({
        clinicId,
        number,
        patientId: input.patientId,
        visitId: visit.id,
        encounterId: encounter.id,
        doctorId: input.doctorId,
        reason: input.reason,
        attendantName: input.attendantName ?? null,
        attendantPhone: input.attendantPhone ?? null,
        admittedAt: input.admittedAt,
        billingMode: settings.billingMode,
        minimumHours: settings.minimumHours,
        createdBy: actorId,
      })
      .returning({ id: admissions.id });
    await tx.insert(bedStays).values({ clinicId, admissionId: admission.id, bedId: bed.id, bedLabel: bedLabel(bed), categoryName: category.name, dailyRate: category.dailyRate, startedAt: input.admittedAt });
    return { id: admission.id, number, encounterId: encounter.id };
  } catch (error) {
    guardDuplicate(error, "This patient or bed was just taken. Check and try again.");
  }
}

async function requireAdmitted(tx: Tx, id: string) {
  const [row] = await tx.select().from(admissions).where(eq(admissions.id, id)).for("update").limit(1);
  if (!row) throw new AppError("Admission not found.");
  if (row.status !== "admitted") throw new AppError("This patient has been discharged.");
  return row;
}

async function requireAdmission(tx: Tx, id: string) {
  const [row] = await tx.select().from(admissions).where(eq(admissions.id, id)).for("update").limit(1);
  if (!row) throw new AppError("Admission not found.");
  return row;
}

async function openStay(tx: Tx, admissionId: string) {
  const [stay] = await tx.select().from(bedStays).where(and(eq(bedStays.admissionId, admissionId), isNull(bedStays.endedAt))).for("update").limit(1);
  if (!stay) throw new AppError("This patient has no current bed.");
  return stay;
}

export async function transferBed(tx: Tx, clinicId: string, admissionId: string, bedId: string, at: Date, now = new Date()) {
  const admission = await requireAdmitted(tx, admissionId);
  const stay = await openStay(tx, admissionId);
  if (stay.bedId === bedId) throw new AppError("The patient is already in this bed.");
  if (at.getTime() < stay.startedAt.getTime()) throw new AppError("The move cannot be before the patient reached this bed.");
  if (at.getTime() > now.getTime() + 60_000) throw new AppError("The time of the move cannot be in the future.");
  const { bed, category } = await freeBed(tx, bedId);
  await tx.update(bedStays).set({ endedAt: at }).where(eq(bedStays.id, stay.id));
  await tx.insert(bedStays).values({ clinicId, admissionId, bedId: bed.id, bedLabel: bedLabel(bed), categoryName: category.name, dailyRate: category.dailyRate, startedAt: at });
  return { patientId: admission.patientId, from: stay.bedLabel, to: bedLabel(bed) };
}

export async function dischargePatient(tx: Tx, admissionId: string, at: Date, actorId: string, now = new Date()) {
  const admission = await requireAdmitted(tx, admissionId);
  const stay = await openStay(tx, admissionId);
  if (at.getTime() < stay.startedAt.getTime()) throw new AppError("Discharge cannot be before the patient reached their current bed.");
  if (at.getTime() > now.getTime() + 60_000) throw new AppError("The discharge time cannot be in the future.");
  await tx.update(bedStays).set({ endedAt: at }).where(eq(bedStays.id, stay.id));
  await tx.update(admissions).set({ status: "discharged", dischargedAt: at, dischargedBy: actorId, updatedAt: new Date() }).where(eq(admissions.id, admissionId));
  return { patientId: admission.patientId, number: admission.number };
}

export async function listAdmissions(tx: Tx, status: "admitted" | "discharged", today: string, limit = 100) {
  const rows = await tx
    .select({ admission: admissions, patient: patients, title: users.title, firstName: users.firstName, lastName: users.lastName, stay: bedStays })
    .from(admissions)
    .innerJoin(patients, eq(patients.id, admissions.patientId))
    .innerJoin(users, eq(users.id, admissions.doctorId))
    .leftJoin(bedStays, and(eq(bedStays.admissionId, admissions.id), isNull(bedStays.endedAt)))
    .where(eq(admissions.status, status))
    .orderBy(status === "admitted" ? asc(admissions.admittedAt) : desc(admissions.dischargedAt))
    .limit(limit);
  return rows.map((r) => ({
    id: r.admission.id,
    number: r.admission.number,
    patientId: r.patient.id,
    patientName: displayPatientName(r.patient),
    patientMrn: r.patient.mrn,
    patientAge: ageOn(r.patient, today),
    doctorName: staffName(r),
    bed: r.stay?.bedLabel ?? null,
    category: r.stay?.categoryName ?? null,
    admittedAt: r.admission.admittedAt,
    dischargedAt: r.admission.dischargedAt,
  }));
}

export async function openAdmissionFor(tx: Tx, patientId: string) {
  const [row] = await tx.select({ id: admissions.id, number: admissions.number, encounterId: admissions.encounterId }).from(admissions).where(and(eq(admissions.patientId, patientId), eq(admissions.status, "admitted"))).limit(1);
  return row ?? null;
}

export async function getAdmission(tx: Tx, id: string, today: string) {
  const [row] = await tx
    .select({ admission: admissions, patient: patients, title: users.title, firstName: users.firstName, lastName: users.lastName })
    .from(admissions)
    .innerJoin(patients, eq(patients.id, admissions.patientId))
    .innerJoin(users, eq(users.id, admissions.doctorId))
    .where(eq(admissions.id, id))
    .limit(1);
  if (!row) return null;
  return { ...row.admission, patient: { ...row.patient, name: displayPatientName(row.patient), age: ageOn(row.patient, today) }, doctorName: staffName(row) };
}

// ---------------------------------------------------------------------------
// The running bill
// ---------------------------------------------------------------------------

/** Worked out fresh: a stay still running is charged up to `now`. */
export async function admissionBill(tx: Tx, admissionId: string, now = new Date()) {
  const [admission] = await tx.select().from(admissions).where(eq(admissions.id, admissionId)).limit(1);
  if (!admission) return null;
  const stays = await tx.select().from(bedStays).where(eq(bedStays.admissionId, admissionId)).orderBy(asc(bedStays.startedAt));
  const charges = await tx.select().from(admissionCharges).where(eq(admissionCharges.admissionId, admissionId)).orderBy(asc(admissionCharges.createdAt));
  const payments = await tx
    .select({ payment: admissionPayments, title: users.title, firstName: users.firstName, lastName: users.lastName })
    .from(admissionPayments)
    .innerJoin(users, eq(users.id, admissionPayments.receivedBy))
    .where(eq(admissionPayments.admissionId, admissionId))
    .orderBy(asc(admissionPayments.receivedAt));

  // Times are kept to the minute: stray seconds never tip a stay into another hour.
  const minutesOf = (s: typeof bedStays.$inferSelect) => Math.max(0, Math.floor(((s.endedAt ?? now).getTime() - s.startedAt.getTime()) / 60_000));
  const billed = billSegments(
    stays.map((s) => ({ minutes: minutesOf(s), dailyRate: toMinor(s.dailyRate), overrideHours: s.overrideHours, overrideRate: s.overrideRate === null ? null : toMinor(s.overrideRate) })),
    admission.billingMode as BillingMode,
    admission.minimumHours,
  );
  const bedLines = stays.map((s, i) => ({ ...s, minutes: minutesOf(s), hours: billed[i].hours, rate: fromMinor(billed[i].rate), amount: fromMinor(billed[i].amount), overridden: billed[i].overridden }));
  const live = charges.filter((c) => !c.voidedAt);
  const paid = payments.reduce((s, p) => s + (p.payment.kind === "refund" ? -1 : 1) * toMinor(p.payment.amount), 0);
  const totals = billTotals(
    billed.reduce((s, b) => s + b.amount, 0),
    live.reduce((s, c) => s + toMinor(c.amount), 0),
    toMinor(admission.discount),
    paid,
  );
  return {
    billingMode: admission.billingMode as BillingMode,
    minimumHours: admission.minimumHours,
    discountReason: admission.discountReason,
    beds: bedLines,
    charges,
    payments: payments.map((p) => ({ ...p.payment, receivedByName: staffName(p) })),
    totals: Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, fromMinor(v)])) as Record<keyof typeof totals, string>,
    balance: totals.balance,
  };
}

export type ChargeInput = { kind: string; description: string; quantity: number; unitAmount: string };

export async function addCharge(tx: Tx, clinicId: string, admissionId: string, input: ChargeInput, actorId: string) {
  const admission = await requireAdmission(tx, admissionId);
  const amount = fromMinor(toMinor(input.unitAmount) * input.quantity);
  const [row] = await tx.insert(admissionCharges).values({ clinicId, admissionId, kind: input.kind, description: input.description, quantity: input.quantity, unitAmount: input.unitAmount, amount, createdBy: actorId }).returning({ id: admissionCharges.id });
  return { id: row.id, patientId: admission.patientId };
}

/** A charge is never deleted: it is struck out, with the reason. */
export async function voidCharge(tx: Tx, chargeId: string, reason: string, actorId: string) {
  const [row] = await tx
    .update(admissionCharges)
    .set({ voidedAt: new Date(), voidedBy: actorId, voidReason: reason })
    .where(and(eq(admissionCharges.id, chargeId), isNull(admissionCharges.voidedAt)))
    .returning({ id: admissionCharges.id, admissionId: admissionCharges.admissionId, amount: admissionCharges.amount, description: admissionCharges.description });
  if (!row) throw new AppError("That charge is already struck out.");
  return row;
}

/** An automatic line from pharmacy or the lab. Nothing to do for an outpatient. */
export async function addSourceCharge(tx: Tx, clinicId: string, admissionId: string, input: { kind: string; description: string; amount: string; sourceType: string; sourceId: string }, actorId: string) {
  await tx.insert(admissionCharges).values({ clinicId, admissionId, kind: input.kind, description: input.description, quantity: 1, unitAmount: input.amount, amount: input.amount, sourceType: input.sourceType, sourceId: input.sourceId, createdBy: actorId });
}

export async function admissionForEncounter(tx: Tx, encounterId: string) {
  const [row] = await tx.select({ id: admissions.id, status: admissions.status }).from(admissions).where(eq(admissions.encounterId, encounterId)).limit(1);
  return row ?? null;
}

export async function voidSourceCharge(tx: Tx, sourceType: string, sourceId: string, reason: string, actorId: string) {
  await tx
    .update(admissionCharges)
    .set({ voidedAt: new Date(), voidedBy: actorId, voidReason: reason })
    .where(and(eq(admissionCharges.sourceType, sourceType), eq(admissionCharges.sourceId, sourceId), isNull(admissionCharges.voidedAt)));
}

export async function chargeForSource(tx: Tx, sourceType: string, sourceId: string) {
  const [row] = await tx.select().from(admissionCharges).where(and(eq(admissionCharges.sourceType, sourceType), eq(admissionCharges.sourceId, sourceId))).limit(1);
  return row ?? null;
}

export async function adjustBedStay(tx: Tx, stayId: string, input: { hours: number | null; rate: string | null; reason: string }, actorId: string) {
  const [stay] = await tx.select().from(bedStays).where(eq(bedStays.id, stayId)).limit(1);
  if (!stay) throw new AppError("Bed stay not found.");
  await requireAdmission(tx, stay.admissionId);
  await tx.update(bedStays).set({ overrideHours: input.hours, overrideRate: input.rate, overrideReason: input.reason, overrideBy: actorId }).where(eq(bedStays.id, stayId));
  return { admissionId: stay.admissionId, bed: stay.bedLabel };
}

export async function setAdmissionDiscount(tx: Tx, admissionId: string, discount: string, reason: string, actorId: string, now = new Date()) {
  const admission = await requireAdmission(tx, admissionId);
  const bill = await admissionBill(tx, admissionId, now);
  if (toMinor(discount) > toMinor(bill!.totals.gross)) throw new AppError("The discount is more than the bill.");
  await tx.update(admissions).set({ discount, discountReason: reason, discountBy: actorId, updatedAt: new Date() }).where(eq(admissions.id, admissionId));
  return { patientId: admission.patientId };
}

export type PaymentInput = { kind: "advance" | "payment" | "refund"; amount: string; method: string; reference?: string; note?: string; idempotencyKey: string };

/** Any amount, any time, before or after discharge; a double-click records one. */
export async function recordAdmissionPayment(tx: Tx, clinicId: string, admissionId: string, input: PaymentInput, actorId: string, today: string, now = new Date()) {
  const admission = await requireAdmission(tx, admissionId);
  const [replay] = await tx.select().from(admissionPayments).where(eq(admissionPayments.idempotencyKey, input.idempotencyKey)).limit(1);
  if (replay) return { id: replay.id, number: replay.number, patientId: admission.patientId, replayed: true };
  const amount = toMinor(input.amount);
  if (amount <= 0) throw new AppError("Enter the amount.");
  if (input.kind === "refund") {
    const bill = await admissionBill(tx, admissionId, now);
    if (amount > toMinor(bill!.totals.paid)) throw new AppError(`Only ${bill!.totals.paid} has been paid; a refund cannot be more than that.`);
  }
  const fy = fiscalYear(today);
  const number = documentNumber("inpatientReceipt", fy, await nextCounter(tx, clinicId, counterKey("inpatientReceipt", fy)));
  const [row] = await tx
    .insert(admissionPayments)
    .values({ clinicId, admissionId, number, kind: input.kind, amount: fromMinor(amount), method: input.method, reference: input.reference ?? null, note: input.note ?? null, idempotencyKey: input.idempotencyKey, receivedBy: actorId })
    .returning({ id: admissionPayments.id });
  return { id: row.id, number, patientId: admission.patientId, replayed: false };
}

/** Admissions by id, for the pharmacy's "charge to the stay" list. */
export async function admissionsForCharging(tx: Tx, today: string) {
  return (await listAdmissions(tx, "admitted", today)).map((a) => ({ id: a.id, label: `${a.patientName} · ${a.patientMrn}${a.bed ? ` · ${a.bed}` : ""}` }));
}

export async function admissionsByIds(tx: Tx, ids: string[]) {
  return ids.length ? tx.select().from(admissions).where(inArray(admissions.id, ids)) : [];
}
