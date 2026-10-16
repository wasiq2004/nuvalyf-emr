import "server-only";

// De-identified analytics. Queries here may read patients to count and band
// them, but what leaves this module is only: counts (small ones suppressed),
// age bands, sex, codes, generic names, and cohort-specific pseudonyms.
import { randomBytes } from "crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import { analyticsExports, clinicSettings, cohortRuns, cohorts, users } from "@/lib/db/schema";
import { AppError } from "@/lib/errors";
import { ageOn } from "@/features/patients/patient-rules";
import { staffName } from "@/features/clinical/encounters.service";
import { csvCell } from "@/features/audit/audit-rules";
import {
  AGE_BANDS,
  DEFAULT_MIN_CELL,
  EXPORT_COLUMNS,
  ageBand,
  cohortDefinitionSchema,
  definitionChanged,
  pseudonym,
  suppress,
  suppressValue,
  type CohortDefinition,
} from "./analytics-rules";

type Row = Record<string, unknown>;
const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();
const rows = async <T extends Row>(tx: Tx, query: ReturnType<typeof sql>) => (await tx.execute(query)) as unknown as T[];

export async function minCell(tx: Tx, clinicId: string) {
  const [row] = await tx.select({ n: clinicSettings.analyticsMinCell }).from(clinicSettings).where(eq(clinicSettings.clinicId, clinicId)).limit(1);
  return row?.n ?? DEFAULT_MIN_CELL;
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

export async function overview(tx: Tx, today: string, threshold: number) {
  const people = await rows<{ sex: string; dob: string | null; stated: number | null; stated_on: string | null }>(
    tx,
    sql`select sex, date_of_birth::text as dob, stated_age_years as stated, stated_age_on::text as stated_on from app.patients where is_placeholder = false`,
  );
  const grid = new Map<string, number>();
  for (const p of people) {
    const band = ageBand(ageOn({ dateOfBirth: p.dob, statedAgeYears: p.stated, statedAgeOn: p.stated_on }, today));
    const key = `${band}|${p.sex}`;
    grid.set(key, (grid.get(key) ?? 0) + 1);
  }
  const ageSex = suppress(
    [...AGE_BANDS, "unknown" as const].flatMap((band) =>
      ["female", "male", "other", "unknown"].map((sex) => ({ band, sex, count: grid.get(`${band}|${sex}`) ?? 0 })),
    ),
    threshold,
  );

  const yearAgo = new Date(Date.parse(`${today}T00:00:00Z`) - 365 * 86_400_000).toISOString().slice(0, 10);
  const perMonth = await rows<{ month: string; visits: number; patients: number }>(
    tx,
    sql`select to_char(date_trunc('month', visit_date), 'YYYY-MM') as month, count(*)::int as visits, count(distinct patient_id)::int as patients
        from app.visits where status = 'completed' and visit_date >= ${yearAgo}
        group by 1 order by 1`,
  );
  const topDiagnoses = await rows<{ code: string; label: string; count: number }>(
    tx,
    sql`select upper(d.code) as code, min(d.label) as label, count(distinct e.patient_id)::int as count
        from app.diagnoses d join app.encounters e on e.id = d.encounter_id
        where e.status = 'finalized' and e.opened_at >= ${yearAgo}::date
        group by 1 order by count desc limit 15`,
  );
  const topMedicines = await rows<{ generic: string; count: number }>(
    tx,
    sql`select lower(i.generic_name) as generic, count(distinct p.patient_id)::int as count
        from app.prescription_items i join app.prescriptions p on p.id = i.prescription_id
        where p.status = 'signed' and p.signed_at >= ${yearAgo}::date
        group by 1 order by count desc limit 15`,
  );

  return {
    threshold,
    patients: suppressValue(people.length, threshold),
    ageSex: ageSex.rows,
    ageSexSuppressed: ageSex.suppressed,
    perMonth: perMonth.map((m) => ({ month: m.month, visits: suppressValue(m.visits, threshold), patients: suppressValue(m.patients, threshold) })),
    topDiagnoses: suppress(topDiagnoses, threshold),
    topMedicines: suppress(topMedicines, threshold),
  };
}

// ---------------------------------------------------------------------------
// Data quality (counts of records, nothing about individuals)
// ---------------------------------------------------------------------------

export async function dataQuality(tx: Tx) {
  const [p] = await rows<{ total: number; no_dob: number; unknown_sex: number; no_mobile: number; placeholders: number }>(
    tx,
    sql`select count(*)::int as total,
               count(*) filter (where date_of_birth is null)::int as no_dob,
               count(*) filter (where sex = 'unknown')::int as unknown_sex,
               count(*) filter (where coalesce(mobile, '') = '')::int as no_mobile,
               count(*) filter (where is_placeholder)::int as placeholders
        from app.patients`,
  );
  const [e] = await rows<{ finalized: number; no_diagnosis: number; no_vitals: number }>(
    tx,
    sql`select count(*)::int as finalized,
               count(*) filter (where not exists (select 1 from app.diagnoses d where d.encounter_id = e.id))::int as no_diagnosis,
               count(*) filter (where not exists (select 1 from app.vitals v where v.encounter_id = e.id))::int as no_vitals
        from app.encounters e where e.status = 'finalized'`,
  );
  const [d] = await rows<{ total: number; uncoded: number }>(
    tx,
    sql`select count(*)::int as total,
               count(*) filter (where not exists (select 1 from app.diagnosis_codes c where upper(c.code) = upper(d.code)))::int as uncoded
        from app.diagnoses d`,
  );
  const [rx] = await rows<{ total: number; no_quantity: number; not_in_list: number }>(
    tx,
    sql`select count(*)::int as total,
               count(*) filter (where i.quantity is null)::int as no_quantity,
               count(*) filter (where i.drug_id is null)::int as not_in_list
        from app.prescription_items i join app.prescriptions p on p.id = i.prescription_id where p.status = 'signed'`,
  );
  const [lab] = await rows<{ stale: number }>(
    tx,
    sql`select count(*)::int as stale from app.lab_orders where status = 'ordered' and ordered_at < now() - interval '7 days'`,
  );
  return {
    patients: { total: p.total, noDob: p.no_dob, unknownSex: p.unknown_sex, noMobile: p.no_mobile, placeholders: p.placeholders },
    consultations: { finalized: e.finalized, noDiagnosis: e.no_diagnosis, noVitals: e.no_vitals },
    diagnoses: { total: d.total, uncoded: d.uncoded },
    prescriptions: { total: rx.total, noQuantity: rx.no_quantity, notInList: rx.not_in_list },
    lab: { staleOrders: lab.stale },
  };
}

// ---------------------------------------------------------------------------
// Cohorts
// ---------------------------------------------------------------------------

export async function listCohorts(tx: Tx) {
  const list = await tx
    .select({
      cohort: cohorts,
      title: users.title,
      firstName: users.firstName,
      lastName: users.lastName,
      lastRunAt: sql<Date | null>`(select max(r.ran_at) from ${cohortRuns} r where r.cohort_id = ${cohorts.id})`,
    })
    .from(cohorts)
    .innerJoin(users, eq(users.id, cohorts.createdBy))
    .orderBy(desc(cohorts.updatedAt));
  // The salt never leaves the server.
  return list.map(({ cohort: { salt: _salt, ...c }, ...r }) => ({ ...c, createdByName: staffName(r), lastRunAt: r.lastRunAt }));
}

export async function getCohort(tx: Tx, id: string) {
  const [row] = await tx.select().from(cohorts).where(eq(cohorts.id, id)).limit(1);
  if (!row) return null;
  const { salt: _salt, ...cohort } = row;
  const runs = await tx.select().from(cohortRuns).where(eq(cohortRuns.cohortId, id)).orderBy(desc(cohortRuns.ranAt)).limit(10);
  return { ...cohort, definition: cohortDefinitionSchema.parse(row.definition), runs };
}

export async function createCohort(tx: Tx, clinicId: string, input: { name: string; purpose: string; definition: CohortDefinition }, actorId: string) {
  const [row] = await tx
    .insert(cohorts)
    .values({ clinicId, name: input.name, purpose: input.purpose, definition: input.definition, salt: randomBytes(32).toString("hex"), createdBy: actorId })
    .returning({ id: cohorts.id });
  return row;
}

export async function updateCohort(tx: Tx, id: string, input: { name: string; purpose: string; definition: CohortDefinition }) {
  const [current] = await tx.select().from(cohorts).where(eq(cohorts.id, id)).for("update").limit(1);
  if (!current) throw new AppError("Cohort not found.");
  if (current.status === "archived") throw new AppError("This cohort is archived.");
  const changed = definitionChanged(cohortDefinitionSchema.parse(current.definition), input.definition);
  await tx
    .update(cohorts)
    .set({ name: input.name, purpose: input.purpose, definition: input.definition, version: changed ? current.version + 1 : current.version, updatedAt: new Date() })
    .where(eq(cohorts.id, id));
  return { version: changed ? current.version + 1 : current.version };
}

export async function archiveCohort(tx: Tx, id: string) {
  const [row] = await tx.update(cohorts).set({ status: "archived", updatedAt: new Date() }).where(and(eq(cohorts.id, id), eq(cohorts.status, "active"))).returning({ id: cohorts.id });
  if (!row) throw new AppError("Cohort not found or already archived.");
}

export type CohortMember = {
  pseudonym: string;
  ageBand: string;
  sex: string;
  visits: number;
  diagnosisCodes: string[];
  medicineGenerics: string[];
};

/** Patients matching the definition, already de-identified. */
async function members(tx: Tx, salt: string, d: CohortDefinition): Promise<CohortMember[]> {
  const diagnosisFilter = d.diagnosisPrefixes.length
    ? sql`and exists (
        select 1 from app.diagnoses dx join app.encounters en on en.id = dx.encounter_id
        where en.patient_id = p.id and en.opened_at >= ${d.from}::date and en.opened_at < (${d.to}::date + 1)
          and upper(dx.code) like any (${sql.param(d.diagnosisPrefixes.map((x) => `${x}%`))}::text[]))`
    : sql``;
  const drugFilter = d.drugGenerics.length
    ? sql`and exists (
        select 1 from app.prescription_items it join app.prescriptions rx on rx.id = it.prescription_id
        where rx.patient_id = p.id and rx.status = 'signed' and rx.signed_at >= ${d.from}::date and rx.signed_at < (${d.to}::date + 1)
          and lower(it.generic_name) like any (${sql.param(d.drugGenerics.map((x) => `%${x}%`))}::text[]))`
    : sql``;
  const sexFilter = d.sex ? sql`and p.sex = ${d.sex}` : sql``;

  const found = await rows<{
    id: string;
    sex: string;
    dob: string | null;
    stated: number | null;
    stated_on: string | null;
    visits: number;
    codes: string[] | null;
    generics: string[] | null;
  }>(
    tx,
    sql`select p.id, p.sex, p.date_of_birth::text as dob, p.stated_age_years as stated, p.stated_age_on::text as stated_on,
          (select count(*)::int from app.visits v where v.patient_id = p.id and v.status = 'completed' and v.visit_date between ${d.from}::date and ${d.to}::date) as visits,
          (select array_agg(distinct upper(dx.code)) from app.diagnoses dx join app.encounters en on en.id = dx.encounter_id
             where en.patient_id = p.id and en.opened_at >= ${d.from}::date and en.opened_at < (${d.to}::date + 1)) as codes,
          (select array_agg(distinct lower(it.generic_name)) from app.prescription_items it join app.prescriptions rx on rx.id = it.prescription_id
             where rx.patient_id = p.id and rx.status = 'signed' and rx.signed_at >= ${d.from}::date and rx.signed_at < (${d.to}::date + 1)) as generics
        from app.patients p
        where p.is_placeholder = false
          and exists (select 1 from app.visits v where v.patient_id = p.id and v.status = 'completed' and v.visit_date between ${d.from}::date and ${d.to}::date)
          ${diagnosisFilter} ${drugFilter} ${sexFilter}`,
  );

  return found
    .map((p) => ({ p, age: ageOn({ dateOfBirth: p.dob, statedAgeYears: p.stated, statedAgeOn: p.stated_on }, d.to) }))
    .filter(({ age }) => (d.ageMin === undefined || (age !== null && age >= d.ageMin)) && (d.ageMax === undefined || (age !== null && age <= d.ageMax)))
    .map(({ p, age }) => ({
      pseudonym: pseudonym(salt, p.id),
      ageBand: ageBand(age),
      sex: p.sex,
      visits: p.visits,
      diagnosisCodes: (p.codes ?? []).sort(),
      medicineGenerics: (p.generics ?? []).sort(),
    }))
    .sort((a, b) => a.pseudonym.localeCompare(b.pseudonym));
}

/** Members whose (age band, sex) group reaches the threshold: no rare combination is shown. */
function kAnonymous(list: CohortMember[], threshold: number) {
  const groups = new Map<string, number>();
  for (const m of list) groups.set(`${m.ageBand}|${m.sex}`, (groups.get(`${m.ageBand}|${m.sex}`) ?? 0) + 1);
  return list.filter((m) => suppressValue(groups.get(`${m.ageBand}|${m.sex}`) ?? 0, threshold) !== null);
}

function countBy(values: string[]) {
  const map = new Map<string, number>();
  for (const v of values) map.set(v, (map.get(v) ?? 0) + 1);
  return [...map.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count);
}

/** Runs a cohort: records the run, returns suppressed aggregates (and rows when large enough). */
export async function runCohort(tx: Tx, clinicId: string, id: string, actorId: string, threshold: number) {
  const [cohort] = await tx.select().from(cohorts).where(eq(cohorts.id, id)).limit(1);
  if (!cohort) throw new AppError("Cohort not found.");
  if (cohort.status === "archived") throw new AppError("This cohort is archived.");
  const definition = cohortDefinitionSchema.parse(cohort.definition);
  const list = await members(tx, cohort.salt, definition);
  const [run] = await tx
    .insert(cohortRuns)
    .values({ clinicId, cohortId: id, version: cohort.version, definition, size: list.length, ranBy: actorId })
    .returning({ id: cohortRuns.id, ranAt: cohortRuns.ranAt });

  const bigEnough = suppressValue(list.length, threshold) !== null;
  const shareable = kAnonymous(list, threshold);
  return {
    runId: run.id,
    ranAt: run.ranAt,
    version: cohort.version,
    size: suppressValue(list.length, threshold),
    threshold,
    ageSex: suppress(
      countBy(list.map((m) => `${m.ageBand}|${m.sex}`)).map(({ key, count }) => ({ band: key.split("|")[0], sex: key.split("|")[1], count })),
      threshold,
    ),
    diagnoses: suppress(countBy(list.flatMap((m) => m.diagnosisCodes)).map(({ key, count }) => ({ code: key, count })).slice(0, 15), threshold),
    medicines: suppress(countBy(list.flatMap((m) => m.medicineGenerics)).map(({ key, count }) => ({ generic: key, count })).slice(0, 15), threshold),
    // Row-level view only when the cohort is above the threshold, and only
    // rows whose age band + sex group is itself that large.
    rows: bigEnough ? shareable.slice(0, 100) : [],
    rowsWithheld: bigEnough ? list.length - shareable.length : 0,
  };
}

export type CohortRunResult = Awaited<ReturnType<typeof runCohort>>;

/** CSV with the definition, version and columns in a header block. Refused for small cohorts. */
export async function exportCohort(tx: Tx, clinicId: string, id: string, actorId: string, threshold: number, generatedAt: Date) {
  const [cohort] = await tx.select().from(cohorts).where(eq(cohorts.id, id)).limit(1);
  if (!cohort) throw new AppError("Cohort not found.");
  const definition = cohortDefinitionSchema.parse(cohort.definition);
  const all = await members(tx, cohort.salt, definition);
  const list = kAnonymous(all, threshold);
  if (suppressValue(all.length, threshold) === null || list.length === 0) {
    throw new AppError(`Cohorts smaller than ${threshold} patients cannot be exported.`);
  }
  const [run] = await tx
    .insert(cohortRuns)
    .values({ clinicId, cohortId: id, version: cohort.version, definition, size: list.length, ranBy: actorId })
    .returning({ id: cohortRuns.id });
  await tx.insert(analyticsExports).values({
    clinicId,
    cohortId: id,
    runId: run.id,
    version: cohort.version,
    definition,
    columns: [...EXPORT_COLUMNS],
    rowCount: list.length,
    exportedBy: actorId,
  });

  const header = [
    `# rows withheld (age band and sex group smaller than ${threshold}): ${all.length - list.length}`,
    `# cohort: ${oneLine(cohort.name)}`,
    `# version: ${cohort.version}`,
    `# purpose: ${oneLine(cohort.purpose)}`,
    `# definition: ${JSON.stringify(definition)}`,
    `# columns: ${EXPORT_COLUMNS.join(", ")}`,
    `# generated: ${generatedAt.toISOString()}`,
    `# pseudonyms are specific to this cohort and cannot be linked to other cohorts`,
  ];
  const lines = list.map((m) => [m.pseudonym, m.ageBand, m.sex, String(m.visits), m.diagnosisCodes.join("; "), m.medicineGenerics.join("; ")].map(csvCell).join(","));
  // Each header line is one escaped cell: a name like "x,=HYPERLINK(...)" stays text.
  return { name: cohort.name, version: cohort.version, csv: [...header.map(csvCell), EXPORT_COLUMNS.join(","), ...lines].join("\r\n") + "\r\n", rows: list.length };
}
