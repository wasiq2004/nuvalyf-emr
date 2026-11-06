import "server-only";

// The discharge summary: drafted from the record, edited by the doctor, then
// signed and locked. The balance due is shown on it; it is never held back
// for payment.
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import { admissionCharges, bedStays, diagnoses, dischargeSummaries, encounters, labOrders, prescriptionItems, prescriptions, vitals } from "@/lib/db/schema";
import { AppError } from "@/lib/errors";
import { formatDate, formatDateTime } from "@/lib/format";
import { dosageText } from "@/features/pharmacy/dispensing-rules";
import { getAdmission, getInpatientSettings } from "./inpatient.service";
import { mergeDraft, missingForSigning, type SummarySection } from "./summary-rules";

/** What the record can already say, section by section. */
async function fromRecord(tx: Tx, admissionId: string, today: string, timezone: string): Promise<Record<string, string>> {
  const admission = await getAdmission(tx, admissionId, today);
  if (!admission) throw new AppError("Admission not found.");
  const [encounter] = await tx.select().from(encounters).where(eq(encounters.id, admission.encounterId)).limit(1);

  const diagnosisRows = await tx.select().from(diagnoses).where(eq(diagnoses.encounterId, admission.encounterId)).orderBy(desc(diagnoses.isPrimary), asc(diagnoses.createdAt));
  const labs = await tx.select().from(labOrders).where(and(eq(labOrders.encounterId, admission.encounterId), eq(labOrders.status, "resulted"))).orderBy(asc(labOrders.resultedAt));
  const stays = await tx.select().from(bedStays).where(eq(bedStays.admissionId, admissionId)).orderBy(asc(bedStays.startedAt));
  const readings = await tx.select().from(vitals).where(eq(vitals.encounterId, admission.encounterId)).orderBy(asc(vitals.recordedAt));
  const given = await tx
    .select({ description: admissionCharges.description, kind: admissionCharges.kind })
    .from(admissionCharges)
    .where(and(eq(admissionCharges.admissionId, admissionId), isNull(admissionCharges.voidedAt)))
    .orderBy(asc(admissionCharges.createdAt));
  const [rx] = await tx.select({ id: prescriptions.id }).from(prescriptions).where(eq(prescriptions.encounterId, admission.encounterId)).limit(1);
  const medicines = rx ? await tx.select().from(prescriptionItems).where(eq(prescriptionItems.prescriptionId, rx.id)).orderBy(asc(prescriptionItems.sortOrder)) : [];

  const vitalsLine = (v: typeof vitals.$inferSelect) =>
    [v.systolic ? `BP ${v.systolic}/${v.diastolic ?? "-"}` : null, v.pulse ? `pulse ${v.pulse}` : null, v.temperatureC ? `temp ${v.temperatureC} °C` : null, v.spo2 ? `SpO2 ${v.spo2}%` : null].filter(Boolean).join(", ");

  const course = [
    ...stays.map((s) => `${formatDateTime(s.startedAt, timezone)}: ${s.categoryName}, bed ${s.bedLabel}`),
    readings.length ? `On admission: ${vitalsLine(readings[0])}` : null,
    readings.length > 1 ? `Latest (${formatDateTime(readings[readings.length - 1].recordedAt, timezone)}): ${vitalsLine(readings[readings.length - 1])}` : null,
  ].filter(Boolean);

  return {
    reason: admission.reason,
    history: [encounter?.chiefComplaint, encounter?.history, encounter?.examination, encounter?.nursingNotes ? `Nursing notes: ${encounter.nursingNotes}` : null].filter(Boolean).join("\n"),
    diagnosis: diagnosisRows.map((d) => `${d.code} ${d.label}${d.isPrimary ? " (primary)" : ""}`).join("\n"),
    investigations: labs.map((l) => `${l.testName}, ${l.resultedAt ? formatDate(l.resultedAt, timezone) : ""}: ${l.resultValue ?? ""}${l.unit ? ` ${l.unit}` : ""}`).join("\n"),
    course: course.join("\n"),
    treatment: given.filter((g) => g.kind === "procedure" || g.kind === "pharmacy").map((g) => g.description).join("\n"),
    medicines: medicines.map((m, i) => `${i + 1}. ${m.drugName}${m.strength ? ` ${m.strength}` : ""}: ${dosageText(m)}`).join("\n"),
    advice: [encounter?.plan, encounter?.followUp ? `Follow-up: ${encounter.followUp}` : null].filter(Boolean).join("\n"),
  };
}

export async function getSummary(tx: Tx, admissionId: string) {
  const [row] = await tx.select().from(dischargeSummaries).where(eq(dischargeSummaries.admissionId, admissionId)).limit(1);
  return row ? { ...row, sections: row.sections as SummarySection[] } : null;
}

/** Creates the draft, or fills empty sections again; what the doctor wrote stays. */
export async function draftSummary(tx: Tx, clinicId: string, admissionId: string, actorId: string, today: string, timezone: string) {
  const settings = await getInpatientSettings(tx, clinicId);
  const filled = await fromRecord(tx, admissionId, today, timezone);
  const current = await getSummary(tx, admissionId);
  if (current?.status === "signed") throw new AppError("This summary is signed and locked.");
  const sections = mergeDraft(settings.sections, filled, current?.sections);
  if (current) {
    await tx.update(dischargeSummaries).set({ sections, updatedAt: new Date() }).where(eq(dischargeSummaries.id, current.id));
    return current.id;
  }
  const [row] = await tx.insert(dischargeSummaries).values({ clinicId, admissionId, sections, createdBy: actorId }).returning({ id: dischargeSummaries.id });
  return row.id;
}

export async function saveSummary(tx: Tx, admissionId: string, bodies: { key: string; body: string }[]) {
  const current = await getSummary(tx, admissionId);
  if (!current) throw new AppError("Draft the summary first.");
  if (current.status === "signed") throw new AppError("This summary is signed and locked.");
  const sections = current.sections.map((s) => ({ ...s, body: bodies.find((b) => b.key === s.key)?.body ?? s.body }));
  await tx.update(dischargeSummaries).set({ sections, updatedAt: new Date() }).where(eq(dischargeSummaries.id, current.id));
}

export async function signSummary(tx: Tx, admissionId: string, signer: { id: string; name: string; registrationNumber: string | null }) {
  const current = await getSummary(tx, admissionId);
  if (!current) throw new AppError("Draft the summary first.");
  if (current.status === "signed") throw new AppError("This summary is already signed.");
  if (!signer.registrationNumber?.trim()) throw new AppError("Your registration number is needed to sign. Ask your Clinic Admin to add it.");
  const missing = missingForSigning(current.sections);
  if (missing.length) throw new AppError(`Fill in before signing: ${missing.join(", ")}.`);
  await tx
    .update(dischargeSummaries)
    .set({ status: "signed", signedBy: signer.id, signedByName: signer.name, signedRegistration: signer.registrationNumber, signedAt: new Date(), updatedAt: new Date() })
    .where(eq(dischargeSummaries.id, current.id));
}
