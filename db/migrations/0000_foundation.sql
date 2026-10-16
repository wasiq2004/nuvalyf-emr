CREATE SCHEMA "app";
--> statement-breakpoint
CREATE SCHEMA "platform";
--> statement-breakpoint
CREATE SCHEMA "sys";
--> statement-breakpoint
CREATE TABLE "platform"."clinics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(200) NOT NULL,
	"code" varchar(40) NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"plan_id" uuid,
	"contact_name" varchar(200),
	"contact_email" varchar(255),
	"contact_phone" varchar(50),
	"suspended_at" timestamp with time zone,
	"suspended_reason" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clinics_status_check" CHECK ("platform"."clinics"."status" IN ('active', 'suspended')),
	CONSTRAINT "clinics_code_format_check" CHECK ("platform"."clinics"."code" ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$')
);
--> statement-breakpoint
CREATE TABLE "platform"."operators" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"name" varchar(200) NOT NULL,
	"password_hash" text NOT NULL,
	"role" varchar(30) NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"must_change_password" boolean DEFAULT true NOT NULL,
	"session_version" integer DEFAULT 1 NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operators_role_check" CHECK ("platform"."operators"."role" IN ('platform_admin', 'operator')),
	CONSTRAINT "operators_status_check" CHECK ("platform"."operators"."status" IN ('active', 'disabled'))
);
--> statement-breakpoint
CREATE TABLE "platform"."plan_modules" (
	"plan_id" uuid NOT NULL,
	"module" varchar(50) NOT NULL,
	CONSTRAINT "plan_modules_plan_id_module_pk" PRIMARY KEY("plan_id","module")
);
--> statement-breakpoint
CREATE TABLE "platform"."plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform"."audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operator_id" uuid,
	"action" varchar(100) NOT NULL,
	"target_type" varchar(50),
	"target_id" varchar(100),
	"outcome" varchar(20) DEFAULT 'success' NOT NULL,
	"details" jsonb,
	"ip_address" varchar(45),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_audit_outcome_check" CHECK ("platform"."audit_events"."outcome" IN ('success', 'denied', 'error'))
);
--> statement-breakpoint
CREATE TABLE "app"."role_permissions" (
	"clinic_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"permission" varchar(60) NOT NULL,
	CONSTRAINT "role_permissions_role_id_permission_pk" PRIMARY KEY("role_id","permission")
);
--> statement-breakpoint
CREATE TABLE "app"."roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"key" varchar(50) NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" text,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "roles_clinic_id_id_key" UNIQUE("clinic_id","id")
);
--> statement-breakpoint
CREATE TABLE "app"."user_roles" (
	"clinic_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_roles_user_id_role_id_pk" PRIMARY KEY("user_id","role_id")
);
--> statement-breakpoint
CREATE TABLE "app"."users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"email" varchar(255) NOT NULL,
	"password_hash" text NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"must_change_password" boolean DEFAULT true NOT NULL,
	"session_version" integer DEFAULT 1 NOT NULL,
	"first_name" varchar(100) NOT NULL,
	"last_name" varchar(100) NOT NULL,
	"phone" varchar(50),
	"title" varchar(20),
	"specialty" varchar(150),
	"registration_number" varchar(100),
	"registration_council" varchar(150),
	"last_login_at" timestamp with time zone,
	"password_changed_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_clinic_id_id_key" UNIQUE("clinic_id","id"),
	CONSTRAINT "users_status_check" CHECK ("app"."users"."status" IN ('active', 'disabled'))
);
--> statement-breakpoint
CREATE TABLE "app"."clinic_settings" (
	"clinic_id" uuid PRIMARY KEY NOT NULL,
	"display_name" varchar(200) NOT NULL,
	"address_line" text,
	"city" varchar(100),
	"phone" varchar(50),
	"email" varchar(255),
	"website" varchar(255),
	"timezone" varchar(64) DEFAULT 'Asia/Kolkata' NOT NULL,
	"letterhead_text" text,
	"footer_text" text,
	"slot_minutes" integer DEFAULT 15 NOT NULL,
	"doctors_can_admit_emergency" boolean DEFAULT true NOT NULL,
	"currency" varchar(3) DEFAULT 'INR' NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"action" varchar(100) NOT NULL,
	"target_type" varchar(50),
	"target_id" varchar(100),
	"patient_id" uuid,
	"outcome" varchar(20) DEFAULT 'success' NOT NULL,
	"severity" varchar(20) DEFAULT 'info' NOT NULL,
	"details" jsonb,
	"ip_address" varchar(45),
	"user_agent" varchar(300),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_outcome_check" CHECK ("app"."audit_events"."outcome" IN ('success', 'denied', 'error')),
	CONSTRAINT "audit_severity_check" CHECK ("app"."audit_events"."severity" IN ('info', 'warning', 'critical'))
);
--> statement-breakpoint
CREATE TABLE "sys"."rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "platform"."clinics" ADD CONSTRAINT "clinics_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "platform"."plans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."plan_modules" ADD CONSTRAINT "plan_modules_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "platform"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."role_permissions" ADD CONSTRAINT "role_permissions_role_fk" FOREIGN KEY ("clinic_id","role_id") REFERENCES "app"."roles"("clinic_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."roles" ADD CONSTRAINT "roles_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "platform"."clinics"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."user_roles" ADD CONSTRAINT "user_roles_user_fk" FOREIGN KEY ("clinic_id","user_id") REFERENCES "app"."users"("clinic_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."user_roles" ADD CONSTRAINT "user_roles_role_fk" FOREIGN KEY ("clinic_id","role_id") REFERENCES "app"."roles"("clinic_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."users" ADD CONSTRAINT "users_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "platform"."clinics"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."clinic_settings" ADD CONSTRAINT "clinic_settings_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "platform"."clinics"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."audit_events" ADD CONSTRAINT "audit_events_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "platform"."clinics"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "clinics_code_idx" ON "platform"."clinics" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "operators_email_lower_idx" ON "platform"."operators" USING btree (lower("email"));--> statement-breakpoint
CREATE UNIQUE INDEX "plans_name_lower_idx" ON "platform"."plans" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX "platform_audit_created_idx" ON "platform"."audit_events" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "roles_clinic_key_idx" ON "app"."roles" USING btree ("clinic_id","key");--> statement-breakpoint
CREATE INDEX "user_roles_role_idx" ON "app"."user_roles" USING btree ("role_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_clinic_email_idx" ON "app"."users" USING btree ("clinic_id",lower("email"));--> statement-breakpoint
CREATE INDEX "audit_clinic_time_idx" ON "app"."audit_events" USING btree ("clinic_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_clinic_patient_idx" ON "app"."audit_events" USING btree ("clinic_id","patient_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_clinic_actor_idx" ON "app"."audit_events" USING btree ("clinic_id","actor_user_id","created_at");