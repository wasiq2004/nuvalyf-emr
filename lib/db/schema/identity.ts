// Clinic staff accounts, roles and permissions. All rows are clinic-scoped.
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { appSchema, clinicId, createdAt, id, updatedAt } from "./_shared";
import { clinics } from "./platform";

export const users = appSchema.table(
  "users",
  {
    id: id(),
    clinicId: clinicId().references(() => clinics.id, { onDelete: "restrict" }),
    email: varchar("email", { length: 255 }).notNull(),
    passwordHash: text("password_hash").notNull(),
    status: varchar("status", { length: 20 }).notNull().default("active"),
    mustChangePassword: boolean("must_change_password").notNull().default(true),
    /** Bumped to invalidate every existing session for this user. */
    sessionVersion: integer("session_version").notNull().default(1),
    firstName: varchar("first_name", { length: 100 }).notNull(),
    lastName: varchar("last_name", { length: 100 }).notNull(),
    phone: varchar("phone", { length: 50 }),
    title: varchar("title", { length: 20 }),
    specialty: varchar("specialty", { length: 150 }),
    /** Medical registration number; required before a doctor can sign. */
    registrationNumber: varchar("registration_number", { length: 100 }),
    registrationCouncil: varchar("registration_council", { length: 150 }),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    passwordChangedAt: timestamp("password_changed_at", { withTimezone: true }),
    createdBy: uuid("created_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("users_clinic_id_id_key").on(t.clinicId, t.id),
    uniqueIndex("users_clinic_email_idx").on(t.clinicId, sql`lower(${t.email})`),
    check("users_status_check", sql`${t.status} IN ('active', 'disabled')`),
  ],
);

export const roles = appSchema.table(
  "roles",
  {
    id: id(),
    clinicId: clinicId().references(() => clinics.id, { onDelete: "restrict" }),
    /** Stable key for system roles ("doctor"); custom roles get a slug. */
    key: varchar("key", { length: 50 }).notNull(),
    name: varchar("name", { length: 100 }).notNull(),
    description: text("description"),
    isSystem: boolean("is_system").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("roles_clinic_id_id_key").on(t.clinicId, t.id),
    uniqueIndex("roles_clinic_key_idx").on(t.clinicId, t.key),
  ],
);

export const rolePermissions = appSchema.table(
  "role_permissions",
  {
    clinicId: clinicId(),
    roleId: uuid("role_id").notNull(),
    permission: varchar("permission", { length: 60 }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.roleId, t.permission] }),
    foreignKey({
      name: "role_permissions_role_fk",
      columns: [t.clinicId, t.roleId],
      foreignColumns: [roles.clinicId, roles.id],
    }).onDelete("cascade"),
  ],
);

export const userRoles = appSchema.table(
  "user_roles",
  {
    clinicId: clinicId(),
    userId: uuid("user_id").notNull(),
    roleId: uuid("role_id").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.roleId] }),
    foreignKey({
      name: "user_roles_user_fk",
      columns: [t.clinicId, t.userId],
      foreignColumns: [users.clinicId, users.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "user_roles_role_fk",
      columns: [t.clinicId, t.roleId],
      foreignColumns: [roles.clinicId, roles.id],
    }).onDelete("cascade"),
    index("user_roles_role_idx").on(t.roleId),
  ],
);
