CREATE TABLE "app"."lab_document_files" (
	"document_id" uuid PRIMARY KEY NOT NULL,
	"clinic_id" uuid NOT NULL,
	"content" "bytea" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."lab_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"file_name" varchar(200) NOT NULL,
	"content_type" varchar(40) NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone,
	"removed_by" uuid,
	"removed_reason" text,
	CONSTRAINT "lab_documents_clinic_id_id_key" UNIQUE("clinic_id","id"),
	CONSTRAINT "lab_documents_type_check" CHECK ("app"."lab_documents"."content_type" IN ('application/pdf', 'image/jpeg', 'image/png')),
	CONSTRAINT "lab_documents_size_check" CHECK ("app"."lab_documents"."size_bytes" > 0),
	CONSTRAINT "lab_documents_removed_check" CHECK (("app"."lab_documents"."removed_at" IS NULL) = ("app"."lab_documents"."removed_by" IS NULL) AND ("app"."lab_documents"."removed_at" IS NULL) = ("app"."lab_documents"."removed_reason" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "app"."lab_results" DROP CONSTRAINT "lab_results_flag_check";--> statement-breakpoint
ALTER TABLE "app"."lab_results" ALTER COLUMN "value" SET DATA TYPE varchar(500);--> statement-breakpoint
ALTER TABLE "app"."lab_document_files" ADD CONSTRAINT "lab_document_files_document_fk" FOREIGN KEY ("clinic_id","document_id") REFERENCES "app"."lab_documents"("clinic_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."lab_documents" ADD CONSTRAINT "lab_documents_order_fk" FOREIGN KEY ("clinic_id","order_id") REFERENCES "app"."lab_orders"("clinic_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."lab_documents" ADD CONSTRAINT "lab_documents_patient_fk" FOREIGN KEY ("clinic_id","patient_id") REFERENCES "app"."patients"("clinic_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lab_documents_order_idx" ON "app"."lab_documents" USING btree ("clinic_id","order_id");--> statement-breakpoint
CREATE INDEX "lab_documents_patient_idx" ON "app"."lab_documents" USING btree ("clinic_id","patient_id","uploaded_at");--> statement-breakpoint
CREATE UNIQUE INDEX "lab_documents_same_file_idx" ON "app"."lab_documents" USING btree ("order_id","sha256") WHERE "app"."lab_documents"."removed_at" IS NULL;--> statement-breakpoint
ALTER TABLE "app"."lab_results" ADD CONSTRAINT "lab_results_flag_check" CHECK ("app"."lab_results"."flag" IN ('normal', 'low', 'high', 'critical_low', 'critical_high', 'abnormal', 'critical'));