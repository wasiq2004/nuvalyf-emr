import "server-only";

// Suggestions in the consultation: what this doctor usually prescribes,
// diagnoses and orders, what they give for today's diagnosis, and the
// patient's last prescription. Worked out from signed records, never stored,
// so they follow the doctor's own practice. A new doctor sees the clinic's.
// A suggestion only fills the form: the allergy and interaction check runs as
// for any other medicine, and nothing is added without the doctor choosing it.
import { and, asc, desc, eq, sql, type SQL } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import { prescriptionItems, prescriptions, users } from "@/lib/db/schema";
import { AppError } from "@/lib/errors";
import { requireOwnOpenEncounter, staffName } from "./encounters.service";
import { needsOverride } from "./prescribing-rules";
import { addPrescriptionItem, getDraftPrescription, warningsFor, type DrugOption } from "./prescriptions.service";

export type MedicineSuggestion = DrugOption & { timesUsed: number };
export type DiagnosisSuggestion = { code: string; label: string; timesUsed: number };
export type LabTestSuggestion = { id: string; name: string; timesUsed: number };

const MIN_OWN = 3;

type Row = Record<string, unknown>;
const run = async <T extends Row>(tx: Tx, query: SQL) => (await tx.execute(query)) as unknown as T[];

/** Each medicine with the doctor's usual way of writing it. */
async function medicines(tx: Tx, scope: SQL, limit: number): Promise<MedicineSuggestion[]> {
  const rows = await run<{
    id: string;
    name: string;
    generic_name: string;
    form: string;
    strength: string | null;
    dose: string;
    frequency: string;
    duration_days: number | null;
    instructions: string | null;
    total: number;
  }>(
    tx,
    sql`
      with used as (
        select i.drug_id, i.dose, i.frequency, i.duration_days, i.instructions, count(*)::int as n
        from app.prescription_items i join app.prescriptions p on p.id = i.prescription_id
        where p.status = 'signed' and i.drug_id is not null and p.signed_at >= now() - interval '1 year' and ${scope}
        group by 1, 2, 3, 4, 5
      ), ranked as (
        select used.*, row_number() over (partition by drug_id order by n desc, dose) as rn, sum(n) over (partition by drug_id)::int as total from used
      )
      select d.id, d.name, d.generic_name, d.form, d.strength, r.dose, r.frequency, r.duration_days, r.instructions, r.total
      from ranked r join app.drugs d on d.id = r.drug_id
      where r.rn = 1 and d.is_active and d.item_type = 'medicine'
      order by r.total desc, d.name limit ${limit}`,
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    genericName: r.generic_name,
    form: r.form,
    strength: r.strength,
    defaultDose: r.dose,
    defaultFrequency: r.frequency,
    defaultDurationDays: r.duration_days,
    defaultInstructions: r.instructions,
    timesUsed: r.total,
  }));
}

function topUp<T>(own: T[], clinic: T[], same: (a: T, b: T) => boolean, limit: number) {
  if (own.length >= MIN_OWN) return own;
  return [...own, ...clinic.filter((c) => !own.some((o) => same(o, c)))].slice(0, limit);
}

export async function frequentMedicines(tx: Tx, doctorId: string, limit = 8) {
  const own = await medicines(tx, sql`p.prescriber_id = ${doctorId}`, limit);
  return own.length >= MIN_OWN ? own : topUp(own, await medicines(tx, sql`true`, limit), (a, b) => a.id === b.id, limit);
}

/** What this doctor has prescribed before alongside these diagnoses. */
export async function medicinesForDiagnoses(tx: Tx, doctorId: string, codes: string[], limit = 6) {
  if (codes.length === 0) return [];
  const list = sql.join(codes.map((c) => sql`${c}`), sql`, `);
  return medicines(tx, sql`p.prescriber_id = ${doctorId} and exists (select 1 from app.diagnoses dg where dg.encounter_id = p.encounter_id and dg.code in (${list}))`, limit);
}

