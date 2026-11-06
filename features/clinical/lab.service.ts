import "server-only";

// Lab module: the doctor orders during the consultation, the Lab Technician
// enters results, and results go back to the ordering doctor, staying on
// their screen until they mark them read.
import { and, asc, desc, eq, gte, inArray, isNull } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import { encounters, labOrders, labParameterRanges, labResults, labTestParameters, labTests, patients, users } from "@/lib/db/schema";
import { AppError } from "@/lib/errors";
import { ageOn, displayPatientName } from "@/features/patients/patient-rules";
import { toZonedDateTime } from "@/lib/time";
import { addSourceCharge, admissionForEncounter, voidSourceCharge } from "@/features/inpatient/inpatient.service";
import { ensureStarterParameters } from "@/lib/catalog/seed";
import { RESULT_IN_DOCUMENT, activeDocumentCount, documentsForOrders, listOrderDocuments } from "./lab-documents.service";
import { addedLineFlag, cumulativeRows, numericFlag, overallFlag, parseLabNumber, parseReference, pickRange, rangeText, resultSummary, textFlag, type ChosenLabFlag, type LabFlag, type LabRange } from "./lab-rules";
import { requireOwnOpenEncounter, staffName } from "./encounters.service";

export const RESULT_FLAGS = ["normal", "abnormal", "critical"] as const;

export async function listLabTestOptions(tx: Tx) {
  return tx
    .select({ id: labTests.id, name: labTests.name, sampleType: labTests.sampleType })
    .from(labTests)
    .where(eq(labTests.isActive, true))
    .orderBy(asc(labTests.name));
}

export async function orderLab(tx: Tx, clinicId: string, encounterId: string, testId: string, notes: string | undefined, userId: string) {
  const encounter = await requireOwnOpenEncounter(tx, encounterId, userId);
  const [test] = await tx.select().from(labTests).where(and(eq(labTests.id, testId), eq(labTests.isActive, true))).limit(1);
  if (!test) throw new AppError("Choose a test from the clinic's list.");
  const already = await tx
    .select({ id: labOrders.id })
    .from(labOrders)
    .where(and(eq(labOrders.encounterId, encounterId), eq(labOrders.testId, testId), eq(labOrders.status, "ordered")))
    .limit(1);
  if (already.length) throw new AppError(`${test.name} is already ordered for this consultation.`);
  const [row] = await tx
    .insert(labOrders)
    .values({
      clinicId,
      encounterId,
      patientId: encounter.patientId,
      testId,
      testName: test.name,
      unit: test.unit,
      referenceRange: test.referenceRange,
      notes: notes ?? null,
      orderedBy: userId,
    })
    .returning({ id: labOrders.id });
  const stay = await admissionForEncounter(tx, encounterId);
  if (stay && test.price) await addSourceCharge(tx, clinicId, stay.id, { kind: "lab", description: test.name, amount: test.price, sourceType: "lab_order", sourceId: row.id }, userId);
  return { id: row.id, patientId: encounter.patientId, testName: test.name };
}

/** Only the doctor who ordered a test can cancel it. */
export async function cancelLabOrder(tx: Tx, id: string, userId: string) {
  const [row] = await tx
    .update(labOrders)
    .set({ status: "cancelled" })
    .where(and(eq(labOrders.id, id), eq(labOrders.status, "ordered"), eq(labOrders.orderedBy, userId)))
    .returning({ id: labOrders.id, patientId: labOrders.patientId, testName: labOrders.testName });
  if (!row) throw new AppError("Only the ordering doctor can cancel a test, and only before it is resulted.");
  await voidSourceCharge(tx, "lab_order", row.id, "Test cancelled", userId);
  return row;
}

export async function listEncounterLabOrders(tx: Tx, encounterId: string) {
  return tx.select().from(labOrders).where(eq(labOrders.encounterId, encounterId)).orderBy(asc(labOrders.orderedAt));
}

export async function listPatientLabOrders(tx: Tx, patientId: string, limit = 20) {
  return tx.select().from(labOrders).where(eq(labOrders.patientId, patientId)).orderBy(desc(labOrders.orderedAt)).limit(limit);
}

