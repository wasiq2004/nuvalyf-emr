CREATE TABLE "app"."pharmacy_customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"name" varchar(200) NOT NULL,
	"phone" varchar(20),
	"address" varchar(300),
	"gstin" varchar(15),
	"state_code" varchar(2),
	"patient_id" uuid,
	"credit_limit" numeric(12, 2),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pharmacy_customers_clinic_id_id_key" UNIQUE("clinic_id","id")
);
--> statement-breakpoint
CREATE TABLE "app"."customer_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"number" varchar(30) NOT NULL,
	"customer_id" uuid NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"method" varchar(10) NOT NULL,
	"reference" varchar(100),
	"note" varchar(300),
	"received_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_receipts_amount_check" CHECK ("app"."customer_receipts"."amount" > 0),
	CONSTRAINT "customer_receipts_method_check" CHECK ("app"."customer_receipts"."method" IN ('cash', 'upi', 'card', 'bank', 'cheque', 'other'))
);
--> statement-breakpoint
CREATE TABLE "app"."pharmacy_settings" (
	"clinic_id" uuid PRIMARY KEY NOT NULL,
	"gstin" varchar(15),
	"state_code" varchar(2),
	"gst_scheme" varchar(15) DEFAULT 'regular' NOT NULL,
	"drug_licence_20b" varchar(60),
	"drug_licence_21b" varchar(60),
	"round_off" boolean DEFAULT true NOT NULL,
	"max_discount_percent" numeric(5, 2) DEFAULT '10' NOT NULL,
	"default_hsn" varchar(8) DEFAULT '3004' NOT NULL,
	"default_gst_rate" numeric(5, 2) DEFAULT '5' NOT NULL,
	"reorder_lead_days" integer DEFAULT 7 NOT NULL,
	"reorder_cover_days" integer DEFAULT 15 NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pharmacy_settings_scheme_check" CHECK ("app"."pharmacy_settings"."gst_scheme" IN ('regular', 'composition', 'unregistered')),
	CONSTRAINT "pharmacy_settings_discount_check" CHECK ("app"."pharmacy_settings"."max_discount_percent" BETWEEN 0 AND 100),
	CONSTRAINT "pharmacy_settings_gst_check" CHECK ("app"."pharmacy_settings"."default_gst_rate" BETWEEN 0 AND 40),
	CONSTRAINT "pharmacy_settings_reorder_check" CHECK ("app"."pharmacy_settings"."reorder_lead_days" BETWEEN 0 AND 120 AND "app"."pharmacy_settings"."reorder_cover_days" BETWEEN 1 AND 180)
);
--> statement-breakpoint
CREATE TABLE "app"."purchase_return_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"return_id" uuid NOT NULL,
	"drug_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"bill_item_id" uuid,
	"quantity" integer NOT NULL,
	"unit_cost" numeric(12, 2) NOT NULL,
	"gst_rate" numeric(5, 2) DEFAULT '0' NOT NULL,
	"taxable" numeric(12, 2) NOT NULL,
	"tax" numeric(12, 2) NOT NULL,
	CONSTRAINT "purchase_return_items_quantity_check" CHECK ("app"."purchase_return_items"."quantity" > 0),
	CONSTRAINT "purchase_return_items_amount_check" CHECK ("app"."purchase_return_items"."taxable" = "app"."purchase_return_items"."unit_cost" * "app"."purchase_return_items"."quantity" AND "app"."purchase_return_items"."tax" >= 0)
);
--> statement-breakpoint
CREATE TABLE "app"."purchase_returns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"number" varchar(30) NOT NULL,
	"fiscal_year" varchar(7) NOT NULL,
	"supplier_id" uuid NOT NULL,
	"bill_id" uuid,
	"reason" varchar(300) NOT NULL,
	"taxable" numeric(12, 2) NOT NULL,
	"tax_total" numeric(12, 2) NOT NULL,
	"total" numeric(12, 2) NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_returns_clinic_id_id_key" UNIQUE("clinic_id","id"),
	CONSTRAINT "purchase_returns_total_check" CHECK ("app"."purchase_returns"."total" = "app"."purchase_returns"."taxable" + "app"."purchase_returns"."tax_total" AND "app"."purchase_returns"."taxable" >= 0 AND "app"."purchase_returns"."tax_total" >= 0)
);
--> statement-breakpoint
CREATE TABLE "app"."sale_return_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"return_id" uuid NOT NULL,
	"sale_item_id" uuid NOT NULL,
	"drug_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"net" numeric(12, 2) NOT NULL,
	"taxable" numeric(12, 2) NOT NULL,
	"cgst" numeric(12, 2) DEFAULT '0' NOT NULL,
	"sgst" numeric(12, 2) DEFAULT '0' NOT NULL,
	"igst" numeric(12, 2) DEFAULT '0' NOT NULL,
	CONSTRAINT "sale_return_items_quantity_check" CHECK ("app"."sale_return_items"."quantity" > 0),
	CONSTRAINT "sale_return_items_tax_check" CHECK ("app"."sale_return_items"."net" = "app"."sale_return_items"."taxable" + "app"."sale_return_items"."cgst" + "app"."sale_return_items"."sgst" + "app"."sale_return_items"."igst")
);
--> statement-breakpoint
CREATE TABLE "app"."sale_returns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"number" varchar(30) NOT NULL,
	"fiscal_year" varchar(7) NOT NULL,
	"sale_id" uuid NOT NULL,
	"kind" varchar(15) NOT NULL,
	"reason" varchar(300) NOT NULL,
	"refund_method" varchar(10) NOT NULL,
	"total" numeric(12, 2) NOT NULL,
	"round_off" numeric(12, 2) DEFAULT '0' NOT NULL,
	"tax_total" numeric(12, 2) NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sale_returns_clinic_id_id_key" UNIQUE("clinic_id","id"),
	CONSTRAINT "sale_returns_kind_check" CHECK ("app"."sale_returns"."kind" IN ('return', 'cancellation')),
	CONSTRAINT "sale_returns_method_check" CHECK ("app"."sale_returns"."refund_method" IN ('cash', 'upi', 'card', 'other', 'account')),
	CONSTRAINT "sale_returns_total_check" CHECK ("app"."sale_returns"."total" >= 0 AND "app"."sale_returns"."tax_total" >= 0)
);
--> statement-breakpoint
CREATE TABLE "app"."supplier_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"number" varchar(30) NOT NULL,
	"supplier_id" uuid NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"method" varchar(10) NOT NULL,
	"reference" varchar(100),
	"note" varchar(300),
	"paid_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_payments_amount_check" CHECK ("app"."supplier_payments"."amount" > 0),
	CONSTRAINT "supplier_payments_method_check" CHECK ("app"."supplier_payments"."method" IN ('cash', 'upi', 'card', 'bank', 'cheque', 'other'))
);
--> statement-breakpoint
ALTER TABLE "app"."pharmacy_sales" DROP CONSTRAINT "pharmacy_sales_method_check";--> statement-breakpoint
ALTER TABLE "app"."pharmacy_sales" DROP CONSTRAINT "pharmacy_sales_total_check";--> statement-breakpoint
ALTER TABLE "app"."stock_movements" DROP CONSTRAINT "stock_movements_reason_check";--> statement-breakpoint
ALTER TABLE "app"."drugs" ADD COLUMN "hsn" varchar(8);--> statement-breakpoint
ALTER TABLE "app"."drugs" ADD COLUMN "gst_rate" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "app"."drugs" ADD COLUMN "schedule" varchar(5) DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."drugs" ADD COLUMN "rack" varchar(40);--> statement-breakpoint
ALTER TABLE "app"."drugs" ADD COLUMN "barcode" varchar(64);--> statement-breakpoint
ALTER TABLE "app"."pharmacy_sale_items" ADD COLUMN "discount" numeric(12, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."pharmacy_sale_items" ADD COLUMN "net" numeric(12, 2) GENERATED ALWAYS AS (amount - discount) STORED;--> statement-breakpoint
ALTER TABLE "app"."pharmacy_sale_items" ADD COLUMN "hsn" varchar(8);--> statement-breakpoint
ALTER TABLE "app"."pharmacy_sale_items" ADD COLUMN "gst_rate" numeric(5, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."pharmacy_sale_items" ADD COLUMN "taxable" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "app"."pharmacy_sale_items" ADD COLUMN "cgst" numeric(12, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."pharmacy_sale_items" ADD COLUMN "sgst" numeric(12, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."pharmacy_sale_items" ADD COLUMN "igst" numeric(12, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."pharmacy_sale_items" ADD COLUMN "schedule" varchar(5) DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."pharmacy_sale_items" ADD COLUMN "unit_cost" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "app"."pharmacy_sales" ADD COLUMN "customer_id" uuid;--> statement-breakpoint
ALTER TABLE "app"."pharmacy_sales" ADD COLUMN "customer_gstin" varchar(15);--> statement-breakpoint
ALTER TABLE "app"."pharmacy_sales" ADD COLUMN "fiscal_year" varchar(7);--> statement-breakpoint
ALTER TABLE "app"."pharmacy_sales" ADD COLUMN "document_type" varchar(20) DEFAULT 'cash_memo' NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."pharmacy_sales" ADD COLUMN "inter_state" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."pharmacy_sales" ADD COLUMN "discount" numeric(12, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."pharmacy_sales" ADD COLUMN "round_off" numeric(12, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."pharmacy_sales" ADD COLUMN "tax_total" numeric(12, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."pharmacy_sales" ADD COLUMN "prescriber_name" varchar(120);--> statement-breakpoint
ALTER TABLE "app"."pharmacy_sales" ADD COLUMN "prescriber_reg_no" varchar(60);--> statement-breakpoint
ALTER TABLE "app"."pharmacy_sales" ADD COLUMN "patient_address" varchar(300);--> statement-breakpoint
ALTER TABLE "app"."pharmacy_customers" ADD CONSTRAINT "pharmacy_customers_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "platform"."clinics"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."pharmacy_customers" ADD CONSTRAINT "pharmacy_customers_patient_fk" FOREIGN KEY ("clinic_id","patient_id") REFERENCES "app"."patients"("clinic_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."customer_receipts" ADD CONSTRAINT "customer_receipts_customer_fk" FOREIGN KEY ("clinic_id","customer_id") REFERENCES "app"."pharmacy_customers"("clinic_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."pharmacy_settings" ADD CONSTRAINT "pharmacy_settings_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "platform"."clinics"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."purchase_return_items" ADD CONSTRAINT "purchase_return_items_return_fk" FOREIGN KEY ("clinic_id","return_id") REFERENCES "app"."purchase_returns"("clinic_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."purchase_return_items" ADD CONSTRAINT "purchase_return_items_batch_fk" FOREIGN KEY ("clinic_id","batch_id") REFERENCES "app"."stock_batches"("clinic_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."purchase_return_items" ADD CONSTRAINT "purchase_return_items_drug_fk" FOREIGN KEY ("clinic_id","drug_id") REFERENCES "app"."drugs"("clinic_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."purchase_returns" ADD CONSTRAINT "purchase_returns_supplier_fk" FOREIGN KEY ("clinic_id","supplier_id") REFERENCES "app"."suppliers"("clinic_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."purchase_returns" ADD CONSTRAINT "purchase_returns_bill_fk" FOREIGN KEY ("clinic_id","bill_id") REFERENCES "app"."purchase_bills"("clinic_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."sale_return_items" ADD CONSTRAINT "sale_return_items_return_fk" FOREIGN KEY ("clinic_id","return_id") REFERENCES "app"."sale_returns"("clinic_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."sale_return_items" ADD CONSTRAINT "sale_return_items_batch_fk" FOREIGN KEY ("clinic_id","batch_id") REFERENCES "app"."stock_batches"("clinic_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."sale_returns" ADD CONSTRAINT "sale_returns_sale_fk" FOREIGN KEY ("clinic_id","sale_id") REFERENCES "app"."pharmacy_sales"("clinic_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."supplier_payments" ADD CONSTRAINT "supplier_payments_supplier_fk" FOREIGN KEY ("clinic_id","supplier_id") REFERENCES "app"."suppliers"("clinic_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pharmacy_customers_patient_idx" ON "app"."pharmacy_customers" USING btree ("clinic_id","patient_id");--> statement-breakpoint
CREATE INDEX "pharmacy_customers_name_idx" ON "app"."pharmacy_customers" USING btree ("clinic_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_receipts_number_idx" ON "app"."customer_receipts" USING btree ("clinic_id","number");--> statement-breakpoint
CREATE INDEX "customer_receipts_customer_idx" ON "app"."customer_receipts" USING btree ("clinic_id","customer_id");--> statement-breakpoint
CREATE INDEX "purchase_return_items_return_idx" ON "app"."purchase_return_items" USING btree ("return_id");--> statement-breakpoint
CREATE INDEX "purchase_return_items_bill_item_idx" ON "app"."purchase_return_items" USING btree ("bill_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_returns_number_idx" ON "app"."purchase_returns" USING btree ("clinic_id","number");--> statement-breakpoint
CREATE INDEX "purchase_returns_supplier_idx" ON "app"."purchase_returns" USING btree ("clinic_id","supplier_id");--> statement-breakpoint
CREATE INDEX "sale_return_items_return_idx" ON "app"."sale_return_items" USING btree ("return_id");--> statement-breakpoint
CREATE INDEX "sale_return_items_sale_item_idx" ON "app"."sale_return_items" USING btree ("sale_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sale_returns_number_idx" ON "app"."sale_returns" USING btree ("clinic_id","number");--> statement-breakpoint
CREATE INDEX "sale_returns_sale_idx" ON "app"."sale_returns" USING btree ("sale_id");--> statement-breakpoint
CREATE INDEX "sale_returns_created_idx" ON "app"."sale_returns" USING btree ("clinic_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_payments_number_idx" ON "app"."supplier_payments" USING btree ("clinic_id","number");--> statement-breakpoint
CREATE INDEX "supplier_payments_supplier_idx" ON "app"."supplier_payments" USING btree ("clinic_id","supplier_id");--> statement-breakpoint
ALTER TABLE "app"."pharmacy_sales" ADD CONSTRAINT "pharmacy_sales_customer_fk" FOREIGN KEY ("clinic_id","customer_id") REFERENCES "app"."pharmacy_customers"("clinic_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "drugs_clinic_barcode_idx" ON "app"."drugs" USING btree ("clinic_id","barcode");--> statement-breakpoint
CREATE INDEX "pharmacy_sales_customer_idx" ON "app"."pharmacy_sales" USING btree ("clinic_id","customer_id");--> statement-breakpoint
ALTER TABLE "app"."drugs" ADD CONSTRAINT "drugs_schedule_check" CHECK ("app"."drugs"."schedule" IN ('none', 'G', 'H', 'H1', 'X'));--> statement-breakpoint
ALTER TABLE "app"."drugs" ADD CONSTRAINT "drugs_gst_rate_check" CHECK ("app"."drugs"."gst_rate" IS NULL OR "app"."drugs"."gst_rate" BETWEEN 0 AND 40);--> statement-breakpoint
ALTER TABLE "app"."pharmacy_sale_items" ADD CONSTRAINT "sale_items_discount_check" CHECK ("app"."pharmacy_sale_items"."discount" >= 0 AND "app"."pharmacy_sale_items"."discount" <= "app"."pharmacy_sale_items"."amount");--> statement-breakpoint
ALTER TABLE "app"."pharmacy_sale_items" ADD CONSTRAINT "sale_items_tax_check" CHECK ("app"."pharmacy_sale_items"."taxable" IS NULL OR ("app"."pharmacy_sale_items"."taxable" >= 0 AND "app"."pharmacy_sale_items"."taxable" + "app"."pharmacy_sale_items"."cgst" + "app"."pharmacy_sale_items"."sgst" + "app"."pharmacy_sale_items"."igst" = "app"."pharmacy_sale_items"."amount" - "app"."pharmacy_sale_items"."discount"));--> statement-breakpoint
ALTER TABLE "app"."pharmacy_sales" ADD CONSTRAINT "pharmacy_sales_document_check" CHECK ("app"."pharmacy_sales"."document_type" IN ('tax_invoice', 'bill_of_supply', 'cash_memo'));--> statement-breakpoint
ALTER TABLE "app"."pharmacy_sales" ADD CONSTRAINT "pharmacy_sales_credit_check" CHECK ("app"."pharmacy_sales"."method" <> 'credit' OR "app"."pharmacy_sales"."customer_id" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "app"."pharmacy_sales" ADD CONSTRAINT "pharmacy_sales_method_check" CHECK ("app"."pharmacy_sales"."method" IN ('cash', 'upi', 'card', 'other', 'credit'));--> statement-breakpoint
ALTER TABLE "app"."pharmacy_sales" ADD CONSTRAINT "pharmacy_sales_total_check" CHECK ("app"."pharmacy_sales"."total" >= 0 AND "app"."pharmacy_sales"."discount" >= 0 AND "app"."pharmacy_sales"."tax_total" >= 0 AND "app"."pharmacy_sales"."round_off" > -1 AND "app"."pharmacy_sales"."round_off" < 1);--> statement-breakpoint
ALTER TABLE "app"."stock_movements" ADD CONSTRAINT "stock_movements_reason_check" CHECK ("app"."stock_movements"."reason" IN ('opening', 'receipt', 'sale', 'dispense', 'adjustment', 'expired', 'damaged', 'return', 'supplier_return'));