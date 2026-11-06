CREATE TABLE "app"."stock_count_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"count_id" uuid NOT NULL,
	"drug_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"found" boolean DEFAULT false NOT NULL,
	"first_count" integer,
	"first_system" integer,
	"first_by" uuid,
	"first_at" timestamp with time zone,
	"recount" integer,
	"recount_system" integer,
	"recount_by" uuid,
	"recount_at" timestamp with time zone,
	"reason" varchar(20),
	"note" varchar(300),
	"posted_change" integer,
	CONSTRAINT "stock_count_lines_batch_key" UNIQUE("count_id","batch_id"),
	CONSTRAINT "stock_count_lines_quantity_check" CHECK (("app"."stock_count_lines"."first_count" IS NULL OR "app"."stock_count_lines"."first_count" >= 0) AND ("app"."stock_count_lines"."recount" IS NULL OR "app"."stock_count_lines"."recount" >= 0)),
	CONSTRAINT "stock_count_lines_snapshot_check" CHECK (("app"."stock_count_lines"."first_count" IS NULL) = ("app"."stock_count_lines"."first_system" IS NULL) AND ("app"."stock_count_lines"."recount" IS NULL) = ("app"."stock_count_lines"."recount_system" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "app"."stock_counts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"number" varchar(20) NOT NULL,
	"scope" varchar(10) NOT NULL,
	"scope_label" varchar(120) NOT NULL,
	"status" varchar(10) DEFAULT 'counting' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_by" uuid,
	"submitted_at" timestamp with time zone,
	"posted_by" uuid,
	"posted_at" timestamp with time zone,
	CONSTRAINT "stock_counts_clinic_id_id_key" UNIQUE("clinic_id","id"),
	CONSTRAINT "stock_counts_scope_check" CHECK ("app"."stock_counts"."scope" IN ('all', 'rack', 'cycle')),
	CONSTRAINT "stock_counts_status_check" CHECK ("app"."stock_counts"."status" IN ('counting', 'review', 'posted', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "app"."account_openings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"customer_id" uuid,
	"supplier_id" uuid,
	"amount" numeric(12, 2) NOT NULL,
	"as_of" date NOT NULL,
	"reference" varchar(100),
	"note" varchar(300),
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_openings_party_check" CHECK (("app"."account_openings"."customer_id" IS NULL) <> ("app"."account_openings"."supplier_id" IS NULL)),
	CONSTRAINT "account_openings_amount_check" CHECK ("app"."account_openings"."amount" <> 0)
);
--> statement-breakpoint
ALTER TABLE "app"."import_jobs" DROP CONSTRAINT "import_jobs_status_check";--> statement-breakpoint
ALTER TABLE "app"."import_jobs" DROP CONSTRAINT "import_jobs_kind_check";--> statement-breakpoint
ALTER TABLE "app"."sale_return_items" ALTER COLUMN "sale_item_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."sale_returns" ALTER COLUMN "sale_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."stock_batches" ADD COLUMN "mrp" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "app"."stock_batches" ADD COLUMN "pack_size" integer;--> statement-breakpoint
ALTER TABLE "app"."stock_batches" ADD COLUMN "pack_cost" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "app"."sale_return_items" ADD COLUMN "description" varchar(300);--> statement-breakpoint
ALTER TABLE "app"."sale_return_items" ADD COLUMN "hsn" varchar(8);--> statement-breakpoint
ALTER TABLE "app"."sale_return_items" ADD COLUMN "gst_rate" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "app"."sale_return_items" ADD COLUMN "unit_cost" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "app"."sale_returns" ADD COLUMN "old_bill_no" varchar(60);--> statement-breakpoint
ALTER TABLE "app"."sale_returns" ADD COLUMN "old_bill_date" date;--> statement-breakpoint
ALTER TABLE "app"."sale_returns" ADD COLUMN "customer_id" uuid;--> statement-breakpoint
ALTER TABLE "app"."sale_returns" ADD COLUMN "customer_name" varchar(200);--> statement-breakpoint
ALTER TABLE "app"."sale_returns" ADD COLUMN "customer_gstin" varchar(15);--> statement-breakpoint
ALTER TABLE "app"."import_jobs" ADD COLUMN "summary" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."import_jobs" ADD COLUMN "reversed_note" varchar(300);--> statement-breakpoint
ALTER TABLE "app"."stock_count_lines" ADD CONSTRAINT "stock_count_lines_count_fk" FOREIGN KEY ("clinic_id","count_id") REFERENCES "app"."stock_counts"("clinic_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."stock_count_lines" ADD CONSTRAINT "stock_count_lines_batch_fk" FOREIGN KEY ("clinic_id","batch_id") REFERENCES "app"."stock_batches"("clinic_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."stock_counts" ADD CONSTRAINT "stock_counts_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "platform"."clinics"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."account_openings" ADD CONSTRAINT "account_openings_customer_fk" FOREIGN KEY ("clinic_id","customer_id") REFERENCES "app"."pharmacy_customers"("clinic_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."account_openings" ADD CONSTRAINT "account_openings_supplier_fk" FOREIGN KEY ("clinic_id","supplier_id") REFERENCES "app"."suppliers"("clinic_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stock_count_lines_drug_idx" ON "app"."stock_count_lines" USING btree ("clinic_id","drug_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_counts_number_idx" ON "app"."stock_counts" USING btree ("clinic_id","number");--> statement-breakpoint
CREATE INDEX "stock_counts_created_idx" ON "app"."stock_counts" USING btree ("clinic_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_counts_one_open_idx" ON "app"."stock_counts" USING btree ("clinic_id") WHERE status IN ('counting', 'review');--> statement-breakpoint
CREATE INDEX "account_openings_customer_idx" ON "app"."account_openings" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "account_openings_supplier_idx" ON "app"."account_openings" USING btree ("supplier_id");--> statement-breakpoint
ALTER TABLE "app"."sale_returns" ADD CONSTRAINT "sale_returns_customer_fk" FOREIGN KEY ("clinic_id","customer_id") REFERENCES "app"."pharmacy_customers"("clinic_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sale_returns_old_bill_idx" ON "app"."sale_returns" USING btree ("clinic_id","old_bill_no");--> statement-breakpoint
ALTER TABLE "app"."stock_batches" ADD CONSTRAINT "stock_batches_mrp_check" CHECK ("app"."stock_batches"."mrp" IS NULL OR "app"."stock_batches"."mrp" >= 0);--> statement-breakpoint
ALTER TABLE "app"."stock_batches" ADD CONSTRAINT "stock_batches_pack_check" CHECK ("app"."stock_batches"."pack_size" IS NULL OR "app"."stock_batches"."pack_size" >= 1);--> statement-breakpoint
ALTER TABLE "app"."sale_return_items" ADD CONSTRAINT "sale_return_items_source_check" CHECK ("app"."sale_return_items"."sale_item_id" IS NOT NULL OR "app"."sale_return_items"."gst_rate" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "app"."sale_returns" ADD CONSTRAINT "sale_returns_source_check" CHECK (("app"."sale_returns"."sale_id" IS NULL) <> ("app"."sale_returns"."old_bill_no" IS NULL));--> statement-breakpoint
ALTER TABLE "app"."import_jobs" ADD CONSTRAINT "import_jobs_status_check" CHECK ("app"."import_jobs"."status" IN ('rejected', 'imported', 'reversed'));--> statement-breakpoint
ALTER TABLE "app"."import_jobs" ADD CONSTRAINT "import_jobs_kind_check" CHECK ("app"."import_jobs"."kind" IN ('patients', 'stock', 'balances'));--> statement-breakpoint
-- Batches already received keep the MRP printed on their latest supplier bill.
UPDATE "app"."stock_batches" AS b
SET "mrp" = l."mrp", "pack_size" = l."pack_size"
FROM (
  SELECT DISTINCT ON (i."batch_id") i."batch_id", i."mrp", i."pack_size"
  FROM "app"."purchase_bill_items" i
  JOIN "app"."purchase_bills" p ON p."id" = i."bill_id"
  WHERE i."mrp" IS NOT NULL
  ORDER BY i."batch_id", p."bill_date" DESC, p."created_at" DESC
) l
WHERE l."batch_id" = b."id";
