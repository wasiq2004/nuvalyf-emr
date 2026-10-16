-- Constraints Drizzle cannot express.

-- No two active appointments for one doctor may overlap in time.
ALTER TABLE "app"."appointments"
  ADD CONSTRAINT "appointments_no_overlap"
  EXCLUDE USING gist (
    "clinic_id" WITH =,
    "doctor_id" WITH =,
    tstzrange("starts_at", "ends_at") WITH &&
  ) WHERE ("status" IN ('booked', 'checked_in', 'completed'));
--> statement-breakpoint

-- Fuzzy name search / duplicate detection.
CREATE INDEX "patients_name_trgm_idx" ON "app"."patients"
  USING gin ((lower(coalesce("first_name", '') || ' ' || coalesce("last_name", ''))) gin_trgm_ops);
