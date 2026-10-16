"use server";

import { z } from "zod";
import { clinicAction } from "@/lib/auth/actions";
import { todayInTimeZone } from "@/lib/time";
import { MAX_IMPORT_BYTES } from "./import-rules";
import { dryRun, recordRejected, runImport, type ImportReport } from "./import.service";

const fileFields = {
  fileName: z.string().trim().min(1).max(200),
  csv: z.string().min(1, "Choose a CSV file").max(MAX_IMPORT_BYTES, "The file is larger than 2 MB. Split it."),
};

export const validateImportAction = clinicAction(
  { name: "import.validate", permission: "import:run", schema: z.object(fileFields) },
  async ({ session, db }, input) => db((tx) => dryRun(tx, input.csv, todayInTimeZone(session.timezone))),
);

export type ImportOutcome = { status: "imported"; imported: number } | { status: "rejected"; report: ImportReport };

/** All or nothing: any problem means no patient is created. */
export const runImportAction = clinicAction(
  { name: "import.run", permission: "import:run", schema: z.object({ ...fileFields, idempotencyKey: z.string().trim().min(16).max(64) }) },
  async ({ session, db, audit }, input): Promise<ImportOutcome> => {
    const today = todayInTimeZone(session.timezone);
    const report = await db((tx) => dryRun(tx, input.csv, today));
    if (report.problems.length > 0) {
      await db(async (tx) => {
        await recordRejected(tx, session.clinicId, input.fileName, report, session.userId);
        await audit(tx, {
          action: "IMPORT_REJECTED",
          targetType: "import",
          severity: "warning",
          details: { file: input.fileName, rows: report.rows, problems: report.problems.length },
        });
      });
      return { status: "rejected", report };
    }
    return db(async (tx) => {
      const { result, replayed } = await runImport(tx, session.clinicId, input, session.userId, today);
      if (!replayed) {
        await audit(tx, { action: "IMPORT_COMPLETED", targetType: "import", targetId: result.jobId, details: { file: input.fileName, imported: result.imported } });
      }
      return { status: "imported", imported: result.imported };
    });
  },
);
