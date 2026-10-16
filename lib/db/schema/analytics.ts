// De-identified analytics (module "analytics"). No table here stores a name,
// mobile number or record number. A cohort's pseudonyms are keyed with its own
// salt, so the same patient is unlinkable across cohorts.
import { check, foreignKey, index, integer, jsonb, text, timestamp, unique, uuid, varchar } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { appSchema, clinicId, createdAt, id, updatedAt } from "./_shared";
import { clinics } from "./platform";

export const cohorts = appSchema.table(
  "cohorts",
  {
    id: id(),
    clinicId: clinicId().references(() => clinics.id, { onDelete: "restrict" }),
    name: varchar("name", { length: 200 }).notNull(),
    /** Required: why this analysis is being done. */
    purpose: text("purpose").notNull(),
    /** Criteria, including the required date window (analytics-rules.ts). */
    definition: jsonb("definition").notNull(),
    /** Bumped whenever the definition changes; runs and exports record it. */
    version: integer("version").notNull().default(1),
    /** Per-cohort pseudonym key (hex). Never leaves the server. */
    salt: varchar("salt", { length: 64 }).notNull(),
    status: varchar("status", { length: 20 }).notNull().default("active"),
    createdBy: uuid("created_by").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [unique("cohorts_clinic_id_id_key").on(t.clinicId, t.id), check("cohorts_status_check", sql`${t.status} IN ('active', 'archived')`)],
);

export const cohortRuns = appSchema.table(
  "cohort_runs",
  {
    id: id(),
    clinicId: clinicId(),
    cohortId: uuid("cohort_id").notNull(),
    version: integer("version").notNull(),
    definition: jsonb("definition").notNull(),
    size: integer("size").notNull(),
    ranBy: uuid("ran_by").notNull(),
    ranAt: timestamp("ran_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("cohort_runs_clinic_id_id_key").on(t.clinicId, t.id),
    foreignKey({ name: "cohort_runs_cohort_fk", columns: [t.clinicId, t.cohortId], foreignColumns: [cohorts.clinicId, cohorts.id] }),
    index("cohort_runs_cohort_idx").on(t.cohortId, t.ranAt),
  ],
);

export const analyticsExports = appSchema.table(
  "analytics_exports",
  {
    id: id(),
    clinicId: clinicId(),
    cohortId: uuid("cohort_id").notNull(),
    runId: uuid("run_id").notNull(),
    version: integer("version").notNull(),
    definition: jsonb("definition").notNull(),
    columns: jsonb("columns").notNull(),
    rowCount: integer("row_count").notNull(),
    exportedBy: uuid("exported_by").notNull(),
    exportedAt: createdAt(),
  },
  (t) => [
    foreignKey({ name: "analytics_exports_cohort_fk", columns: [t.clinicId, t.cohortId], foreignColumns: [cohorts.clinicId, cohorts.id] }),
    foreignKey({ name: "analytics_exports_run_fk", columns: [t.clinicId, t.runId], foreignColumns: [cohortRuns.clinicId, cohortRuns.id] }),
  ],
);
