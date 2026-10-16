import "server-only";

import { and, asc, desc, eq, ilike, or, sql } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import { diagnoses, diagnosisCodes } from "@/lib/db/schema";
import { AppError } from "@/lib/errors";
import { requireOwnOpenEncounter } from "./encounters.service";

export type DiagnosisOption = { id: string; code: string; label: string; isFavourite: boolean };

/** The clinic's active codes: favourites when the box is empty, else matches. */
export async function searchDiagnosisCodes(tx: Tx, query: string, limit = 20): Promise<DiagnosisOption[]> {
  const q = query.trim();
  const select = tx
    .select({ id: diagnosisCodes.id, code: diagnosisCodes.code, label: diagnosisCodes.label, isFavourite: diagnosisCodes.isFavourite })
    .from(diagnosisCodes);
  if (!q) {
    return select
      .where(and(eq(diagnosisCodes.isActive, true), eq(diagnosisCodes.isFavourite, true)))
      .orderBy(asc(diagnosisCodes.code))
      .limit(limit);
  }
  const term = q.replace(/[%_\\]/g, "");
  return select
    .where(and(eq(diagnosisCodes.isActive, true), or(ilike(diagnosisCodes.code, `${term}%`), ilike(diagnosisCodes.label, `%${term}%`))))
    .orderBy(
      sql`case when ${diagnosisCodes.code} ilike ${`${term}%`} then 0 else 1 end`,
      desc(diagnosisCodes.isFavourite),
      asc(diagnosisCodes.code),
    )
    .limit(limit);
}

export async function listEncounterDiagnoses(tx: Tx, encounterId: string) {
  return tx
    .select()
    .from(diagnoses)
    .where(eq(diagnoses.encounterId, encounterId))
    .orderBy(desc(diagnoses.isPrimary), asc(diagnoses.createdAt));
}

export async function addDiagnosis(
  tx: Tx,
  clinicId: string,
  encounterId: string,
  input: { code: string; label: string; isPrimary: boolean },
  userId: string,
) {
  const encounter = await requireOwnOpenEncounter(tx, encounterId, userId);
  const existing = await listEncounterDiagnoses(tx, encounterId);
  const code = input.code.trim().toUpperCase();
  if (existing.some((d) => d.code.toUpperCase() === code)) throw new AppError(`${code} is already on this consultation.`);
  const isPrimary = input.isPrimary || existing.length === 0;
  if (isPrimary) {
    await tx.update(diagnoses).set({ isPrimary: false }).where(eq(diagnoses.encounterId, encounterId));
  }
  const [row] = await tx
    .insert(diagnoses)
    .values({ clinicId, encounterId, code, label: input.label.trim(), isPrimary, createdBy: userId })
    .returning({ id: diagnoses.id });
  return { id: row.id, patientId: encounter.patientId, code };
}

export async function removeDiagnosis(tx: Tx, id: string, userId: string) {
  const [row] = await tx.select().from(diagnoses).where(eq(diagnoses.id, id)).limit(1);
  if (!row) throw new AppError("Diagnosis not found.");
  const encounter = await requireOwnOpenEncounter(tx, row.encounterId, userId);
  await tx.delete(diagnoses).where(eq(diagnoses.id, id));
  // Keep one primary diagnosis if any remain.
  if (row.isPrimary) {
    const [next] = await tx
      .select({ id: diagnoses.id })
      .from(diagnoses)
      .where(eq(diagnoses.encounterId, row.encounterId))
      .orderBy(asc(diagnoses.createdAt))
      .limit(1);
    if (next) await tx.update(diagnoses).set({ isPrimary: true }).where(eq(diagnoses.id, next.id));
  }
  return { patientId: encounter.patientId, code: row.code };
}