export async function frequentDiagnoses(tx: Tx, doctorId: string, limit = 8): Promise<DiagnosisSuggestion[]> {
  const query = (scope: SQL) =>
    run<{ code: string; label: string; n: number }>(
      tx,
      sql`
        select dg.code, max(dg.label) as label, count(*)::int as n
        from app.diagnoses dg join app.encounters e on e.id = dg.encounter_id
        where e.status = 'finalized' and e.opened_at >= now() - interval '1 year' and ${scope}
        group by dg.code order by n desc, dg.code limit ${limit}`,
    );
  const toRow = (r: { code: string; label: string; n: number }) => ({ code: r.code, label: r.label, timesUsed: r.n });
  const own = (await query(sql`e.doctor_id = ${doctorId}`)).map(toRow);
  return own.length >= MIN_OWN ? own : topUp(own, (await query(sql`true`)).map(toRow), (a, b) => a.code === b.code, limit);
}

export async function frequentLabTests(tx: Tx, doctorId: string, limit = 6): Promise<LabTestSuggestion[]> {
  const query = (scope: SQL) =>
    run<{ id: string; name: string; n: number }>(
      tx,
      sql`
        select t.id, t.name, count(*)::int as n
        from app.lab_orders o join app.lab_tests t on t.id = o.test_id
        where o.status <> 'cancelled' and t.is_active and o.ordered_at >= now() - interval '1 year' and ${scope}
        group by t.id, t.name order by n desc, t.name limit ${limit}`,
    );
  const toRow = (r: { id: string; name: string; n: number }) => ({ id: r.id, name: r.name, timesUsed: r.n });
  const own = (await query(sql`o.ordered_by = ${doctorId}`)).map(toRow);
  return own.length >= MIN_OWN ? own : topUp(own, (await query(sql`true`)).map(toRow), (a, b) => a.id === b.id, limit);
}

/** The patient's most recent signed prescription from an earlier consultation. */
export async function lastPrescription(tx: Tx, patientId: string, encounterId: string) {
  const [rx] = await tx
    .select({ id: prescriptions.id, signedAt: prescriptions.signedAt, title: users.title, firstName: users.firstName, lastName: users.lastName })
    .from(prescriptions)
    .innerJoin(users, eq(users.id, prescriptions.prescriberId))
    .where(and(eq(prescriptions.patientId, patientId), eq(prescriptions.status, "signed"), sql`${prescriptions.encounterId} <> ${encounterId}`))
    .orderBy(desc(prescriptions.signedAt))
    .limit(1);
  if (!rx) return null;
  const items = await tx.select().from(prescriptionItems).where(eq(prescriptionItems.prescriptionId, rx.id)).orderBy(asc(prescriptionItems.sortOrder));
  return { id: rx.id, signedAt: rx.signedAt!, doctorName: staffName(rx), items };
}

/**
 * Copies a past prescription into today's draft. Anything with a serious
 * warning, or no longer in the clinic's list, is left for the doctor to add
 * deliberately, and reported back.
 */
export async function repeatPrescription(tx: Tx, clinicId: string, encounterId: string, sourceId: string, userId: string) {
  const encounter = await requireOwnOpenEncounter(tx, encounterId, userId);
  const [source] = await tx.select().from(prescriptions).where(eq(prescriptions.id, sourceId)).limit(1);
  if (!source || source.status !== "signed" || source.patientId !== encounter.patientId) throw new AppError("That prescription cannot be repeated here.");
  const items = await tx.select().from(prescriptionItems).where(eq(prescriptionItems.prescriptionId, sourceId)).orderBy(asc(prescriptionItems.sortOrder));
  const present = new Set((await getDraftPrescription(tx, encounterId))?.items.map((i) => i.drugId));
  const added: string[] = [];
  const skipped: string[] = [];
  for (const item of items) {
    if (item.drugId && present.has(item.drugId)) continue;
    const check = item.drugId ? await warningsFor(tx, encounterId, item.drugId).catch(() => null) : null;
    if (!item.drugId || !check || needsOverride(check.warnings)) {
      skipped.push(item.drugName);
      continue;
    }
    await addPrescriptionItem(
      tx,
      clinicId,
      encounterId,
      { drugId: item.drugId, dose: item.dose, frequency: item.frequency, durationDays: item.durationDays, instructions: item.instructions ?? undefined, quantity: item.quantity },
      userId,
    );
    added.push(item.drugName);
  }
  return { patientId: encounter.patientId, added, skipped };
}
