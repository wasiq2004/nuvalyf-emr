import { boolean, check, index, integer, jsonb, primaryKey, text, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createdAt, id, platformSchema, updatedAt } from "./_shared";

export const plans = platformSchema.table(
  "plans",
  {
    id: id(),
    name: varchar("name", { length: 100 }).notNull(),
    description: text("description"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("plans_name_lower_idx").on(sql`lower(${t.name})`)],
);

export const planModules = platformSchema.table(
  "plan_modules",
  {
    planId: uuid("plan_id")
      .notNull()
      .references(() => plans.id, { onDelete: "cascade" }),
    module: varchar("module", { length: 50 }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.planId, t.module] })],
);

export const clinics = platformSchema.table(
  "clinics",
  {
    id: id(),
    name: varchar("name", { length: 200 }).notNull(),
    /** Short code staff type at sign-in, e.g. "sunrise-clinic". */
    code: varchar("code", { length: 40 }).notNull(),
    status: varchar("status", { length: 20 }).notNull().default("active"),
    planId: uuid("plan_id").references(() => plans.id, { onDelete: "set null" }),
    contactName: varchar("contact_name", { length: 200 }),
    contactEmail: varchar("contact_email", { length: 255 }),
    contactPhone: varchar("contact_phone", { length: 50 }),
    suspendedAt: timestamp("suspended_at", { withTimezone: true }),
    suspendedReason: text("suspended_reason"),
    createdBy: uuid("created_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("clinics_code_idx").on(t.code),
    check("clinics_status_check", sql`${t.status} IN ('active', 'suspended')`),
    check("clinics_code_format_check", sql`${t.code} ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'`),
  ],
);

export const operators = platformSchema.table(
  "operators",
  {
    id: id(),
    email: varchar("email", { length: 255 }).notNull(),
    name: varchar("name", { length: 200 }).notNull(),
    passwordHash: text("password_hash").notNull(),
    role: varchar("role", { length: 30 }).notNull(),
    status: varchar("status", { length: 20 }).notNull().default("active"),
    mustChangePassword: boolean("must_change_password").notNull().default(true),
    sessionVersion: integer("session_version").notNull().default(1),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    createdBy: uuid("created_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("operators_email_lower_idx").on(sql`lower(${t.email})`),
    check("operators_role_check", sql`${t.role} IN ('platform_admin', 'operator')`),
    check("operators_status_check", sql`${t.status} IN ('active', 'disabled')`),
  ],
);

/** Append-only (trigger in db/sql/security.sql). */
export const platformAuditEvents = platformSchema.table(
  "audit_events",
  {
    id: id(),
    operatorId: uuid("operator_id"),
    action: varchar("action", { length: 100 }).notNull(),
    targetType: varchar("target_type", { length: 50 }),
    targetId: varchar("target_id", { length: 100 }),
    outcome: varchar("outcome", { length: 20 }).notNull().default("success"),
    details: jsonb("details"),
    ipAddress: varchar("ip_address", { length: 45 }),
    createdAt: createdAt(),
  },
  (t) => [
    index("platform_audit_created_idx").on(t.createdAt),
    check("platform_audit_outcome_check", sql`${t.outcome} IN ('success', 'denied', 'error')`),
  ],
);

/**
 * Per-clinic usage counts (db/sql/views.sql). Counts only: the platform role
 * can read this view but has no grant on any clinic table.
 */
export const clinicUsage = platformSchema
  .view("clinic_usage", {
    clinicId: uuid("clinic_id").notNull(),
    staffTotal: integer("staff_total").notNull(),
    staffActive: integer("staff_active").notNull(),
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true }),
  })
  .existing();
