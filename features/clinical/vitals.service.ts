import "server-only";

import { and, desc, eq } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import { patients, users, vitalRanges, vitals } from "@/lib/db/schema";
import { AppError } from "@/lib/errors";
import { ageOn } from "@/features/patients/patient-rules";
import { requireOpenEncounter, staffName } from "./encounters.service";
import { computeVitalFlags, type VitalFlag, type VitalKey, type VitalRange, type VitalValues } from "./vital-rules";

const toNum = (v: string | null) => (v === null ? null : Number(v));

export async function activeVitalRanges(tx: Tx): Promise<VitalRange[]> {
  const rows = await tx.select().from(vitalRanges).where(eq(vitalRanges.isActive, true));
  return rows.map((r) => ({
    vital: r.vital,
    ageMinYears: r.ageMinYears,
    ageMaxYears: r.ageMaxYears,
    low: toNum(r.low),
    high: toNum(r.high),
    criticalLow: toNum(r.criticalLow),
    criticalHigh: toNum(r.criticalHigh),
  }));
}

/** Records a set of vitals; flags are decided here, never by the browser. */
export async function recordVitals(
  tx: Tx,
  clinicId: string,
  encounterId: string,
  values: VitalValues,
  notes: string | undefined,
  userId: string,
  today: string,
) {
  const encounter = await requireOpenEncounter(tx, encounterId);
  if (Object.values(values).every((v) => v === null || v === undefined)) {
    throw new AppError("Enter at least one reading.");
  }
  const [patient] = await tx.select().from(patients).where(eq(patients.id, encounter.patientId)).limit(1);
  const flags = computeVitalFlags(values, await activeVitalRanges(tx), patient ? ageOn(patient, today) : null);

  const str = (v: number | null | undefined) => (v === null || v === undefined ? null : String(v));
  const [row] = await tx
    .insert(vitals)
    .values({
      clinicId,
      encounterId,
      patientId: encounter.patientId,
      temperatureC: str(values.temperature_c),
      systolic: values.systolic ?? null,
      diastolic: values.diastolic ?? null,
      pulse: values.pulse ?? null,
      respRate: values.resp_rate ?? null,
      spo2: values.spo2 ?? null,
      weightKg: str(values.weight_kg),
      heightCm: str(values.height_cm),
      flags,
      notes: notes ?? null,
      recordedBy: userId,
    })
    .returning({ id: vitals.id });
  return { id: row.id, patientId: encounter.patientId, flags };
}

export type VitalsEntry = {
  id: string;
  recordedAt: Date;
  recordedByName: string;
  values: Partial<Record<VitalKey, number>>;
  flags: Partial<Record<VitalKey, VitalFlag>>;
  notes: string | null;
};

function toEntry(row: typeof vitals.$inferSelect, recorder: { title: string | null; firstName: string; lastName: string }): VitalsEntry {
  const values: Partial<Record<VitalKey, number>> = {};
  const set = (key: VitalKey, v: string | number | null) => {
    if (v !== null) values[key] = Number(v);
  };
  set("temperature_c", row.temperatureC);
  set("systolic", row.systolic);
  set("diastolic", row.diastolic);
  set("pulse", row.pulse);
  set("resp_rate", row.respRate);
  set("spo2", row.spo2);
  set("weight_kg", row.weightKg);
  set("height_cm", row.heightCm);
  return {
    id: row.id,
    recordedAt: row.recordedAt,
    recordedByName: staffName(recorder),
    values,
    flags: (row.flags ?? {}) as VitalsEntry["flags"],
    notes: row.notes,
  };
}

export async function listEncounterVitals(tx: Tx, encounterId: string): Promise<VitalsEntry[]> {
  const rows = await tx
    .select({ v: vitals, title: users.title, firstName: users.firstName, lastName: users.lastName })
    .from(vitals)
    .innerJoin(users, eq(users.id, vitals.recordedBy))
    .where(eq(vitals.encounterId, encounterId))
    .orderBy(desc(vitals.recordedAt));
  return rows.map((r) => toEntry(r.v, r));
}

export async function listPatientVitals(tx: Tx, patientId: string, limit = 10): Promise<VitalsEntry[]> {
  const rows = await tx
    .select({ v: vitals, title: users.title, firstName: users.firstName, lastName: users.lastName })
    .from(vitals)
    .innerJoin(users, eq(users.id, vitals.recordedBy))
    .where(and(eq(vitals.patientId, patientId)))
    .orderBy(desc(vitals.recordedAt))
    .limit(limit);
  return rows.map((r) => toEntry(r.v, r));
}