export type LabWorkItem = {
  id: string;
  encounterId: string;
  patientId: string;
  testId: string | null;
  testName: string;
  unit: string | null;
  referenceRange: string | null;
  notes: string | null;
  status: string;
  orderedAt: Date;
  orderedByName: string;
  patientName: string;
  patientMrn: string;
  patientAge: number | null;
  patientSex: string;
  resultValue: string | null;
  resultFlag: string | null;
  resultNotes: string | null;
  resultedAt: Date | null;
};

async function labRows(tx: Tx, where: ReturnType<typeof and>, today: string, order: "asc" | "desc", limit: number): Promise<LabWorkItem[]> {
  const rows = await tx
    .select({ order: labOrders, patient: patients, title: users.title, firstName: users.firstName, lastName: users.lastName })
    .from(labOrders)
    .innerJoin(patients, eq(patients.id, labOrders.patientId))
    .innerJoin(users, eq(users.id, labOrders.orderedBy))
    .where(where)
    .orderBy(order === "asc" ? asc(labOrders.orderedAt) : desc(labOrders.resultedAt))
    .limit(limit);
  return rows.map((r) => ({
    id: r.order.id,
    encounterId: r.order.encounterId,
    patientId: r.order.patientId,
    testId: r.order.testId,
    testName: r.order.testName,
    unit: r.order.unit,
    referenceRange: r.order.referenceRange,
    notes: r.order.notes,
    status: r.order.status,
    orderedAt: r.order.orderedAt,
    orderedByName: staffName(r),
    patientName: displayPatientName(r.patient),
    patientMrn: r.patient.mrn,
    patientAge: ageOn(r.patient, today),
    patientSex: r.patient.sex,
    resultValue: r.order.resultValue,
    resultFlag: r.order.resultFlag,
    resultNotes: r.order.resultNotes,
    resultedAt: r.order.resultedAt,
  }));
}

/** Tests waiting for a result, oldest first. */
export function listLabWorklist(tx: Tx, today: string) {
  return labRows(tx, and(eq(labOrders.status, "ordered")), today, "asc", 200);
}

export function listRecentResults(tx: Tx, today: string, since: Date) {
  return labRows(tx, and(eq(labOrders.status, "resulted"), gte(labOrders.resultedAt, since)), today, "desc", 50);
}

export type UnreadResult = LabWorkItem & { documents: number };

/** Results for tests this doctor ordered that they have not read yet. */
export async function listUnreadResults(tx: Tx, doctorId: string, today: string): Promise<UnreadResult[]> {
  const rows = await tx
    .select({ order: labOrders, patient: patients, title: users.title, firstName: users.firstName, lastName: users.lastName, encounterId: encounters.id })
    .from(labOrders)
    .innerJoin(patients, eq(patients.id, labOrders.patientId))
    .innerJoin(users, eq(users.id, labOrders.orderedBy))
    .innerJoin(encounters, eq(encounters.id, labOrders.encounterId))
    .where(and(eq(labOrders.orderedBy, doctorId), eq(labOrders.status, "resulted"), isNull(labOrders.readAt)))
    .orderBy(desc(labOrders.resultedAt));
  const documents = await documentsForOrders(tx, rows.map((r) => r.order.id));
  return rows.map((r) => ({
    id: r.order.id,
    documents: documents.get(r.order.id)?.length ?? 0,
    encounterId: r.encounterId,
    patientId: r.order.patientId,
    testId: r.order.testId,
    testName: r.order.testName,
    unit: r.order.unit,
    referenceRange: r.order.referenceRange,
    notes: r.order.notes,
    status: r.order.status,
    orderedAt: r.order.orderedAt,
    orderedByName: staffName(r),
    patientName: displayPatientName(r.patient),
    patientMrn: r.patient.mrn,
    patientAge: ageOn(r.patient, today),
    patientSex: r.patient.sex,
    resultValue: r.order.resultValue,
    resultFlag: r.order.resultFlag,
    resultNotes: r.order.resultNotes,
    resultedAt: r.order.resultedAt,
  }));
}

export async function markResultRead(tx: Tx, id: string, doctorId: string) {
  const [row] = await tx
    .update(labOrders)
    .set({ readAt: new Date() })
    .where(and(eq(labOrders.id, id), eq(labOrders.orderedBy, doctorId), eq(labOrders.status, "resulted"), isNull(labOrders.readAt)))
    .returning({ id: labOrders.id, patientId: labOrders.patientId });
  if (!row) throw new AppError("Only the ordering doctor can mark an unread result as read.");
  return row;
}

