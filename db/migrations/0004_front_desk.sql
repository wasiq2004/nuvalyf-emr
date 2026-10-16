CREATE TABLE "app"."appointments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"doctor_id" uuid NOT NULL,
	"service_id" uuid,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"status" varchar(20) DEFAULT 'booked' NOT NULL,
	"notes" text,
	"cancel_reason" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "appointments_clinic_id_id_key" UNIQUE("clinic_id","id"),
	CONSTRAINT "appointments_status_check" CHECK ("app"."appointments"."status" IN ('booked', 'checked_in', 'completed', 'cancelled', 'no_show')),
	CONSTRAINT "appointments_range_check" CHECK ("app"."appointments"."ends_at" > "app"."appointments"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "app"."clinic_counters" (
	"clinic_id" uuid NOT NULL,
	"key" varchar(40) NOT NULL,
	"value" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "clinic_counters_clinic_id_key_pk" PRIMARY KEY("clinic_id","key")
);
--> statement-breakpoint
CREATE TABLE "app"."duplicate_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"candidate_ids" uuid[] NOT NULL,
	"reason" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."patients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"mrn" varchar(30) NOT NULL,
	"first_name" varchar(100),
	"last_name" varchar(100),
	"sex" varchar(10) DEFAULT 'unknown' NOT NULL,
	"date_of_birth" date,
	"stated_age_years" integer,
	"stated_age_on" date,
	"mobile" varchar(20),
	"alt_phone" varchar(20),
	"email" varchar(255),
	"address_line" text,
	"city" varchar(100),
	"is_placeholder" boolean DEFAULT false NOT NULL,
	"emergency_label" varchar(200),
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "patients_clinic_id_id_key" UNIQUE("clinic_id","id"),
	CONSTRAINT "patients_sex_check" CHECK ("app"."patients"."sex" IN ('male', 'female', 'other', 'unknown')),
	CONSTRAINT "patients_identity_check" CHECK ("app"."patients"."is_placeholder" OR ("app"."patients"."first_name" IS NOT NULL AND length(trim("app"."patients"."first_name")) > 0)),
	CONSTRAINT "patients_age_check" CHECK ("app"."patients"."stated_age_years" IS NULL OR ("app"."patients"."stated_age_years" BETWEEN 0 AND 130 AND "app"."patients"."stated_age_on" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "app"."tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"type" varchar(50) NOT NULL,
	"priority" varchar(10) DEFAULT 'normal' NOT NULL,
	"title" varchar(300) NOT NULL,
	"patient_id" uuid,
	"status" varchar(10) DEFAULT 'open' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_by" uuid,
	"completed_at" timestamp with time zone,
	CONSTRAINT "tasks_priority_check" CHECK ("app"."tasks"."priority" IN ('urgent', 'normal')),
	CONSTRAINT "tasks_status_check" CHECK ("app"."tasks"."status" IN ('open', 'done'))
);
--> statement-breakpoint
CREATE TABLE "app"."visits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"appointment_id" uuid,
	"doctor_id" uuid,
	"service_id" uuid,
	"visit_date" date NOT NULL,
	"status" varchar(20) DEFAULT 'waiting' NOT NULL,
	"is_emergency" boolean DEFAULT false NOT NULL,
	"companion_phone" varchar(20),
	"position" integer DEFAULT 0 NOT NULL,
	"arrived_at" timestamp with time zone DEFAULT now() NOT NULL,
	"triage_started_at" timestamp with time zone,
	"ready_at" timestamp with time zone,
	"called_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"checked_in_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "visits_clinic_id_id_key" UNIQUE("clinic_id","id"),
	CONSTRAINT "visits_status_check" CHECK ("app"."visits"."status" IN ('waiting', 'in_triage', 'ready', 'with_doctor', 'completed', 'left', 'cancelled'))
);
--> statement-breakpoint
ALTER TABLE "app"."appointments" ADD CONSTRAINT "appointments_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "platform"."clinics"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."appointments" ADD CONSTRAINT "appointments_patient_fk" FOREIGN KEY ("clinic_id","patient_id") REFERENCES "app"."patients"("clinic_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."appointments" ADD CONSTRAINT "appointments_doctor_fk" FOREIGN KEY ("clinic_id","doctor_id") REFERENCES "app"."users"("clinic_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."appointments" ADD CONSTRAINT "appointments_service_fk" FOREIGN KEY ("clinic_id","service_id") REFERENCES "app"."services"("clinic_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."clinic_counters" ADD CONSTRAINT "clinic_counters_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "platform"."clinics"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."duplicate_overrides" ADD CONSTRAINT "duplicate_overrides_patient_fk" FOREIGN KEY ("clinic_id","patient_id") REFERENCES "app"."patients"("clinic_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."patients" ADD CONSTRAINT "patients_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "platform"."clinics"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."tasks" ADD CONSTRAINT "tasks_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "platform"."clinics"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."visits" ADD CONSTRAINT "visits_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "platform"."clinics"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."visits" ADD CONSTRAINT "visits_patient_fk" FOREIGN KEY ("clinic_id","patient_id") REFERENCES "app"."patients"("clinic_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."visits" ADD CONSTRAINT "visits_appointment_fk" FOREIGN KEY ("clinic_id","appointment_id") REFERENCES "app"."appointments"("clinic_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."visits" ADD CONSTRAINT "visits_doctor_fk" FOREIGN KEY ("clinic_id","doctor_id") REFERENCES "app"."users"("clinic_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "appointments_doctor_time_idx" ON "app"."appointments" USING btree ("clinic_id","doctor_id","starts_at");--> statement-breakpoint
CREATE INDEX "appointments_patient_time_idx" ON "app"."appointments" USING btree ("clinic_id","patient_id","starts_at");--> statement-breakpoint
CREATE UNIQUE INDEX "patients_clinic_mrn_idx" ON "app"."patients" USING btree ("clinic_id","mrn");--> statement-breakpoint
CREATE INDEX "patients_clinic_mobile_idx" ON "app"."patients" USING btree ("clinic_id","mobile");--> statement-breakpoint
CREATE INDEX "tasks_open_idx" ON "app"."tasks" USING btree ("clinic_id","status","priority");--> statement-breakpoint
CREATE UNIQUE INDEX "visits_appointment_idx" ON "app"."visits" USING btree ("appointment_id");--> statement-breakpoint
CREATE INDEX "visits_queue_idx" ON "app"."visits" USING btree ("clinic_id","visit_date","status");--> statement-breakpoint
CREATE INDEX "visits_patient_idx" ON "app"."visits" USING btree ("clinic_id","patient_id");