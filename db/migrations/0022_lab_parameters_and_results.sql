CREATE TABLE "app"."lab_parameter_ranges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"parameter_id" uuid NOT NULL,
	"sex" varchar(10) DEFAULT 'any' NOT NULL,
	"age_min_years" integer DEFAULT 0 NOT NULL,
	"age_max_years" integer,
	"low" numeric(14, 4),
	"high" numeric(14, 4),
	"critical_low" numeric(14, 4),
	"critical_high" numeric(14, 4),
	CONSTRAINT "lab_parameter_ranges_sex_check" CHECK ("app"."lab_parameter_ranges"."sex" IN ('any', 'male', 'female')),
	CONSTRAINT "lab_parameter_ranges_age_check" CHECK ("app"."lab_parameter_ranges"."age_max_years" IS NULL OR "app"."lab_parameter_ranges"."age_max_years" >= "app"."lab_parameter_ranges"."age_min_years")
);
--> statement-breakpoint
CREATE TABLE "app"."lab_test_parameters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"test_id" uuid NOT NULL,
	"starter_key" varchar(80),
	"name" varchar(120) NOT NULL,
	"section" varchar(80),
	"unit" varchar(40),
	"value_type" varchar(10) DEFAULT 'number' NOT NULL,
	"normal_text" varchar(60),
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lab_test_parameters_clinic_id_id_key" UNIQUE("clinic_id","id"),
	CONSTRAINT "lab_test_parameters_type_check" CHECK ("app"."lab_test_parameters"."value_type" IN ('number', 'text'))
);
--> statement-breakpoint
CREATE TABLE "app"."lab_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"parameter_id" uuid,
	"name" varchar(120) NOT NULL,
	"section" varchar(80),
	"unit" varchar(40),
	"sort_order" integer DEFAULT 0 NOT NULL,
	"value" varchar(200) NOT NULL,
	"value_number" numeric(14, 4),
	"flag" varchar(15) DEFAULT 'normal' NOT NULL,
	"reference_text" varchar(80),
	"ref_low" numeric(14, 4),
	"ref_high" numeric(14, 4),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lab_results_flag_check" CHECK ("app"."lab_results"."flag" IN ('normal', 'low', 'high', 'critical_low', 'critical_high', 'abnormal'))
);
--> statement-breakpoint
ALTER TABLE "app"."lab_parameter_ranges" ADD CONSTRAINT "lab_parameter_ranges_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "platform"."clinics"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."lab_parameter_ranges" ADD CONSTRAINT "lab_parameter_ranges_parameter_fk" FOREIGN KEY ("clinic_id","parameter_id") REFERENCES "app"."lab_test_parameters"("clinic_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."lab_test_parameters" ADD CONSTRAINT "lab_test_parameters_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "platform"."clinics"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."lab_test_parameters" ADD CONSTRAINT "lab_test_parameters_test_fk" FOREIGN KEY ("clinic_id","test_id") REFERENCES "app"."lab_tests"("clinic_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."lab_results" ADD CONSTRAINT "lab_results_order_fk" FOREIGN KEY ("clinic_id","order_id") REFERENCES "app"."lab_orders"("clinic_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lab_parameter_ranges_parameter_idx" ON "app"."lab_parameter_ranges" USING btree ("parameter_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lab_test_parameters_starter_idx" ON "app"."lab_test_parameters" USING btree ("clinic_id","starter_key");--> statement-breakpoint
CREATE INDEX "lab_test_parameters_test_idx" ON "app"."lab_test_parameters" USING btree ("test_id");--> statement-breakpoint
CREATE INDEX "lab_results_order_idx" ON "app"."lab_results" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "lab_results_patient_idx" ON "app"."lab_results" USING btree ("clinic_id","patient_id","parameter_id");