CREATE TABLE "app"."idempotency_keys" (
	"clinic_id" uuid NOT NULL,
	"scope" varchar(40) NOT NULL,
	"key" varchar(64) NOT NULL,
	"fingerprint" varchar(64) NOT NULL,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_keys_clinic_id_scope_key_pk" PRIMARY KEY("clinic_id","scope","key")
);
--> statement-breakpoint
CREATE TABLE "app"."pharmacy_sale_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"sale_id" uuid NOT NULL,
	"drug_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"prescription_item_id" uuid,
	"description" varchar(300) NOT NULL,
	"batch_no" varchar(60) NOT NULL,
	"expiry_date" date NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price" numeric(12, 2) NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	CONSTRAINT "sale_items_quantity_check" CHECK ("app"."pharmacy_sale_items"."quantity" > 0),
	CONSTRAINT "sale_items_amount_check" CHECK ("app"."pharmacy_sale_items"."amount" = "app"."pharmacy_sale_items"."unit_price" * "app"."pharmacy_sale_items"."quantity")
);
--> statement-breakpoint
CREATE TABLE "app"."pharmacy_sales" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"number" varchar(30) NOT NULL,
	"patient_id" uuid,
	"prescription_id" uuid,
	"customer_name" varchar(200),
	"customer_phone" varchar(20),
	"total" numeric(12, 2) NOT NULL,
	"method" varchar(10) NOT NULL,
	"reference" varchar(100),
	"sold_by" uuid NOT NULL,
	"sold_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pharmacy_sales_clinic_id_id_key" UNIQUE("clinic_id","id"),
	CONSTRAINT "pharmacy_sales_method_check" CHECK ("app"."pharmacy_sales"."method" IN ('cash', 'upi', 'card', 'other')),
	CONSTRAINT "pharmacy_sales_total_check" CHECK ("app"."pharmacy_sales"."total" >= 0)
);
--> statement-breakpoint
CREATE TABLE "app"."prescription_queries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"prescription_id" uuid NOT NULL,
	"prescription_item_id" uuid,
	"addressed_to" uuid NOT NULL,
	"message" text NOT NULL,
	"raised_by" uuid NOT NULL,
	"raised_at" timestamp with time zone DEFAULT now() NOT NULL,
	"response" text,
	"answered_by" uuid,
	"answered_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "app"."purchase_order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"purchase_order_id" uuid NOT NULL,
	"drug_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"unit_cost" numeric(12, 2),
	"received_quantity" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "po_items_quantity_check" CHECK ("app"."purchase_order_items"."quantity" > 0 AND "app"."purchase_order_items"."received_quantity" >= 0)
);
--> statement-breakpoint
CREATE TABLE "app"."purchase_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"number" varchar(30) NOT NULL,
	"supplier_id" uuid NOT NULL,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"notes" text,
	"created_by" uuid NOT NULL,
	"submitted_at" timestamp with time zone,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" varchar(300),
	"received_by" uuid,
	"received_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_orders_clinic_id_id_key" UNIQUE("clinic_id","id"),
	CONSTRAINT "purchase_orders_status_check" CHECK ("app"."purchase_orders"."status" IN ('draft', 'submitted', 'approved', 'rejected', 'received', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "app"."stock_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"drug_id" uuid NOT NULL,
	"batch_no" varchar(60) NOT NULL,
	"expiry_date" date NOT NULL,
	"quantity" integer DEFAULT 0 NOT NULL,
	"unit_cost" numeric(12, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_batches_clinic_id_id_key" UNIQUE("clinic_id","id"),
	CONSTRAINT "stock_batches_quantity_check" CHECK ("app"."stock_batches"."quantity" >= 0)
);
--> statement-breakpoint
CREATE TABLE "app"."stock_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"drug_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"change" integer NOT NULL,
	"reason" varchar(20) NOT NULL,
	"source_type" varchar(30),
	"source_id" uuid,
	"note" varchar(300),
	"actor_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_movements_change_check" CHECK ("app"."stock_movements"."change" <> 0),
	CONSTRAINT "stock_movements_reason_check" CHECK ("app"."stock_movements"."reason" IN ('opening', 'receipt', 'sale', 'dispense', 'adjustment', 'expired', 'damaged', 'return'))
);
--> statement-breakpoint
CREATE TABLE "app"."suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"name" varchar(200) NOT NULL,
	"contact_name" varchar(120),
	"phone" varchar(30),
	"email" varchar(255),
	"tax_id" varchar(40),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "suppliers_clinic_id_id_key" UNIQUE("clinic_id","id")
);
--> statement-breakpoint
ALTER TABLE "app"."drugs" ADD COLUMN "reorder_level" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."pharmacy_sale_items" ADD CONSTRAINT "sale_items_sale_fk" FOREIGN KEY ("clinic_id","sale_id") REFERENCES "app"."pharmacy_sales"("clinic_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."pharmacy_sale_items" ADD CONSTRAINT "sale_items_batch_fk" FOREIGN KEY ("clinic_id","batch_id") REFERENCES "app"."stock_batches"("clinic_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."pharmacy_sales" ADD CONSTRAINT "pharmacy_sales_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "platform"."clinics"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."pharmacy_sales" ADD CONSTRAINT "pharmacy_sales_patient_fk" FOREIGN KEY ("clinic_id","patient_id") REFERENCES "app"."patients"("clinic_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."pharmacy_sales" ADD CONSTRAINT "pharmacy_sales_rx_fk" FOREIGN KEY ("clinic_id","prescription_id") REFERENCES "app"."prescriptions"("clinic_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."prescription_queries" ADD CONSTRAINT "rx_queries_rx_fk" FOREIGN KEY ("clinic_id","prescription_id") REFERENCES "app"."prescriptions"("clinic_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."purchase_order_items" ADD CONSTRAINT "po_items_po_fk" FOREIGN KEY ("clinic_id","purchase_order_id") REFERENCES "app"."purchase_orders"("clinic_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."purchase_order_items" ADD CONSTRAINT "po_items_drug_fk" FOREIGN KEY ("clinic_id","drug_id") REFERENCES "app"."drugs"("clinic_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."purchase_orders" ADD CONSTRAINT "purchase_orders_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "platform"."clinics"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_fk" FOREIGN KEY ("clinic_id","supplier_id") REFERENCES "app"."suppliers"("clinic_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."stock_batches" ADD CONSTRAINT "stock_batches_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "platform"."clinics"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."stock_batches" ADD CONSTRAINT "stock_batches_drug_fk" FOREIGN KEY ("clinic_id","drug_id") REFERENCES "app"."drugs"("clinic_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."stock_movements" ADD CONSTRAINT "stock_movements_batch_fk" FOREIGN KEY ("clinic_id","batch_id") REFERENCES "app"."stock_batches"("clinic_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."suppliers" ADD CONSTRAINT "suppliers_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "platform"."clinics"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sale_items_sale_idx" ON "app"."pharmacy_sale_items" USING btree ("sale_id");--> statement-breakpoint
CREATE INDEX "sale_items_rx_item_idx" ON "app"."pharmacy_sale_items" USING btree ("prescription_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pharmacy_sales_number_idx" ON "app"."pharmacy_sales" USING btree ("clinic_id","number");--> statement-breakpoint
CREATE INDEX "pharmacy_sales_sold_idx" ON "app"."pharmacy_sales" USING btree ("clinic_id","sold_at");--> statement-breakpoint
CREATE INDEX "rx_queries_open_idx" ON "app"."prescription_queries" USING btree ("clinic_id","addressed_to","answered_at");--> statement-breakpoint
CREATE UNIQUE INDEX "po_items_drug_idx" ON "app"."purchase_order_items" USING btree ("purchase_order_id","drug_id");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_orders_number_idx" ON "app"."purchase_orders" USING btree ("clinic_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_batches_drug_batch_idx" ON "app"."stock_batches" USING btree ("clinic_id","drug_id","batch_no","expiry_date");--> statement-breakpoint
CREATE INDEX "stock_batches_expiry_idx" ON "app"."stock_batches" USING btree ("clinic_id","expiry_date");--> statement-breakpoint
CREATE INDEX "stock_movements_drug_idx" ON "app"."stock_movements" USING btree ("clinic_id","drug_id","created_at");