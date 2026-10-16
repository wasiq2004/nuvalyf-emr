CREATE TABLE "app"."doctor_services" (
	"clinic_id" uuid NOT NULL,
	"doctor_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	CONSTRAINT "doctor_services_doctor_id_service_id_pk" PRIMARY KEY("doctor_id","service_id")
);
--> statement-breakpoint
CREATE TABLE "app"."schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"doctor_id" uuid NOT NULL,
	"weekday" integer NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "schedules_weekday_check" CHECK ("app"."schedules"."weekday" BETWEEN 0 AND 6),
	CONSTRAINT "schedules_time_check" CHECK ("app"."schedules"."end_time" > "app"."schedules"."start_time")
);
--> statement-breakpoint
CREATE TABLE "app"."services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"name" varchar(150) NOT NULL,
	"description" text,
	"duration_minutes" integer NOT NULL,
	"price" numeric(10, 2) DEFAULT '0' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "services_clinic_id_id_key" UNIQUE("clinic_id","id"),
	CONSTRAINT "services_duration_check" CHECK ("app"."services"."duration_minutes" BETWEEN 5 AND 480),
	CONSTRAINT "services_price_check" CHECK ("app"."services"."price" >= 0)
);
--> statement-breakpoint
ALTER TABLE "app"."doctor_services" ADD CONSTRAINT "doctor_services_doctor_fk" FOREIGN KEY ("clinic_id","doctor_id") REFERENCES "app"."users"("clinic_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."doctor_services" ADD CONSTRAINT "doctor_services_service_fk" FOREIGN KEY ("clinic_id","service_id") REFERENCES "app"."services"("clinic_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."schedules" ADD CONSTRAINT "schedules_doctor_fk" FOREIGN KEY ("clinic_id","doctor_id") REFERENCES "app"."users"("clinic_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."services" ADD CONSTRAINT "services_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "platform"."clinics"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "schedules_doctor_idx" ON "app"."schedules" USING btree ("clinic_id","doctor_id","weekday");--> statement-breakpoint
CREATE UNIQUE INDEX "services_clinic_name_idx" ON "app"."services" USING btree ("clinic_id",lower("name"));