CREATE TABLE "app"."analytics_exports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"cohort_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"definition" jsonb NOT NULL,
	"columns" jsonb NOT NULL,
	"row_count" integer NOT NULL,
	"exported_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."cohort_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"cohort_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"definition" jsonb NOT NULL,
	"size" integer NOT NULL,
	"ran_by" uuid NOT NULL,
	"ran_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cohort_runs_clinic_id_id_key" UNIQUE("clinic_id","id")
);
--> statement-breakpoint
CREATE TABLE "app"."cohorts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"name" varchar(200) NOT NULL,
	"purpose" text NOT NULL,
	"definition" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"salt" varchar(64) NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cohorts_clinic_id_id_key" UNIQUE("clinic_id","id"),
	CONSTRAINT "cohorts_status_check" CHECK ("app"."cohorts"."status" IN ('active', 'archived'))
);
--> statement-breakpoint
ALTER TABLE "app"."clinic_settings" ADD COLUMN "analytics_min_cell" integer DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."analytics_exports" ADD CONSTRAINT "analytics_exports_cohort_fk" FOREIGN KEY ("clinic_id","cohort_id") REFERENCES "app"."cohorts"("clinic_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."analytics_exports" ADD CONSTRAINT "analytics_exports_run_fk" FOREIGN KEY ("clinic_id","run_id") REFERENCES "app"."cohort_runs"("clinic_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."cohort_runs" ADD CONSTRAINT "cohort_runs_cohort_fk" FOREIGN KEY ("clinic_id","cohort_id") REFERENCES "app"."cohorts"("clinic_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."cohorts" ADD CONSTRAINT "cohorts_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "platform"."clinics"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cohort_runs_cohort_idx" ON "app"."cohort_runs" USING btree ("cohort_id","ran_at");--> statement-breakpoint
ALTER TABLE "app"."clinic_settings" ADD CONSTRAINT "clinic_settings_min_cell_check" CHECK ("app"."clinic_settings"."analytics_min_cell" BETWEEN 3 AND 50);