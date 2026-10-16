import { check, integer, text, uuid, varchar } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { appSchema, updatedAt } from "./_shared";
import { clinics } from "./platform";

/** One row per clinic; edited by the Clinic Admin. */
export const clinicSettings = appSchema.table(
  "clinic_settings",
  {
    clinicId: uuid("clinic_id")
      .primaryKey()
      .references(() => clinics.id, { onDelete: "restrict" }),
    displayName: varchar("display_name", { length: 200 }).notNull(),
    addressLine: text("address_line"),
    city: varchar("city", { length: 100 }),
    phone: varchar("phone", { length: 50 }),
    email: varchar("email", { length: 255 }),
    website: varchar("website", { length: 255 }),
    timezone: varchar("timezone", { length: 64 }).notNull().default("Asia/Kolkata"),
    /** Extra lines printed under the clinic name on prescriptions/invoices. */
    letterheadText: text("letterhead_text"),
    footerText: text("footer_text"),
    slotMinutes: integer("slot_minutes").notNull().default(15),
    currency: varchar("currency", { length: 3 }).notNull().default("INR"),
    /** Analytics: counts below this are suppressed (platform minimum 3). */
    analyticsMinCell: integer("analytics_min_cell").notNull().default(5),
    updatedBy: uuid("updated_by"),
    updatedAt: updatedAt(),
  },
  (t) => [check("clinic_settings_min_cell_check", sql`${t.analyticsMinCell} BETWEEN 3 AND 50`)],
);
