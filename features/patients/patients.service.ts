import "server-only";

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import { clinicCounters, duplicateOverrides, patients, tasks, visits } from "@/lib/db/schema";
import { AppError } from "@/lib/errors";
import {
  ageOn,
  displayPatientName,
  isLikelyDuplicate,
  matchReasons,
  normalizeMobile,
  normalizeName,
  type DuplicateCandidate,
} from "./patient-rules";

export type PatientInput = {
  firstName: string;
  lastName?: string;
  sex: "male" | "female" | "other" | "unknown";
  dateOfBirth?: string;
  statedAgeYears?: number;
  mobile?: string;
  altPhone?: string;
  email?: string;
  addressLine?: string;
  city?: string;
};

/** Next value of a per-clinic counter, atomically (row lock on upsert). */
export async function nextCounter(tx: Tx, clinicId: string, key: string): Promise<number> {
  const [row] = await tx
    .insert(clinicCounters)
    .values({ clinicId, key, value: 1 })
    .onConflictDoUpdate({
      target: [clinicCounters.clinicId, clinicCounters.key],
      set: { value: sql`${clinicCounters.value} + 1` },
    })
    .returning({ value: clinicCounters.value });
  return row.value;
}

async function nextMrn(tx: Tx, clinicId: string): Promise<string> {
  return `P-${String(await nextCounter(tx, clinicId, "mrn")).padStart(6, "0")}`;
}

const nameExpr = sql`lower(coalesce(${patients.firstName}, '') || ' ' || coalesce(${patients.lastName}, ''))`;

export type PatientSummary = {
  id: string;
  mrn: string;
  name: string;
  sex: string;
  age: number | null;
  mobile: string | null;
  isPlaceholder: boolean;
  lastVisitDate: string | null;
};

function toSummary(row: typeof patients.$inferSelect & { lastVisitDate?: string | null }, today: string): PatientSummary {
  return {
    id: row.id,
    mrn: row.mrn,
    name: displayPatientName(row),
    sex: row.sex,
    age: ageOn(row, today),
    mobile: row.mobile,
    isPlaceholder: row.isPlaceholder,
    lastVisitDate: row.lastVisitDate ?? null,
  };
}

/** Search by record number, mobile (any format) or name (fuzzy). */
export async function searchPatients(tx: Tx, query: string, today: string, limit = 50): Promise<PatientSummary[]> {
  const q = query.trim();
  const lastVisit = sql<string | null>`(select max(${visits.visitDate})::text from ${visits} where ${visits.patientId} = ${patients.id})`;

  if (!q) {
    const rows = await tx
      .select({ patient: patients, lastVisitDate: lastVisit })
      .from(patients)
      .orderBy(desc(patients.updatedAt))
      .limit(20);
    return rows.map((r) => toSummary({ ...r.patient, lastVisitDate: r.lastVisitDate }, today));
  }

  const mobile = normalizeMobile(q);
  const name = normalizeName(q);
  const conditions = [
    sql`lower(${patients.mrn}) = ${q.toLowerCase()}`,
    sql`${nameExpr} like ${`%${name}%`}`,
    sql`similarity(${nameExpr}, ${name}) > 0.3`,
  ];
  if (mobile) {
    conditions.push(sql`right(regexp_replace(coalesce(${patients.mobile}, ''), '\\D', '', 'g'), 10) = ${mobile.slice(-10)}`);
  }

  const rows = await tx
    .select({ patient: patients, lastVisitDate: lastVisit, score: sql<number>`similarity(${nameExpr}, ${name})` })
    .from(patients)
    .where(sql.join(conditions, sql` OR `))
    .orderBy(desc(sql`similarity(${nameExpr}, ${name})`), desc(patients.updatedAt))
    .limit(limit);

  return rows.map((r) => toSummary({ ...r.patient, lastVisitDate: r.lastVisitDate }, today));
}

/** Existing patients who might be the person being registered. */
export async function findDuplicateCandidates(
  tx: Tx,
  fields: { firstName: string; lastName?: string | null; mobile?: string | null; dateOfBirth?: string | null; statedAgeYears?: number | null },
  today: string,
): Promise<(DuplicateCandidate & { likely: boolean; reasons: string[]; age: number | null; mobile: string | null })[]> {
  const name = normalizeName(`${fields.firstName} ${fields.lastName ?? ""}`);
  const mobile = normalizeMobile(fields.mobile);
  const mobileMatch = mobile
    ? sql`right(regexp_replace(coalesce(${patients.mobile}, ''), '\\D', '', 'g'), 10) = ${mobile.slice(-10)}`
    : sql`false`;

  const rows = await tx
    .select({
      patient: patients,
      similarity: sql<number>`similarity(${nameExpr}, ${name})`,
      sameMobile: sql<boolean>`${mobileMatch}`,
    })
    .from(patients)
    .where(sql`similarity(${nameExpr}, ${name}) > 0.3 OR ${mobileMatch}`)
    .orderBy(desc(sql`similarity(${nameExpr}, ${name})`))
    .limit(10);

  const inputAge = fields.dateOfBirth
    ? ageOn({ dateOfBirth: fields.dateOfBirth, statedAgeYears: null, statedAgeOn: null }, today)
    : (fields.statedAgeYears ?? null);

  return rows.map((r) => {
    const age = ageOn(r.patient, today);
    const candidate: DuplicateCandidate = {
      id: r.patient.id,
      mrn: r.patient.mrn,
      name: displayPatientName(r.patient),
      nameSimilarity: Number(r.similarity),
      sameMobile: Boolean(r.sameMobile),
      sameDob: Boolean(fields.dateOfBirth && r.patient.dateOfBirth === fields.dateOfBirth),
      ageGap: inputAge !== null && age !== null ? Math.abs(inputAge - age) : null,
    };
    return { ...candidate, likely: isLikelyDuplicate(candidate), reasons: matchReasons(candidate), age, mobile: r.patient.mobile };
  });
}

