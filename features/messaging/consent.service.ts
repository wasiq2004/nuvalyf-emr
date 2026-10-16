import "server-only";

// Patient consent: an append-only history per patient and type. The current
// state is the latest event; no event means no consent.
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import { consentEvents, patients, users } from "@/lib/db/schema";
import { AppError } from "@/lib/errors";
import { staffName } from "@/features/clinical/encounters.service";
import type { ConsentType } from "./messaging-rules";

export type ConsentSource = "front_desk" | "import" | "patient_reply" | "portal";

/** Current consent per patient for one type. Patients without events are absent (no consent). */
export async function currentConsent(tx: Tx, type: ConsentType, patientIds?: string[]) {
  const rows = await tx
    .selectDistinctOn([consentEvents.patientId], { patientId: consentEvents.patientId, granted: consentEvents.granted })
    .from(consentEvents)
    .where(and(eq(consentEvents.type, type), patientIds ? inArray(consentEvents.patientId, patientIds) : undefined))
    .orderBy(consentEvents.patientId, desc(consentEvents.seq));
  return new Map(rows.map((r) => [r.patientId, r.granted]));
}

/** SQL condition: the patient's latest event of this type is a grant. */
export function hasConsentSql(type: ConsentType) {
  return sql`(
    select ce.granted from ${consentEvents} ce
    where ce.patient_id = ${patients.id} and ce.type = ${type}
    order by ce.seq desc limit 1
  ) is true`;
}

export async function setConsent(
  tx: Tx,
  clinicId: string,
  input: { patientId: string; type: ConsentType; granted: boolean; source: ConsentSource; note?: string },
  actorId: string | null,
) {
  const [patient] = await tx.select({ id: patients.id }).from(patients).where(eq(patients.id, input.patientId)).limit(1);
  if (!patient) throw new AppError("Patient not found.");
  const current = (await currentConsent(tx, input.type, [input.patientId])).get(input.patientId) ?? false;
  if (current === input.granted) return { changed: false };
  await tx.insert(consentEvents).values({
    clinicId,
    patientId: input.patientId,
    type: input.type,
    granted: input.granted,
    source: input.source,
    note: input.note ?? null,
    recordedBy: actorId,
  });
  return { changed: true };
}

export async function consentHistory(tx: Tx, patientId: string) {
  const rows = await tx
    .select({ event: consentEvents, title: users.title, firstName: users.firstName, lastName: users.lastName })
    .from(consentEvents)
    .leftJoin(users, eq(users.id, consentEvents.recordedBy))
    .where(eq(consentEvents.patientId, patientId))
    .orderBy(desc(consentEvents.seq));
  return rows.map((r) => ({ ...r.event, recordedByName: r.firstName ? staffName({ title: r.title, firstName: r.firstName, lastName: r.lastName ?? "" }) : null }));
}
