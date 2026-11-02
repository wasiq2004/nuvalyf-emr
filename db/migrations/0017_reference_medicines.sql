CREATE SCHEMA "ref";
--> statement-breakpoint
CREATE TABLE "ref"."datasets" (
	"name" varchar(60) PRIMARY KEY NOT NULL,
	"version" varchar(40) NOT NULL,
	"rows" integer NOT NULL,
	"loaded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ref"."medicines" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_id" integer NOT NULL,
	"name" varchar(160) NOT NULL,
	"normalized" varchar(160) NOT NULL,
	"manufacturer" varchar(120),
	"composition" varchar(300),
	"generic_name" varchar(200) NOT NULL,
	"strength" varchar(60),
	"form" varchar(30) NOT NULL,
	"pack_label" varchar(100) NOT NULL,
	"pack_size" integer NOT NULL,
	"mrp" numeric(10, 2),
	"discontinued" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."drugs" ADD COLUMN "reference_id" integer;--> statement-breakpoint
CREATE UNIQUE INDEX "ref_medicines_source_idx" ON "ref"."medicines" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "ref_medicines_name_trgm_idx" ON "ref"."medicines" USING gin ("normalized" gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "drugs_clinic_reference_idx" ON "app"."drugs" USING btree ("clinic_id","reference_id");