function patientValues(input: PatientInput, today: string) {
  return {
    firstName: input.firstName,
    lastName: input.lastName ?? null,
    sex: input.sex,
    dateOfBirth: input.dateOfBirth ?? null,
    statedAgeYears: input.dateOfBirth ? null : (input.statedAgeYears ?? null),
    statedAgeOn: input.dateOfBirth || input.statedAgeYears == null ? null : today,
    mobile: input.mobile ?? null,
    altPhone: input.altPhone ?? null,
    email: input.email ?? null,
    addressLine: input.addressLine ?? null,
    city: input.city ?? null,
  };
}

export async function registerPatient(
  tx: Tx,
  clinicId: string,
  input: PatientInput,
  options: { likelyIds: string[]; reason?: string; actorId: string; today: string },
): Promise<{ id: string; mrn: string }> {
  if (options.likelyIds.length > 0 && (!options.reason || options.reason.trim().length < 10)) {
    throw new AppError("This looks like an existing patient. Explain in a sentence why a new record is needed.");
  }

  const mrn = await nextMrn(tx, clinicId);
  const [row] = await tx
    .insert(patients)
    .values({ clinicId, mrn, ...patientValues(input, options.today), createdBy: options.actorId })
    .returning({ id: patients.id, mrn: patients.mrn });

  if (options.likelyIds.length > 0) {
    await tx.insert(duplicateOverrides).values({
      clinicId,
      patientId: row.id,
      candidateIds: options.likelyIds,
      reason: options.reason!.trim(),
      createdBy: options.actorId,
    });
  }
  return row;
}

/** Updates demographics. Completing a placeholder closes its registration task. */
export async function updatePatient(tx: Tx, id: string, input: PatientInput, actorId: string, today: string) {
  const [current] = await tx.select().from(patients).where(eq(patients.id, id)).limit(1);
  if (!current) throw new AppError("Patient not found.");

  await tx
    .update(patients)
    .set({ ...patientValues(input, today), isPlaceholder: false, updatedAt: new Date() })
    .where(eq(patients.id, id));

  if (current.isPlaceholder) {
    await tx
      .update(tasks)
      .set({ status: "done", completedBy: actorId, completedAt: new Date() })
      .where(and(eq(tasks.patientId, id), eq(tasks.type, "complete_registration"), eq(tasks.status, "open")));
  }
  return { wasPlaceholder: current.isPlaceholder };
}

export async function getPatient(tx: Tx, id: string, today: string) {
  const [row] = await tx.select().from(patients).where(eq(patients.id, id)).limit(1);
  if (!row) return null;
  return { ...row, name: displayPatientName(row), age: ageOn(row, today) };
}

export async function getOverrides(tx: Tx, patientId: string) {
  return tx.select().from(duplicateOverrides).where(eq(duplicateOverrides.patientId, patientId));
}

export async function patientsByIds(tx: Tx, ids: string[]) {
  if (ids.length === 0) return [];
  return tx.select({ id: patients.id, mrn: patients.mrn, firstName: patients.firstName, lastName: patients.lastName }).from(patients).where(inArray(patients.id, ids));
}

/**
 * Emergency admission: one required label, no duplicate search, straight to
 * the front of the queue, and an URGENT task to complete the record.
 */
export async function admitEmergency(
  tx: Tx,
  clinicId: string,
  input: { label: string; sex?: "male" | "female" | "other" | "unknown"; approxAge?: number; companionPhone?: string; doctorId?: string | null },
  actorId: string,
  today: string,
) {
  const mrn = await nextMrn(tx, clinicId);
  const [patient] = await tx
    .insert(patients)
    .values({
      clinicId,
      mrn,
      isPlaceholder: true,
      emergencyLabel: input.label,
      sex: input.sex ?? "unknown",
      statedAgeYears: input.approxAge ?? null,
      statedAgeOn: input.approxAge != null ? today : null,
      createdBy: actorId,
    })
    .returning({ id: patients.id, mrn: patients.mrn });

  const [visit] = await tx
    .insert(visits)
    .values({
      clinicId,
      patientId: patient.id,
      doctorId: input.doctorId ?? null,
      visitDate: today,
      status: "waiting",
      isEmergency: true,
      companionPhone: input.companionPhone ?? null,
      checkedInBy: actorId,
    })
    .returning({ id: visits.id });

  await tx.insert(tasks).values({
    clinicId,
    type: "complete_registration",
    priority: "urgent",
    title: `Complete the record for emergency patient "${input.label}" (${patient.mrn})`,
    patientId: patient.id,
    createdBy: actorId,
  });

  return { patientId: patient.id, mrn: patient.mrn, visitId: visit.id };
}
