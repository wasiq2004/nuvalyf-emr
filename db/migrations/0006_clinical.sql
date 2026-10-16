CREATE TABLE "app"."allergy_classes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"starter_key" varchar(80),
	"name" varchar(120) NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "allergy_classes_clinic_id_id_key" UNIQUE("clinic_id","id")
);
--> statement-breakpoint
CREATE TABLE "app"."diagnosis_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"starter_key" varchar(40),
	"code" varchar(20) NOT NULL,
	"label" varchar(300) NOT NULL,
	"is_favourite" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."drug_allergy_classes" (
	"clinic_id" uuid NOT NULL,
	"drug_id" uuid NOT NULL,
	"allergy_class_id" uuid NOT NULL,
	CONSTRAINT "drug_allergy_classes_drug_id_allergy_class_id_pk" PRIMARY KEY("drug_id","allergy_class_id")
);
--> statement-breakpoint
CREATE TABLE "app"."drug_interactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"starter_key" varchar(120),
	"generic_a" varchar(200) NOT NULL,
	"generic_b" varchar(200) NOT NULL,
	"severity" varchar(20) NOT NULL,
	"description" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "drug_interactions_severity_check" CHECK ("app"."drug_interactions"."severity" IN ('minor', 'moderate', 'major', 'contraindicated'))
);
--> statement-breakpoint
CREATE TABLE "app"."drugs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"starter_key" varchar(80),
	"name" varchar(200) NOT NULL,
	"generic_name" varchar(200) NOT NULL,
	"form" varchar(30) NOT NULL,
	"strength" varchar(60),
	"category" varchar(80),
	"default_dose" varchar(60),
	"default_frequency" varchar(40),
	"default_duration_days" integer,
	"default_instructions" varchar(200),
	"price" numeric(10, 2),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "drugs_clinic_id_id_key" UNIQUE("clinic_id","id"),
	CONSTRAINT "drugs_form_check" CHECK ("app"."drugs"."form" IN ('tablet', 'capsule', 'syrup', 'suspension', 'injection', 'ointment', 'cream', 'drops', 'inhaler', 'sachet', 'gel', 'other'))
);
--> statement-breakpoint
CREATE TABLE "app"."lab_tests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"starter_key" varchar(80),
	"name" varchar(200) NOT NULL,
	"sample_type" varchar(60),
	"unit" varchar(40),
	"reference_range" varchar(200),
	"price" numeric(10, 2),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lab_tests_clinic_id_id_key" UNIQUE("clinic_id","id")
);
--> statement-breakpoint
CREATE TABLE "app"."prescribing_presets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"starter_key" varchar(80),
	"kind" varchar(20) NOT NULL,
	"label" varchar(80) NOT NULL,
	"value" varchar(120) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "prescribing_presets_kind_check" CHECK ("app"."prescribing_presets"."kind" IN ('frequency', 'duration', 'instruction'))
);
--> statement-breakpoint
CREATE TABLE "app"."vital_ranges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"starter_key" varchar(80),
	"vital" varchar(30) NOT NULL,
	"age_min_years" integer DEFAULT 0 NOT NULL,
	"age_max_years" integer DEFAULT 150 NOT NULL,
	"low" numeric(7, 2),
	"high" numeric(7, 2),
	"critical_low" numeric(7, 2),
	"critical_high" numeric(7, 2),
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "vital_ranges_vital_check" CHECK ("app"."vital_ranges"."vital" IN ('temperature_c', 'systolic', 'diastolic', 'pulse', 'resp_rate', 'spo2', 'weight_kg', 'height_cm')),
	CONSTRAINT "vital_ranges_age_check" CHECK ("app"."vital_ranges"."age_max_years" >= "app"."vital_ranges"."age_min_years")
);
--> statement-breakpoint
CREATE TABLE "app"."allergies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"substance" varchar(200) NOT NULL,
	"allergy_class_id" uuid,
	"reaction" varchar(300),
	"severity" varchar(20) DEFAULT 'moderate' NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"recorded_by" uuid NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "allergies_clinic_id_id_key" UNIQUE("clinic_id","id"),
	CONSTRAINT "allergies_severity_check" CHECK ("app"."allergies"."severity" IN ('mild', 'moderate', 'severe')),
	CONSTRAINT "allergies_status_check" CHECK ("app"."allergies"."status" IN ('active', 'resolved', 'entered_in_error'))
);
--> statement-breakpoint
CREATE TABLE "app"."allergy_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"allergy_id" uuid NOT NULL,
	"previous" jsonb NOT NULL,
	"reason" text NOT NULL,
	"changed_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."diagnoses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"encounter_id" uuid NOT NULL,
	"code" varchar(20) NOT NULL,
	"label" varchar(300) NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."encounter_amendments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"encounter_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."encounters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"visit_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"doctor_id" uuid,
	"status" varchar(20) DEFAULT 'open' NOT NULL,
	"chief_complaint" text,
	"history" text,
	"examination" text,
	"plan" text,
	"follow_up" varchar(200),
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finalized_at" timestamp with time zone,
	"finalized_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "encounters_clinic_id_id_key" UNIQUE("clinic_id","id"),
	CONSTRAINT "encounters_status_check" CHECK ("app"."encounters"."status" IN ('open', 'finalized'))
);
--> statement-breakpoint
CREATE TABLE "app"."lab_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"encounter_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"test_id" uuid,
	"test_name" varchar(200) NOT NULL,
	"unit" varchar(40),
	"reference_range" varchar(200),
	"notes" text,
	"status" varchar(20) DEFAULT 'ordered' NOT NULL,
	"ordered_by" uuid NOT NULL,
	"ordered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"result_value" varchar(500),
	"result_flag" varchar(20),
	"result_notes" text,
	"resulted_by" uuid,
	"resulted_at" timestamp with time zone,
	"read_at" timestamp with time zone,
	CONSTRAINT "lab_orders_clinic_id_id_key" UNIQUE("clinic_id","id"),
	CONSTRAINT "lab_orders_status_check" CHECK ("app"."lab_orders"."status" IN ('ordered', 'resulted', 'cancelled')),
	CONSTRAINT "lab_orders_flag_check" CHECK ("app"."lab_orders"."result_flag" IS NULL OR "app"."lab_orders"."result_flag" IN ('normal', 'abnormal', 'critical'))
);
--> statement-breakpoint
CREATE TABLE "app"."prescription_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"prescription_id" uuid NOT NULL,
	"drug_id" uuid,
	"drug_name" varchar(200) NOT NULL,
	"generic_name" varchar(200) NOT NULL,
	"form" varchar(30) NOT NULL,
	"strength" varchar(60),
	"dose" varchar(60) NOT NULL,
	"frequency" varchar(40) NOT NULL,
	"duration_days" integer,
	"instructions" varchar(300),
	"quantity" integer,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"override_reason" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."prescriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"encounter_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"prescriber_id" uuid NOT NULL,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"signed_snapshot" jsonb,
	"signed_at" timestamp with time zone,
	"dispense_status" varchar(20) DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prescriptions_clinic_id_id_key" UNIQUE("clinic_id","id"),
	CONSTRAINT "prescriptions_status_check" CHECK ("app"."prescriptions"."status" IN ('draft', 'signed')),
	CONSTRAINT "prescriptions_dispense_check" CHECK ("app"."prescriptions"."dispense_status" IN ('pending', 'partial', 'dispensed', 'not_required'))
);
--> statement-breakpoint
CREATE TABLE "app"."private_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"encounter_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."vitals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"encounter_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"temperature_c" numeric(4, 1),
	"systolic" integer,
	"diastolic" integer,
	"pulse" integer,
	"resp_rate" integer,
	"spo2" integer,
	"weight_kg" numeric(5, 2),
	"height_cm" numeric(5, 1),
	"flags" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"notes" text,
	"recorded_by" uuid NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."patients" ADD COLUMN "no_known_allergies_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app"."patients" ADD COLUMN "no_known_allergies_by" uuid;--> statement-breakpoint