// ---------------------------------------------------------------------------
// Parameter-by-parameter results (docs/LAB_REPORTS.md)
// ---------------------------------------------------------------------------

const toNumber = (v: string | null) => (v === null ? null : Number(v));

async function parametersOf(tx: Tx, testIds: string[]) {
  if (testIds.length === 0) return [];
  const params = await tx
    .select()
    .from(labTestParameters)
    .where(and(inArray(labTestParameters.testId, testIds), eq(labTestParameters.isActive, true)))
    .orderBy(asc(labTestParameters.sortOrder), asc(labTestParameters.name));
  const ranges = params.length ? await tx.select().from(labParameterRanges).where(inArray(labParameterRanges.parameterId, params.map((p) => p.id))) : [];
  return params.map((p) => ({
    ...p,
    ranges: ranges
      .filter((r) => r.parameterId === p.id)
      .map(
        (r): LabRange => ({
          sex: r.sex as LabRange["sex"],
          ageMinYears: r.ageMinYears,
          ageMaxYears: r.ageMaxYears,
          low: toNumber(r.low),
          high: toNumber(r.high),
          criticalLow: toNumber(r.criticalLow),
          criticalHigh: toNumber(r.criticalHigh),
        }),
      ),
  }));
}

export type LabEntryField = { id: string; name: string; section: string | null; unit: string | null; valueType: string; normalText: string | null; range: LabRange | null; reference: string };

/** For each order, what the technician fills in, with this patient's ranges. */
export async function entryFieldsFor(tx: Tx, items: { id: string; testId: string | null; patientSex: string; patientAge: number | null }[]) {
  const params = await parametersOf(tx, [...new Set(items.map((i) => i.testId).filter((v): v is string => Boolean(v)))]);
  const map = new Map<string, LabEntryField[]>();
  for (const item of items) {
    map.set(
      item.id,
      params
        .filter((p) => p.testId === item.testId)
        .map((p) => {
          const range = p.valueType === "number" ? pickRange(p.ranges, item.patientSex, item.patientAge) : null;
          return { id: p.id, name: p.name, section: p.section, unit: p.unit, valueType: p.valueType, normalText: p.normalText, range, reference: rangeText(range, p.normalText) };
        }),
    );
  }
  return map;
}

/** A parameter the technician added for this patient only. */
export type AddedLine = { name: string; value: string; unit?: string; reference?: string; flag?: ChosenLabFlag };

export type LabResultInput = {
  /** The test's own parameters; blank ones are left off the report. */
  values: { parameterId: string; value: string }[];
  added?: AddedLine[];
  notes?: string;
  /** Needed only when the whole result is in an attached document. */
  documentFlag?: (typeof RESULT_FLAGS)[number];
};

const limitText = (v: number | null | undefined) => (v === null || v === undefined ? null : String(v));

