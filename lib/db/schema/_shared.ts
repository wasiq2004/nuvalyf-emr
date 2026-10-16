// Shared building blocks for the v2 schema.
//
// Postgres schemas:
//   platform - clinics, plans, operators. Never holds patient data.
//   app      - everything a clinic owns. Every table has clinic_id and is
//              protected by row-level security (db/sql/security.sql).
//   sys      - infrastructure tables (rate limits).
import { pgSchema, timestamp, uuid } from "drizzle-orm/pg-core";

export const platformSchema = pgSchema("platform");
export const appSchema = pgSchema("app");
export const sysSchema = pgSchema("sys");

export const id = () => uuid("id").defaultRandom().primaryKey();

export const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

/** clinic_id column. The FK to platform.clinics is declared per table. */
export const clinicId = () => uuid("clinic_id").notNull();