ALTER TABLE "app"."allergy_classes" ADD CONSTRAINT "allergy_classes_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "platform"."clinics"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."diagnosis_codes" ADD CONSTRAINT "diagnosis_codes_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "platform"."clinics"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."drug_allergy_classes" ADD CONSTRAINT "dac_drug_fk" FOREIGN KEY ("clinic_id","drug_id") REFERENCES "app"."drugs"("clinic_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."drug_allergy_classes" ADD CONSTRAINT "dac_class_fk" FOREIGN KEY ("clinic_id","allergy_class_id") REFERENCES "app"."allergy_classes"("clinic_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."drug_interactions" ADD CONSTRAINT "drug_interactions_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "platform"."clinics"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."drugs" ADD CONSTRAINT "drugs_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "platform"."clinics"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."lab_tests" ADD CONSTRAINT "lab_tests_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "platform"."clinics"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."prescribing_presets" ADD CONSTRAINT "prescribing_presets_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "platform"."clinics"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."vital_ranges" ADD CONSTRAINT "vital_ranges_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "platform"."clinics"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."allergies" ADD CONSTRAINT "allergies_patient_fk" FOREIGN KEY ("clinic_id","patient_id") REFERENCES "app"."patients"("clinic_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."allergies" ADD CONSTRAINT "allergies_class_fk" FOREIGN KEY ("clinic_id","allergy_class_id") REFERENCES "app"."allergy_classes"("clinic_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."allergy_history" ADD CONSTRAINT "allergy_history_allergy_fk" FOREIGN KEY ("clinic_id","allergy_id") REFERENCES "app"."allergies"("clinic_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."diagnoses" ADD CONSTRAINT "diagnoses_encounter_fk" FOREIGN KEY ("clinic_id","encounter_id") REFERENCES "app"."encounters"("clinic_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."encounter_amendments" ADD CONSTRAINT "amendments_encounter_fk" FOREIGN KEY ("clinic_id","encounter_id") REFERENCES "app"."encounters"("clinic_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."encounters" ADD CONSTRAINT "encounters_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "platform"."clinics"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."encounters" ADD CONSTRAINT "encounters_visit_fk" FOREIGN KEY ("clinic_id","visit_id") REFERENCES "app"."visits"("clinic_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."encounters" ADD CONSTRAINT "encounters_patient_fk" FOREIGN KEY ("clinic_id","patient_id") REFERENCES "app"."patients"("clinic_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."encounters" ADD CONSTRAINT "encounters_doctor_fk" FOREIGN KEY ("clinic_id","doctor_id") REFERENCES "app"."users"("clinic_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."lab_orders" ADD CONSTRAINT "lab_orders_encounter_fk" FOREIGN KEY ("clinic_id","encounter_id") REFERENCES "app"."encounters"("clinic_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."lab_orders" ADD CONSTRAINT "lab_orders_test_fk" FOREIGN KEY ("clinic_id","test_id") REFERENCES "app"."lab_tests"("clinic_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."prescription_items" ADD CONSTRAINT "prescription_items_prescription_fk" FOREIGN KEY ("clinic_id","prescription_id") REFERENCES "app"."prescriptions"("clinic_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."prescriptions" ADD CONSTRAINT "prescriptions_encounter_fk" FOREIGN KEY ("clinic_id","encounter_id") REFERENCES "app"."encounters"("clinic_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."private_notes" ADD CONSTRAINT "private_notes_encounter_fk" FOREIGN KEY ("clinic_id","encounter_id") REFERENCES "app"."encounters"("clinic_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."vitals" ADD CONSTRAINT "vitals_encounter_fk" FOREIGN KEY ("clinic_id","encounter_id") REFERENCES "app"."encounters"("clinic_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "allergy_classes_clinic_starter_idx" ON "app"."allergy_classes" USING btree ("clinic_id","starter_key");--> statement-breakpoint
CREATE UNIQUE INDEX "diagnosis_codes_clinic_code_idx" ON "app"."diagnosis_codes" USING btree ("clinic_id",upper("code"));--> statement-breakpoint
CREATE UNIQUE INDEX "diagnosis_codes_clinic_starter_idx" ON "app"."diagnosis_codes" USING btree ("clinic_id","starter_key");--> statement-breakpoint
CREATE UNIQUE INDEX "drug_interactions_clinic_starter_idx" ON "app"."drug_interactions" USING btree ("clinic_id","starter_key");--> statement-breakpoint
CREATE UNIQUE INDEX "drugs_clinic_starter_idx" ON "app"."drugs" USING btree ("clinic_id","starter_key");--> statement-breakpoint
CREATE UNIQUE INDEX "lab_tests_clinic_starter_idx" ON "app"."lab_tests" USING btree ("clinic_id","starter_key");--> statement-breakpoint
CREATE UNIQUE INDEX "prescribing_presets_clinic_starter_idx" ON "app"."prescribing_presets" USING btree ("clinic_id","starter_key");--> statement-breakpoint
CREATE UNIQUE INDEX "vital_ranges_clinic_starter_idx" ON "app"."vital_ranges" USING btree ("clinic_id","starter_key");--> statement-breakpoint
CREATE INDEX "allergies_patient_idx" ON "app"."allergies" USING btree ("clinic_id","patient_id");--> statement-breakpoint
CREATE INDEX "diagnoses_encounter_idx" ON "app"."diagnoses" USING btree ("encounter_id");--> statement-breakpoint
CREATE UNIQUE INDEX "encounters_visit_idx" ON "app"."encounters" USING btree ("visit_id");--> statement-breakpoint
CREATE INDEX "encounters_patient_idx" ON "app"."encounters" USING btree ("clinic_id","patient_id","opened_at");--> statement-breakpoint
CREATE INDEX "lab_orders_status_idx" ON "app"."lab_orders" USING btree ("clinic_id","status","ordered_at");--> statement-breakpoint
CREATE INDEX "lab_orders_unread_idx" ON "app"."lab_orders" USING btree ("clinic_id","ordered_by","read_at");--> statement-breakpoint
CREATE INDEX "prescription_items_prescription_idx" ON "app"."prescription_items" USING btree ("prescription_id");--> statement-breakpoint
CREATE UNIQUE INDEX "prescriptions_encounter_idx" ON "app"."prescriptions" USING btree ("encounter_id");--> statement-breakpoint
CREATE UNIQUE INDEX "private_notes_author_encounter_idx" ON "app"."private_notes" USING btree ("encounter_id","author_id");--> statement-breakpoint
CREATE INDEX "vitals_patient_idx" ON "app"."vitals" USING btree ("clinic_id","patient_id","recorded_at");