/** Saves a result, once. Flags are decided here; a result is never edited afterwards. */
export async function saveLabResult(tx: Tx, clinicId: string, id: string, input: LabResultInput, userId: string, today: string) {
  const [order] = await tx.select().from(labOrders).where(eq(labOrders.id, id)).for("update").limit(1);
  if (!order || order.status !== "ordered") throw new AppError("This test has already been resulted or was cancelled.");
  const [patient] = await tx.select().from(patients).where(eq(patients.id, order.patientId)).limit(1);
  const fields = (await entryFieldsFor(tx, [{ id, testId: order.testId, patientSex: patient?.sex ?? "unknown", patientAge: patient ? ageOn(patient, today) : null }])).get(id) ?? [];
  const typed = new Map(input.values.map((v) => [v.parameterId, v.value.trim()]));
  const base = { clinicId, orderId: id, patientId: order.patientId };

  const rows: (typeof labResults.$inferInsert & { flag: LabFlag; unit: string | null })[] = fields.flatMap((field, index) => {
    const value = typed.get(field.id);
    if (!value) return [];
    const number = field.valueType === "number" ? parseLabNumber(value) : null;
    if (field.valueType === "number" && number === null) throw new AppError(`${field.name}: enter a number, without the unit. To report something else, add it as a new parameter.`);
    const flag = number !== null ? numericFlag(number, field.range) : textFlag(value, field.normalText);
    return [
      {
        ...base,
        parameterId: field.id,
        name: field.name,
        section: field.section,
        unit: field.unit,
        sortOrder: index,
        value,
        valueNumber: number === null ? null : String(number),
        flag,
        referenceText: field.reference || null,
        refLow: limitText(field.range?.low),
        refHigh: limitText(field.range?.high),
      },
    ];
  });

  const names = new Set(fields.map((f) => f.name.toLowerCase()));
  (input.added ?? []).forEach((line, index) => {
    const key = line.name.toLowerCase();
    if (names.has(key)) throw new AppError(`${line.name} is already on this test.`);
    names.add(key);
    const number = parseLabNumber(line.value);
    const limits = parseReference(line.reference);
    rows.push({
      ...base,
      parameterId: null,
      name: line.name,
      // On a test with its own list, marks what was added to it.
      section: fields.length ? "Additional" : null,
      unit: line.unit ?? null,
      sortOrder: fields.length + index,
      value: line.value,
      valueNumber: number === null ? null : String(number),
      flag: addedLineFlag(line.value, line.reference, line.flag),
      referenceText: line.reference ?? null,
      refLow: limitText(limits?.low),
      refHigh: limitText(limits?.high),
    });
  });

  const documents = await activeDocumentCount(tx, id);
  if (rows.length === 0 && documents === 0) throw new AppError("Enter at least one result, or attach the report.");
  if (rows.length === 0 && !input.documentFlag) throw new AppError("Choose the interpretation of the attached report.");

  if (rows.length) await tx.insert(labResults).values(rows);
  const overall = rows.length ? overallFlag(rows.map((r) => r.flag)) : input.documentFlag!;
  await tx
    .update(labOrders)
    .set({
      status: "resulted",
      resultValue: rows.length ? resultSummary(rows.map((r) => ({ name: r.name, value: r.value, unit: r.unit, flag: r.flag }))) : RESULT_IN_DOCUMENT,
      resultFlag: overall,
      resultNotes: input.notes ?? null,
      resultedBy: userId,
      resultedAt: new Date(),
      // The summary already carries each unit and range.
      unit: null,
      referenceRange: null,
    })
    .where(eq(labOrders.id, id));
  return { id, patientId: order.patientId, testName: order.testName, flag: overall, parameters: rows.length, documents };
}

/** One test for the entry page: who it is for, what to fill in, and what is attached. */
export async function labOrderDetail(tx: Tx, clinicId: string, id: string, today: string) {
  const [item] = await labRows(tx, and(eq(labOrders.id, id)), today, "asc", 1);
  if (!item) return null;
  if (item.status === "ordered" && item.testId) await ensureStarterParameters(tx, clinicId, item.testId);
  const [test] = item.testId ? await tx.select({ sampleType: labTests.sampleType }).from(labTests).where(eq(labTests.id, item.testId)).limit(1) : [];
  const [order] = await tx.select({ resultedBy: labOrders.resultedBy }).from(labOrders).where(eq(labOrders.id, id)).limit(1);
  const [by] = order.resultedBy ? await tx.select().from(users).where(eq(users.id, order.resultedBy)).limit(1) : [];
  return {
    item,
    sampleType: test?.sampleType ?? null,
    resultedByName: by ? staffName(by) : null,
    fields: item.status === "ordered" ? ((await entryFieldsFor(tx, [item])).get(id) ?? []) : [],
    lines: (await resultsForOrders(tx, [id])).get(id) ?? [],
    documents: await listOrderDocuments(tx, id),
  };
}

export type LabResultLine = typeof labResults.$inferSelect;

export async function resultsForOrders(tx: Tx, orderIds: string[]) {
  const map = new Map<string, LabResultLine[]>();
  if (orderIds.length === 0) return map;
  const rows = await tx.select().from(labResults).where(inArray(labResults.orderId, orderIds)).orderBy(asc(labResults.sortOrder));
  for (const r of rows) map.set(r.orderId, [...(map.get(r.orderId) ?? []), r]);
  return map;
}

