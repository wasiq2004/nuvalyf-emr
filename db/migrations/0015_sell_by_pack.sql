ALTER TABLE "app"."pharmacy_sale_items" DROP CONSTRAINT "sale_items_amount_check";--> statement-breakpoint
ALTER TABLE "app"."drugs" ADD COLUMN "pack_price" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "app"."pharmacy_sale_items" ADD COLUMN "sold_as" varchar(10) DEFAULT 'unit' NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."pharmacy_sale_items" ADD COLUMN "pack_size" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."pharmacy_sale_items" ADD COLUMN "packs" integer;--> statement-breakpoint
ALTER TABLE "app"."pharmacy_sale_items" ADD CONSTRAINT "sale_items_amount_check" CHECK (("app"."pharmacy_sale_items"."sold_as" = 'unit' AND "app"."pharmacy_sale_items"."packs" IS NULL AND "app"."pharmacy_sale_items"."amount" = "app"."pharmacy_sale_items"."unit_price" * "app"."pharmacy_sale_items"."quantity")
        OR ("app"."pharmacy_sale_items"."sold_as" = 'pack' AND "app"."pharmacy_sale_items"."packs" > 0 AND "app"."pharmacy_sale_items"."quantity" = "app"."pharmacy_sale_items"."packs" * "app"."pharmacy_sale_items"."pack_size" AND "app"."pharmacy_sale_items"."amount" = "app"."pharmacy_sale_items"."unit_price" * "app"."pharmacy_sale_items"."packs"));