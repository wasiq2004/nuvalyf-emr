import { check, index, jsonb, uuid, varchar } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { appSchema, clinicId, createdAt, id } from "./_shared";
import { clinics } from "./platform";

/**
 * Clinic audit trail. Append-only: a trigger rejects UPDATE, DELETE and
 * TRUNCATE (db/sql/security.sql). No FK on actor/patient so history
 * survives anything.
 */
export const auditEvents = appSchema.table(
  "audit_events",
  {
    id: id(),
    clinicId: clinicId().references(() => clinics.id, { onDelete: "restrict" }),
    actorUserId: uuid("actor_user_id"),
    action: varchar("action", { length: 100 }).notNull(),
    targetType: varchar("target_type", { length: 50 }),
    targetId: varchar("target_id", { length: 100 }),
    /** Set whenever the event concerns a patient: "who opened this record?" */
    patientId: uuid("patient_id"),
    outcome: varchar("outcome", { length: 20 }).notNull().default("success"),
    severity: varchar("severity", { length: 20 }).notNull().default("info"),
    details: jsonb("details"),
    ipAddress: varchar("ip_address", { length: 45 }),
    userAgent: varchar("user_agent", { length: 300 }),
    createdAt: createdAt(),
  },
  (t) => [
    index("audit_clinic_time_idx").on(t.clinicId, t.createdAt),
    index("audit_clinic_patient_idx").on(t.clinicId, t.patientId, t.createdAt),
    index("audit_clinic_actor_idx").on(t.clinicId, t.actorUserId, t.createdAt),
    check("audit_outcome_check", sql`${t.outcome} IN ('success', 'denied', 'error')`),
    check("audit_severity_check", sql`${t.severity} IN ('info', 'warning', 'critical')`),
  ],
);
