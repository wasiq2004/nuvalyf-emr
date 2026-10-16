CREATE TABLE "app"."invoice_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"kind" varchar(20) NOT NULL,
	"description" varchar(300) NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"unit_price" numeric(12, 2) NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"source_type" varchar(30),
	"source_id" uuid,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoice_items_kind_check" CHECK ("app"."invoice_items"."kind" IN ('service', 'lab', 'medicine', 'other')),
	CONSTRAINT "invoice_items_quantity_check" CHECK ("app"."invoice_items"."quantity" > 0),
	CONSTRAINT "invoice_items_amount_check" CHECK ("app"."invoice_items"."unit_price" >= 0 AND "app"."invoice_items"."amount" = "app"."invoice_items"."unit_price" * "app"."invoice_items"."quantity")
);
--> statement-breakpoint
CREATE TABLE "app"."invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"number" varchar(30) NOT NULL,
	"patient_id" uuid NOT NULL,
	"visit_id" uuid,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"subtotal" numeric(12, 2) DEFAULT '0' NOT NULL,
	"discount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"discount_reason" varchar(300),
	"total" numeric(12, 2) DEFAULT '0' NOT NULL,
	"amount_paid" numeric(12, 2) DEFAULT '0' NOT NULL,
	"notes" text,
	"issued_at" timestamp with time zone,
	"issued_by" uuid,
	"voided_at" timestamp with time zone,
	"voided_by" uuid,
	"void_reason" varchar(300),
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_clinic_id_id_key" UNIQUE("clinic_id","id"),
	CONSTRAINT "invoices_status_check" CHECK ("app"."invoices"."status" IN ('draft', 'issued', 'void')),
	CONSTRAINT "invoices_amounts_check" CHECK ("app"."invoices"."subtotal" >= 0 AND "app"."invoices"."discount" >= 0 AND "app"."invoices"."total" >= 0 AND "app"."invoices"."discount" <= "app"."invoices"."subtotal"),
	CONSTRAINT "invoices_paid_check" CHECK ("app"."invoices"."amount_paid" >= 0 AND "app"."invoices"."amount_paid" <= "app"."invoices"."total")
);
--> statement-breakpoint
CREATE TABLE "app"."payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"kind" varchar(10) DEFAULT 'payment' NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"method" varchar(10) NOT NULL,
	"reference" varchar(100),
	"reason" varchar(300),
	"idempotency_key" varchar(64) NOT NULL,
	"received_by" uuid NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_kind_check" CHECK ("app"."payments"."kind" IN ('payment', 'refund')),
	CONSTRAINT "payments_method_check" CHECK ("app"."payments"."method" IN ('cash', 'upi', 'card', 'other')),
	CONSTRAINT "payments_amount_check" CHECK ("app"."payments"."amount" > 0),
	CONSTRAINT "payments_refund_reason_check" CHECK ("app"."payments"."kind" = 'payment' OR "app"."payments"."reason" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "app"."invoice_items" ADD CONSTRAINT "invoice_items_invoice_fk" FOREIGN KEY ("clinic_id","invoice_id") REFERENCES "app"."invoices"("clinic_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."invoices" ADD CONSTRAINT "invoices_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "platform"."clinics"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."invoices" ADD CONSTRAINT "invoices_patient_fk" FOREIGN KEY ("clinic_id","patient_id") REFERENCES "app"."patients"("clinic_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."invoices" ADD CONSTRAINT "invoices_visit_fk" FOREIGN KEY ("clinic_id","visit_id") REFERENCES "app"."visits"("clinic_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."payments" ADD CONSTRAINT "payments_invoice_fk" FOREIGN KEY ("clinic_id","invoice_id") REFERENCES "app"."invoices"("clinic_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invoice_items_invoice_idx" ON "app"."invoice_items" USING btree ("invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_clinic_number_idx" ON "app"."invoices" USING btree ("clinic_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_visit_idx" ON "app"."invoices" USING btree ("visit_id") WHERE "app"."invoices"."visit_id" IS NOT NULL AND "app"."invoices"."status" <> 'void';--> statement-breakpoint
CREATE INDEX "invoices_patient_idx" ON "app"."invoices" USING btree ("clinic_id","patient_id");--> statement-breakpoint
CREATE INDEX "invoices_status_idx" ON "app"."invoices" USING btree ("clinic_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_idempotency_idx" ON "app"."payments" USING btree ("clinic_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "payments_invoice_idx" ON "app"."payments" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "payments_received_idx" ON "app"."payments" USING btree ("clinic_id","received_at");