CREATE TABLE "app"."admission_charges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"admission_id" uuid NOT NULL,
	"kind" varchar(15) NOT NULL,
	"description" varchar(300) NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"unit_amount" numeric(12, 2) NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"source_type" varchar(20),
	"source_id" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"voided_at" timestamp with time zone,
	"voided_by" uuid,
	"void_reason" varchar(300),
	CONSTRAINT "admission_charges_kind_check" CHECK ("app"."admission_charges"."kind" IN ('doctor', 'nursing', 'procedure', 'lab', 'pharmacy', 'other')),
	CONSTRAINT "admission_charges_amount_check" CHECK ("app"."admission_charges"."amount" = "app"."admission_charges"."unit_amount" * "app"."admission_charges"."quantity"),
	CONSTRAINT "admission_charges_quantity_check" CHECK ("app"."admission_charges"."quantity" > 0),
	CONSTRAINT "admission_charges_void_check" CHECK ("app"."admission_charges"."voided_at" IS NULL OR "app"."admission_charges"."void_reason" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "app"."admission_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"admission_id" uuid NOT NULL,
	"number" varchar(30) NOT NULL,
	"kind" varchar(10) NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"method" varchar(10) NOT NULL,
	"reference" varchar(100),
	"note" varchar(300),
	"idempotency_key" varchar(64) NOT NULL,
	"received_by" uuid NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admission_payments_kind_check" CHECK ("app"."admission_payments"."kind" IN ('advance', 'payment', 'refund')),
	CONSTRAINT "admission_payments_amount_check" CHECK ("app"."admission_payments"."amount" > 0),
	CONSTRAINT "admission_payments_method_check" CHECK ("app"."admission_payments"."method" IN ('cash', 'upi', 'card', 'other'))
);
--> statement-breakpoint
CREATE TABLE "app"."admissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"number" varchar(30) NOT NULL,
	"patient_id" uuid NOT NULL,
	"visit_id" uuid NOT NULL,
	"encounter_id" uuid NOT NULL,
	"doctor_id" uuid NOT NULL,
	"reason" varchar(500) NOT NULL,
	"attendant_name" varchar(120),
	"attendant_phone" varchar(20),
	"status" varchar(15) DEFAULT 'admitted' NOT NULL,
	"admitted_at" timestamp with time zone NOT NULL,
	"discharged_at" timestamp with time zone,
	"discharged_by" uuid,
	"billing_mode" varchar(10) NOT NULL,
	"minimum_hours" integer NOT NULL,
	"discount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"discount_reason" varchar(300),
	"discount_by" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admissions_clinic_id_id_key" UNIQUE("clinic_id","id"),
	CONSTRAINT "admissions_status_check" CHECK ("app"."admissions"."status" IN ('admitted', 'discharged')),
	CONSTRAINT "admissions_mode_check" CHECK ("app"."admissions"."billing_mode" IN ('hourly', 'block')),
	CONSTRAINT "admissions_discount_check" CHECK ("app"."admissions"."discount" >= 0),
	CONSTRAINT "admissions_discharge_check" CHECK (("app"."admissions"."status" = 'admitted' AND "app"."admissions"."discharged_at" IS NULL) OR ("app"."admissions"."status" = 'discharged' AND "app"."admissions"."discharged_at" >= "app"."admissions"."admitted_at"))
);
--> statement-breakpoint
CREATE TABLE "app"."bed_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"name" varchar(80) NOT NULL,
	"daily_rate" numeric(12, 2) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bed_categories_clinic_id_id_key" UNIQUE("clinic_id","id"),
	CONSTRAINT "bed_categories_rate_check" CHECK ("app"."bed_categories"."daily_rate" >= 0)
);
--> statement-breakpoint
CREATE TABLE "app"."bed_stays" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"admission_id" uuid NOT NULL,
	"bed_id" uuid NOT NULL,
	"bed_label" varchar(120) NOT NULL,
	"category_name" varchar(80) NOT NULL,
	"daily_rate" numeric(12, 2) NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"override_hours" integer,
	"override_rate" numeric(12, 2),
	"override_reason" varchar(300),
	"override_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bed_stays_range_check" CHECK ("app"."bed_stays"."ended_at" IS NULL OR "app"."bed_stays"."ended_at" >= "app"."bed_stays"."started_at"),
	CONSTRAINT "bed_stays_override_check" CHECK (("app"."bed_stays"."override_hours" IS NULL AND "app"."bed_stays"."override_rate" IS NULL) OR "app"."bed_stays"."override_reason" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "app"."beds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"ward" varchar(80),
	"code" varchar(30) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "beds_clinic_id_id_key" UNIQUE("clinic_id","id")
);
--> statement-breakpoint
CREATE TABLE "app"."discharge_summaries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"admission_id" uuid NOT NULL,
	"status" varchar(10) DEFAULT 'draft' NOT NULL,
	"sections" jsonb NOT NULL,
	"signed_by" uuid,
	"signed_by_name" varchar(200),
	"signed_registration" text,
	"signed_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discharge_summaries_status_check" CHECK ("app"."discharge_summaries"."status" IN ('draft', 'signed'))
);
--> statement-breakpoint
CREATE TABLE "app"."inpatient_settings" (
	"clinic_id" uuid PRIMARY KEY NOT NULL,
	"billing_mode" varchar(10) DEFAULT 'hourly' NOT NULL,
	"minimum_hours" integer DEFAULT 24 NOT NULL,
	"summary_sections" jsonb,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inpatient_settings_mode_check" CHECK ("app"."inpatient_settings"."billing_mode" IN ('hourly', 'block')),
	CONSTRAINT "inpatient_settings_minimum_check" CHECK ("app"."inpatient_settings"."minimum_hours" BETWEEN 0 AND 240)
);
--> statement-breakpoint
ALTER TABLE "app"."visits" DROP CONSTRAINT "visits_status_check";--> statement-breakpoint
ALTER TABLE "app"."pharmacy_sales" DROP CONSTRAINT "pharmacy_sales_method_check";--> statement-breakpoint
ALTER TABLE "app"."sale_returns" DROP CONSTRAINT "sale_returns_method_check";--> statement-breakpoint
ALTER TABLE "app"."admission_charges" ADD CONSTRAINT "admission_charges_admission_fk" FOREIGN KEY ("clinic_id","admission_id") REFERENCES "app"."admissions"("clinic_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."admission_payments" ADD CONSTRAINT "admission_payments_admission_fk" FOREIGN KEY ("clinic_id","admission_id") REFERENCES "app"."admissions"("clinic_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."admissions" ADD CONSTRAINT "admissions_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "platform"."clinics"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."admissions" ADD CONSTRAINT "admissions_patient_fk" FOREIGN KEY ("clinic_id","patient_id") REFERENCES "app"."patients"("clinic_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."admissions" ADD CONSTRAINT "admissions_visit_fk" FOREIGN KEY ("clinic_id","visit_id") REFERENCES "app"."visits"("clinic_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."admissions" ADD CONSTRAINT "admissions_encounter_fk" FOREIGN KEY ("clinic_id","encounter_id") REFERENCES "app"."encounters"("clinic_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."admissions" ADD CONSTRAINT "admissions_doctor_fk" FOREIGN KEY ("clinic_id","doctor_id") REFERENCES "app"."users"("clinic_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."bed_categories" ADD CONSTRAINT "bed_categories_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "platform"."clinics"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."bed_stays" ADD CONSTRAINT "bed_stays_admission_fk" FOREIGN KEY ("clinic_id","admission_id") REFERENCES "app"."admissions"("clinic_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."bed_stays" ADD CONSTRAINT "bed_stays_bed_fk" FOREIGN KEY ("clinic_id","bed_id") REFERENCES "app"."beds"("clinic_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."beds" ADD CONSTRAINT "beds_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "platform"."clinics"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."beds" ADD CONSTRAINT "beds_category_fk" FOREIGN KEY ("clinic_id","category_id") REFERENCES "app"."bed_categories"("clinic_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."discharge_summaries" ADD CONSTRAINT "discharge_summaries_admission_fk" FOREIGN KEY ("clinic_id","admission_id") REFERENCES "app"."admissions"("clinic_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."inpatient_settings" ADD CONSTRAINT "inpatient_settings_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "platform"."clinics"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admission_charges_admission_idx" ON "app"."admission_charges" USING btree ("admission_id");--> statement-breakpoint
CREATE UNIQUE INDEX "admission_charges_source_idx" ON "app"."admission_charges" USING btree ("clinic_id","source_type","source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "admission_payments_number_idx" ON "app"."admission_payments" USING btree ("clinic_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "admission_payments_idempotency_idx" ON "app"."admission_payments" USING btree ("clinic_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "admission_payments_admission_idx" ON "app"."admission_payments" USING btree ("admission_id");--> statement-breakpoint
CREATE INDEX "admission_payments_received_idx" ON "app"."admission_payments" USING btree ("clinic_id","received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "admissions_number_idx" ON "app"."admissions" USING btree ("clinic_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "admissions_open_patient_idx" ON "app"."admissions" USING btree ("clinic_id","patient_id") WHERE "app"."admissions"."status" = 'admitted';--> statement-breakpoint
CREATE UNIQUE INDEX "admissions_visit_idx" ON "app"."admissions" USING btree ("visit_id");--> statement-breakpoint
CREATE INDEX "admissions_status_idx" ON "app"."admissions" USING btree ("clinic_id","status","admitted_at");--> statement-breakpoint
CREATE INDEX "admissions_patient_idx" ON "app"."admissions" USING btree ("clinic_id","patient_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bed_categories_name_idx" ON "app"."bed_categories" USING btree ("clinic_id","name");--> statement-breakpoint
CREATE INDEX "bed_stays_admission_idx" ON "app"."bed_stays" USING btree ("admission_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bed_stays_open_bed_idx" ON "app"."bed_stays" USING btree ("clinic_id","bed_id") WHERE "app"."bed_stays"."ended_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "bed_stays_open_admission_idx" ON "app"."bed_stays" USING btree ("clinic_id","admission_id") WHERE "app"."bed_stays"."ended_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "beds_code_idx" ON "app"."beds" USING btree ("clinic_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "discharge_summaries_admission_idx" ON "app"."discharge_summaries" USING btree ("admission_id");--> statement-breakpoint
ALTER TABLE "app"."visits" ADD CONSTRAINT "visits_status_check" CHECK ("app"."visits"."status" IN ('waiting', 'in_triage', 'ready', 'with_doctor', 'completed', 'left', 'cancelled', 'inpatient'));--> statement-breakpoint
ALTER TABLE "app"."pharmacy_sales" ADD CONSTRAINT "pharmacy_sales_method_check" CHECK ("app"."pharmacy_sales"."method" IN ('cash', 'upi', 'card', 'other', 'credit', 'inpatient'));--> statement-breakpoint
ALTER TABLE "app"."sale_returns" ADD CONSTRAINT "sale_returns_method_check" CHECK ("app"."sale_returns"."refund_method" IN ('cash', 'upi', 'card', 'other', 'account', 'inpatient'));
--> statement-breakpoint
-- Inpatient permissions for clinics that already exist. New clinics get them
-- from lib/access/roles.ts at onboarding; they apply once the plan has the module.
INSERT INTO app.role_permissions (clinic_id, role_id, permission)
SELECT r.clinic_id, r.id, p.permission
FROM app.roles r
JOIN (VALUES
  ('clinic_admin', 'inpatient:read'),
  ('clinic_admin', 'inpatient:admit'),
  ('clinic_admin', 'inpatient:bill'),
  ('clinic_admin', 'inpatient:adjust'),
  ('receptionist', 'inpatient:read'),
  ('receptionist', 'inpatient:admit'),
  ('receptionist', 'inpatient:bill'),
  ('nurse', 'inpatient:read'),
  ('nurse', 'inpatient:admit'),
  ('doctor', 'inpatient:read'),
  ('doctor', 'inpatient:admit'),
  ('doctor', 'discharge:sign')
) AS p(role_key, permission) ON p.role_key = r.key
WHERE r.is_system
ON CONFLICT DO NOTHING;
