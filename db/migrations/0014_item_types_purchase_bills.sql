CREATE TABLE "app"."drug_aliases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"drug_id" uuid NOT NULL,
	"alias" varchar(200) NOT NULL,
	"normalized" varchar(200) NOT NULL,
	"manufacturer" varchar(120),
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."purchase_bill_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"bill_id" uuid NOT NULL,
	"drug_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"description" varchar(200) NOT NULL,
	"batch_no" varchar(60) NOT NULL,
	"expiry_date" date NOT NULL,
	"quantity" integer NOT NULL,
	"free_quantity" integer DEFAULT 0 NOT NULL,
	"pack_size" integer NOT NULL,
	"rate" numeric(12, 2) NOT NULL,
	"mrp" numeric(12, 2),
	"gst_rate" numeric(5, 2) DEFAULT '0' NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"tax_amount" numeric(12, 2) NOT NULL,
	"units" integer NOT NULL,
	CONSTRAINT "bill_items_quantity_check" CHECK ("app"."purchase_bill_items"."quantity" > 0 AND "app"."purchase_bill_items"."free_quantity" >= 0 AND "app"."purchase_bill_items"."pack_size" > 0),
	CONSTRAINT "bill_items_units_check" CHECK ("app"."purchase_bill_items"."units" = ("app"."purchase_bill_items"."quantity" + "app"."purchase_bill_items"."free_quantity") * "app"."purchase_bill_items"."pack_size"),
	CONSTRAINT "bill_items_amount_check" CHECK ("app"."purchase_bill_items"."amount" = "app"."purchase_bill_items"."rate" * "app"."purchase_bill_items"."quantity" AND "app"."purchase_bill_items"."tax_amount" >= 0),
	CONSTRAINT "bill_items_gst_check" CHECK ("app"."purchase_bill_items"."gst_rate" >= 0 AND "app"."purchase_bill_items"."gst_rate" <= 100)
);
--> statement-breakpoint
CREATE TABLE "app"."purchase_bills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"number" varchar(30) NOT NULL,
	"supplier_id" uuid NOT NULL,
	"bill_no" varchar(60) NOT NULL,
	"bill_date" date NOT NULL,
	"subtotal" numeric(12, 2) NOT NULL,
	"tax_total" numeric(12, 2) NOT NULL,
	"total" numeric(12, 2) NOT NULL,
	"notes" varchar(500),
	"entered_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_bills_clinic_id_id_key" UNIQUE("clinic_id","id"),
	CONSTRAINT "purchase_bills_total_check" CHECK ("app"."purchase_bills"."total" = "app"."purchase_bills"."subtotal" + "app"."purchase_bills"."tax_total" AND "app"."purchase_bills"."subtotal" >= 0 AND "app"."purchase_bills"."tax_total" >= 0)
);
--> statement-breakpoint
ALTER TABLE "app"."drugs" ADD COLUMN "item_type" varchar(20) DEFAULT 'medicine' NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."drugs" ADD COLUMN "manufacturer" varchar(120);--> statement-breakpoint
ALTER TABLE "app"."drugs" ADD COLUMN "pack_size" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."import_jobs" ADD COLUMN "kind" varchar(20) DEFAULT 'patients' NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."drug_aliases" ADD CONSTRAINT "drug_aliases_drug_fk" FOREIGN KEY ("clinic_id","drug_id") REFERENCES "app"."drugs"("clinic_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."purchase_bill_items" ADD CONSTRAINT "bill_items_bill_fk" FOREIGN KEY ("clinic_id","bill_id") REFERENCES "app"."purchase_bills"("clinic_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."purchase_bill_items" ADD CONSTRAINT "bill_items_drug_fk" FOREIGN KEY ("clinic_id","drug_id") REFERENCES "app"."drugs"("clinic_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."purchase_bill_items" ADD CONSTRAINT "bill_items_batch_fk" FOREIGN KEY ("clinic_id","batch_id") REFERENCES "app"."stock_batches"("clinic_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."purchase_bills" ADD CONSTRAINT "purchase_bills_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "platform"."clinics"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."purchase_bills" ADD CONSTRAINT "purchase_bills_supplier_fk" FOREIGN KEY ("clinic_id","supplier_id") REFERENCES "app"."suppliers"("clinic_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "drug_aliases_normalized_idx" ON "app"."drug_aliases" USING btree ("clinic_id","normalized");--> statement-breakpoint
CREATE INDEX "drug_aliases_drug_idx" ON "app"."drug_aliases" USING btree ("clinic_id","drug_id");--> statement-breakpoint
CREATE INDEX "bill_items_bill_idx" ON "app"."purchase_bill_items" USING btree ("bill_id");--> statement-breakpoint
CREATE INDEX "bill_items_drug_idx" ON "app"."purchase_bill_items" USING btree ("clinic_id","drug_id");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_bills_number_idx" ON "app"."purchase_bills" USING btree ("clinic_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_bills_supplier_bill_idx" ON "app"."purchase_bills" USING btree ("clinic_id","supplier_id","bill_no");--> statement-breakpoint
CREATE INDEX "purchase_bills_date_idx" ON "app"."purchase_bills" USING btree ("clinic_id","bill_date");--> statement-breakpoint
ALTER TABLE "app"."drugs" ADD CONSTRAINT "drugs_item_type_check" CHECK ("app"."drugs"."item_type" IN ('medicine', 'consumable', 'instrument'));--> statement-breakpoint
ALTER TABLE "app"."drugs" ADD CONSTRAINT "drugs_pack_size_check" CHECK ("app"."drugs"."pack_size" BETWEEN 1 AND 10000);--> statement-breakpoint
ALTER TABLE "app"."import_jobs" ADD CONSTRAINT "import_jobs_kind_check" CHECK ("app"."import_jobs"."kind" IN ('patients', 'stock'));