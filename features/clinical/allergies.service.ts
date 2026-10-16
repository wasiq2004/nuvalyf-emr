import "server-only";

// Allergies are patient-level and add-only: a wrong entry is corrected (or
// marked "entered in error") with a written reason, and the previous version
// is kept in allergy_history. Rows are never deleted (database trigger).
import { and, asc, desc, eq } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import { allergies, allergyClasses, allergyHistory, patients, users } from "@/lib/db/schema";
import { AppError } from "@/lib/errors";
import { staffName } from "./encounters.service";

export const ALLERGY_SEVERITIES = ["mild", "moderate", "severe"] as const;
export const ALLERGY_STATUSES = ["active", "resolved", "entered_in_error"] as const;

export type AllergyView = {
  id: string;
  substance: string;
  allergyClassId: string | null;
  className: string | null;
  reaction: string | null;
  severity: string;
  status: string;
  recordedAt: Date;
  recordedByName: string;
  corrections: number;
};

export async function listAllergies(tx: Tx, patientId: string): Promise<AllergyView[]> {
  const rows = await tx
    .select({
      allergy: allergies,
      className: allergyClasses.name,
      title: users.title,
      firstName: users.firstName,
      lastName: users.lastName,
    })
    .from(allergies)
    .leftJoin(allergyClasses, eq(allergyClasses.id, allergies.allergyClassId))
    .innerJoin(users, eq(users.id, allergies.recordedBy))
    .where(eq(allergies.patientId, patientId))
    .orderBy(asc(allergies.recordedAt));
  const history = await tx
    .select({ allergyId: allergyHistory.allergyId })
    .from(allergyHistory)
    .innerJoin(allergies, eq(allergies.id, allergyHistory.allergyId))
    .where(eq(allergies.patientId, patientId));
  return rows.map((r) => ({
    id: r.allergy.id,
    substance: r.allergy.substance,
    allergyClassId: r.allergy.allergyClassId,
    className: r.className,
    reaction: r.allergy.reaction,
    severity: r.allergy.severity,
    status: r.allergy.status,
    recordedAt: r.allergy.recordedAt,
    recordedByName: staffName(r),
    corrections: history.filter((h) => h.allergyId === r.allergy.id).length,
  }));
}

export type AllergyInput = {
  substance: string;
  allergyClassId: string | null;
  reaction?: string;
  severity: (typeof ALLERGY_SEVERITIES)[number];
};

export async function addAllergy(tx: Tx, clinicId: string, patientId: string, input: AllergyInput, userId: string) {
  const [patient] = await tx.select({ id: patients.id }).from(patients).where(eq(patients.id, patientId)).limit(1);
  if (!patient) throw new AppError("Patient not found.");
  const existing = await tx
    .select({ substance: allergies.substance })
    .from(allergies)
    .where(and(eq(allergies.patientId, patientId), eq(allergies.status, "active")));
  if (existing.some((a) => a.substance.trim().toLowerCase() === input.substance.trim().toLowerCase())) {
    throw new AppError("This allergy is already recorded.");
  }
  const [row] = await tx
    .insert(allergies)
    .values({
      clinicId,
      patientId,
      substance: input.substance,
      allergyClassId: input.allergyClassId,
      reaction: input.reaction ?? null,
      severity: input.severity,
      recordedBy: userId,
    })
    .returning({ id: allergies.id });
  // A recorded allergy replaces any earlier "no known allergies".
  await tx.update(patients).set({ noKnownAllergiesAt: null, noKnownAllergiesBy: null }).where(eq(patients.id, patientId));
  return row;
}

export async function correctAllergy(
  tx: Tx,
  clinicId: string,
  id: string,
  change: { severity: (typeof ALLERGY_SEVERITIES)[number]; status: (typeof ALLERGY_STATUSES)[number]; reaction?: string },
  reason: string,
  userId: string,
) {
  const [current] = await tx.select().from(allergies).where(eq(allergies.id, id)).for("update").limit(1);
  if (!current) throw new AppError("Allergy not found.");
  if (current.status === "entered_in_error") throw new AppError("This entry was marked as entered in error and is closed.");
  const reaction = change.reaction ?? null;
  if (current.severity === change.severity && current.status === change.status && (current.reaction ?? null) === reaction) {
    throw new AppError("Nothing has changed.");
  }
  await tx.insert(allergyHistory).values({
    clinicId,
    allergyId: id,
    previous: { severity: current.severity, status: current.status, reaction: current.reaction },
    reason,
    changedBy: userId,
  });
  await tx
    .update(allergies)
    .set({ severity: change.severity, status: change.status, reaction, updatedAt: new Date() })
    .where(eq(allergies.id, id));
  return { patientId: current.patientId };
}

export async function listAllergyHistory(tx: Tx, allergyId: string) {
  const rows = await tx
    .select({ h: allergyHistory, title: users.title, firstName: users.firstName, lastName: users.lastName })
    .from(allergyHistory)
    .innerJoin(users, eq(users.id, allergyHistory.changedBy))
    .where(eq(allergyHistory.allergyId, allergyId))
    .orderBy(desc(allergyHistory.changedAt));
  return rows.map((r) => ({ ...r.h, changedByName: staffName(r) }));
}

/** "Asked, and the patient has no known allergies." */
export async function recordNoKnownAllergies(tx: Tx, patientId: string, userId: string) {
  const active = await tx
    .select({ id: allergies.id })
    .from(allergies)
    .where(and(eq(allergies.patientId, patientId), eq(allergies.status, "active")))
    .limit(1);
  if (active.length) throw new AppError("This patient has active allergies recorded.");
  const [row] = await tx
    .update(patients)
    .set({ noKnownAllergiesAt: new Date(), noKnownAllergiesBy: userId })
    .where(eq(patients.id, patientId))
    .returning({ id: patients.id });
  if (!row) throw new AppError("Patient not found.");
}

export async function listAllergyClassOptions(tx: Tx) {
  return tx
    .select({ id: allergyClasses.id, name: allergyClasses.name })
    .from(allergyClasses)
    .where(eq(allergyClasses.isActive, true))
    .orderBy(asc(allergyClasses.name));
}
