CREATE TABLE "app"."broadcasts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"title" varchar(200) NOT NULL,
	"audience" jsonb NOT NULL,
	"recipients" integer DEFAULT 0 NOT NULL,
	"excluded" integer DEFAULT 0 NOT NULL,
	"status" varchar(20) DEFAULT 'queued' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "broadcasts_clinic_id_id_key" UNIQUE("clinic_id","id"),
	CONSTRAINT "broadcasts_status_check" CHECK ("app"."broadcasts"."status" IN ('queued', 'sent', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "app"."consent_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"type" varchar(30) NOT NULL,
	"granted" boolean NOT NULL,
	"source" varchar(20) NOT NULL,
	"note" varchar(300),
	"recorded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "consent_events_type_check" CHECK ("app"."consent_events"."type" IN ('whatsapp_reminders', 'whatsapp_broadcasts')),
	CONSTRAINT "consent_events_source_check" CHECK ("app"."consent_events"."source" IN ('front_desk', 'import', 'patient_reply', 'portal'))
);
--> statement-breakpoint
CREATE TABLE "app"."import_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"file_name" varchar(200) NOT NULL,
	"row_count" integer NOT NULL,
	"imported" integer DEFAULT 0 NOT NULL,
	"status" varchar(20) NOT NULL,
	"errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_jobs_status_check" CHECK ("app"."import_jobs"."status" IN ('rejected', 'imported'))
);
--> statement-breakpoint
CREATE TABLE "app"."message_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"kind" varchar(20) NOT NULL,
	"appointment_id" uuid,
	"broadcast_id" uuid,
	"to_phone" varchar(20) NOT NULL,
	"template" varchar(100) NOT NULL,
	"language" varchar(10) NOT NULL,
	"params" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" varchar(20) DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"provider_message_id" varchar(120),
	"error" varchar(500),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "message_log_kind_check" CHECK ("app"."message_log"."kind" IN ('reminder', 'broadcast', 'test')),
	CONSTRAINT "message_log_status_check" CHECK ("app"."message_log"."status" IN ('queued', 'sent', 'failed', 'skipped'))
);
--> statement-breakpoint
CREATE TABLE "app"."message_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"language" varchar(10) DEFAULT 'en' NOT NULL,
	"category" varchar(20) DEFAULT 'marketing' NOT NULL,
	"preview" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_templates_clinic_id_id_key" UNIQUE("clinic_id","id"),
	CONSTRAINT "message_templates_category_check" CHECK ("app"."message_templates"."category" IN ('utility', 'marketing'))
);
--> statement-breakpoint
CREATE TABLE "app"."whatsapp_config" (
	"clinic_id" uuid PRIMARY KEY NOT NULL,
	"phone_number_id" varchar(40),
	"business_account_id" varchar(40),
	"display_phone" varchar(30),
	"access_token_encrypted" text,
	"enabled" boolean DEFAULT false NOT NULL,
	"reminders_enabled" boolean DEFAULT false NOT NULL,
	"reminder_hours_before" integer DEFAULT 24 NOT NULL,
	"reminder_template" varchar(100) DEFAULT 'appointment_reminder' NOT NULL,
	"template_language" varchar(10) DEFAULT 'en' NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."broadcasts" ADD CONSTRAINT "broadcasts_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "platform"."clinics"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."broadcasts" ADD CONSTRAINT "broadcasts_template_fk" FOREIGN KEY ("clinic_id","template_id") REFERENCES "app"."message_templates"("clinic_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."consent_events" ADD CONSTRAINT "consent_events_patient_fk" FOREIGN KEY ("clinic_id","patient_id") REFERENCES "app"."patients"("clinic_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."import_jobs" ADD CONSTRAINT "import_jobs_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "platform"."clinics"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."message_log" ADD CONSTRAINT "message_log_patient_fk" FOREIGN KEY ("clinic_id","patient_id") REFERENCES "app"."patients"("clinic_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."message_log" ADD CONSTRAINT "message_log_appointment_fk" FOREIGN KEY ("clinic_id","appointment_id") REFERENCES "app"."appointments"("clinic_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."message_log" ADD CONSTRAINT "message_log_broadcast_fk" FOREIGN KEY ("clinic_id","broadcast_id") REFERENCES "app"."broadcasts"("clinic_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."message_templates" ADD CONSTRAINT "message_templates_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "platform"."clinics"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."whatsapp_config" ADD CONSTRAINT "whatsapp_config_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "platform"."clinics"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "consent_events_patient_idx" ON "app"."consent_events" USING btree ("clinic_id","patient_id","type","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "message_log_reminder_idx" ON "app"."message_log" USING btree ("appointment_id") WHERE "app"."message_log"."kind" = 'reminder';--> statement-breakpoint
CREATE UNIQUE INDEX "message_log_broadcast_idx" ON "app"."message_log" USING btree ("broadcast_id","patient_id") WHERE "app"."message_log"."broadcast_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "message_log_queue_idx" ON "app"."message_log" USING btree ("clinic_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "message_templates_name_idx" ON "app"."message_templates" USING btree ("clinic_id","name","language");