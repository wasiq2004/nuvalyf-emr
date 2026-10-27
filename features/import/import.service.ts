import "server-only";

// Patient register import: validate everything, then commit every row in one
// transaction - or nothing. A stated age is stored with the import date so it
// ages correctly. Likely duplicates of existing patients are errors: the same
// "search before create" rule as the front desk.
import { desc, eq } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import { importJobs } from "@/lib/db/schema";
import { AppError } from "@/lib/errors";
import { idempotent } from "@/lib/idempotency";
import { findDuplicateCandidates, registerPatient } from "@/features/patients/patients.service";
import { setConsent } from "@/features/messaging/consent.service";
import { parseCsv, validateRows, type ImportProblem, type ImportRow } from "./import-rules";

export type ImportReport = { rows: number; ready: number; problems: ImportProblem[] };

async function check(tx: Tx, csv: string, today: string): Promise<{ report: ImportReport; valid: ImportRow[] }> {
  const rows = parseCsv(csv);
  const { valid, problems } = validateRows(rows, today);
  for (const row of valid) {
    const candidates = await findDuplicateCandidates(tx, row.patient, today);
    const likely = candidates.find((c) => c.likely);
    if (likely) {
      problems.push({ line: row.line, field: "row", message: `Likely already registered as ${likely.mrn} (${likely.reasons.join(", ").toLowerCase()})` });
    }
  }
  const bad = new Set(problems.map((p) => p.line));
  const ready = valid.filter((r) => !bad.has(r.line));
  problems.sort((a, b) => a.line - b.line);
  return { report: { rows: Math.max(0, rows.length - 1), ready: ready.length, problems }, valid: ready };
}

/** The validation report without changing anything. */
export async function dryRun(tx: Tx, csv: string, today: string) {
  return (await check(tx, csv, today)).report;
}

/**
 * Imports the file if - and only if - every row is valid. Otherwise records
 * the rejected attempt and changes nothing else.
 */
export async function runImport(tx: Tx, clinicId: string, input: { fileName: string; csv: string; idempotencyKey: string }, actorId: string, today: string) {
  return idempotent(tx, { clinicId, name: "patient-import", key: input.idempotencyKey, input: { fileName: input.fileName, csv: input.csv } }, async () => {
    const { report, valid } = await check(tx, input.csv, today);
    if (report.problems.length > 0) {
      throw new AppError(`Nothing was imported: ${report.problems.length} problem(s) in the file. Fix them and try again.`);
    }
    if (valid.length === 0) throw new AppError("The file has no patient rows.");
    for (const row of valid) {
      const patient = await registerPatient(tx, clinicId, row.patient, { likelyIds: [], actorId, today });
      for (const [type, granted] of [
        ["whatsapp_reminders", row.consentReminders],
        ["whatsapp_broadcasts", row.consentBroadcasts],
      ] as const) {
        if (granted) await setConsent(tx, clinicId, { patientId: patient.id, type, granted: true, source: "import", note: input.fileName }, actorId);
      }
    }
    const [job] = await tx
      .insert(importJobs)
      .values({ clinicId, fileName: input.fileName, rowCount: report.rows, imported: valid.length, status: "imported", createdBy: actorId })
      .returning({ id: importJobs.id });
    return { jobId: job.id, imported: valid.length };
  });
}

/** Records a refused attempt (outside the failed transaction) for the history. */
export async function recordRejected(tx: Tx, clinicId: string, fileName: string, report: ImportReport, actorId: string) {
  await tx.insert(importJobs).values({
    clinicId,
    fileName,
    rowCount: report.rows,
    imported: 0,
    status: "rejected",
    errors: report.problems.slice(0, 200),
    createdBy: actorId,
  });
}

export function listImportJobs(tx: Tx) {
  return tx.select().from(importJobs).where(eq(importJobs.kind, "patients")).orderBy(desc(importJobs.createdAt)).limit(20);
}