/** Everything for the printable report on one consultation's tests. */
export async function labReport(tx: Tx, encounterId: string, today: string) {
  const [row] = await tx
    .select({ encounter: encounters, patient: patients, title: users.title, firstName: users.firstName, lastName: users.lastName })
    .from(encounters)
    .innerJoin(patients, eq(patients.id, encounters.patientId))
    .leftJoin(users, eq(users.id, encounters.doctorId))
    .where(eq(encounters.id, encounterId))
    .limit(1);
  if (!row) return null;
  const orders = await tx.select().from(labOrders).where(eq(labOrders.encounterId, encounterId)).orderBy(asc(labOrders.orderedAt));
  const done = orders.filter((o) => o.status === "resulted");
  if (done.length === 0) return null;
  const results = await resultsForOrders(tx, done.map((o) => o.id));
  const staffIds = [...new Set(done.map((o) => o.resultedBy).filter((v): v is string => Boolean(v)))];
  const staff = staffIds.length ? await tx.select().from(users).where(inArray(users.id, staffIds)) : [];
  const testIds = done.map((o) => o.testId).filter((v): v is string => Boolean(v));
  const tests = testIds.length ? await tx.select({ id: labTests.id, sampleType: labTests.sampleType }).from(labTests).where(inArray(labTests.id, testIds)) : [];
  const documents = await documentsForOrders(tx, done.map((o) => o.id));
  return {
    patientId: row.patient.id,
    patient: { name: displayPatientName(row.patient), mrn: row.patient.mrn, age: ageOn(row.patient, today), sex: row.patient.sex },
    doctorName: row.firstName ? staffName({ title: row.title, firstName: row.firstName, lastName: row.lastName ?? "" }) : null,
    pending: orders.filter((o) => o.status === "ordered").map((o) => o.testName),
    tests: done.map((o) => {
      const by = staff.find((s) => s.id === o.resultedBy);
      return {
        id: o.id,
        name: o.testName,
        sampleType: tests.find((t) => t.id === o.testId)?.sampleType ?? null,
        orderedAt: o.orderedAt,
        resultedAt: o.resultedAt!,
        resultedByName: by ? staffName(by) : null,
        notes: o.resultNotes,
        documents: [...(documents.get(o.id) ?? [])].reverse().map((d) => ({ id: d.id, name: d.fileName, contentType: d.contentType, sizeBytes: d.sizeBytes })),
        // A single free-text result from before parameters, or the result is in a document.
        single: results.has(o.id) ? null : { value: o.resultValue ?? "", unit: o.unit, reference: o.referenceRange, flag: o.resultFlag },
        lines: results.get(o.id) ?? [],
      };
    }),
  };
}

/** A patient's results over time, one table per test. */
export async function patientLabHistory(tx: Tx, patientId: string, timeZone: string) {
  const rows = await tx
    .select({ line: labResults, test: labOrders.testName, resultedAt: labOrders.resultedAt, encounterId: labOrders.encounterId })
    .from(labResults)
    .innerJoin(labOrders, eq(labOrders.id, labResults.orderId))
    .where(eq(labResults.patientId, patientId))
    .orderBy(asc(labOrders.resultedAt), asc(labResults.sortOrder))
    .limit(5000);
  const byTest = new Map<string, typeof rows>();
  for (const r of rows) byTest.set(r.test, [...(byTest.get(r.test) ?? []), r]);
  const dateOf = (d: Date) => toZonedDateTime(d, timeZone).date;
  const tests = [...byTest.entries()].map(([name, list]) => ({
    name,
    ...cumulativeRows(
      list.map((r) => ({
        key: r.line.parameterId ?? r.line.name.toLowerCase(),
        name: r.line.name,
        unit: r.line.unit,
        date: dateOf(r.resultedAt!),
        orderId: r.line.orderId,
        value: r.line.value,
        number: toNumber(r.line.valueNumber),
        flag: r.line.flag as LabFlag,
        ref: r.line.referenceText ?? "",
      })),
    ),
  }));
  const structured = new Set(rows.map((r) => r.line.orderId));
  const others = (await listPatientLabOrders(tx, patientId, 100)).filter((o) => o.status === "resulted" && !structured.has(o.id));
  return { tests, others };
}
