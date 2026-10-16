-- Extensions used by the front desk:
--   pg_trgm    fuzzy name matching for patient search and duplicate detection
--   btree_gist lets an exclusion constraint combine "same doctor" (=) with
--              "overlapping time range" (&&) to make double booking impossible
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS btree_gist;
