CREATE TABLE "app"."schedule_exceptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"doctor_id" uuid NOT NULL,
	"date" date NOT NULL,
	"reason" varchar(200) NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."schedule_exceptions" ADD CONSTRAINT "schedule_exceptions_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "platform"."clinics"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."schedule_exceptions" ADD CONSTRAINT "schedule_exceptions_doctor_fk" FOREIGN KEY ("clinic_id","doctor_id") REFERENCES "app"."users"("clinic_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "schedule_exceptions_doctor_date_idx" ON "app"."schedule_exceptions" USING btree ("clinic_id","doctor_id","date");