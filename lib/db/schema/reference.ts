// Shared reference data, the same for every clinic and never holding patient
// data. The app role may only read it; it is loaded by the owner role
// (scripts/db/reference.ts). Clinics copy an entry into their own list
// (app.drugs) when they first use it, so their prices and changes stay theirs.
import { boolean, index, integer, numeric, pgSchema, serial, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const refSchema = pgSchema("ref");

/** Indian medicines (brand, manufacturer, composition, pack, MRP when listed). */
export const referenceMedicines = refSchema.table(
  "medicines",
  {
    id: serial("id").primaryKey(),
    /** Row id in the source dataset, so reloads update instead of duplicating. */
    sourceId: integer("source_id").notNull(),
    name: varchar("name", { length: 160 }).notNull(),
    /** features/catalog/item-rules.ts normalizeItemName(name). */
    normalized: varchar("normalized", { length: 160 }).notNull(),
    manufacturer: varchar("manufacturer", { length: 120 }),
    composition: varchar("composition", { length: 300 }),
    genericName: varchar("generic_name", { length: 200 }).notNull(),
    strength: varchar("strength", { length: 60 }),
    form: varchar("form", { length: 30 }).notNull(),
    packLabel: varchar("pack_label", { length: 100 }).notNull(),
    packSize: integer("pack_size").notNull(),
    /** Listed MRP per pack at the time the dataset was compiled; a hint only. */
    mrp: numeric("mrp", { precision: 10, scale: 2 }),
    discontinued: boolean("discontinued").notNull().default(false),
  },
  (t) => [
    uniqueIndex("ref_medicines_source_idx").on(t.sourceId),
    // Substring search on any part of the name (pg_trgm, migration 0016).
    index("ref_medicines_name_trgm_idx").using("gin", sql`${t.normalized} gin_trgm_ops`),
  ],
);

/** Which version of each reference list is loaded. */
export const referenceDatasets = refSchema.table("datasets", {
  name: varchar("name", { length: 60 }).primaryKey(),
  version: varchar("version", { length: 40 }).notNull(),
  rows: integer("rows").notNull(),
  loadedAt: timestamp("loaded_at", { withTimezone: true }).notNull().defaultNow(),
});
