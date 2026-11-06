ALTER TABLE "app"."pharmacy_sale_items" ADD COLUMN "dose" varchar(60);--> statement-breakpoint
ALTER TABLE "app"."pharmacy_sale_items" ADD COLUMN "frequency" varchar(40);--> statement-breakpoint
ALTER TABLE "app"."pharmacy_sale_items" ADD COLUMN "duration_days" integer;--> statement-breakpoint
ALTER TABLE "app"."pharmacy_sale_items" ADD COLUMN "instructions" varchar(300);--> statement-breakpoint
ALTER TABLE "app"."pharmacy_sale_items" ADD COLUMN "line_change" varchar(15) DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."pharmacy_sale_items" ADD COLUMN "prescribed_text" varchar(400);--> statement-breakpoint
ALTER TABLE "app"."pharmacy_sales" ADD COLUMN "dispense_note" varchar(300);--> statement-breakpoint
ALTER TABLE "app"."pharmacy_sale_items" ADD CONSTRAINT "sale_items_line_change_check" CHECK ("app"."pharmacy_sale_items"."line_change" IN ('none', 'as_prescribed', 'changed', 'substituted', 'added'));