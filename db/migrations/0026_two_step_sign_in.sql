ALTER TABLE "platform"."operators" ADD COLUMN "mfa_secret" text;--> statement-breakpoint
ALTER TABLE "platform"."operators" ADD COLUMN "mfa_pending_secret" text;--> statement-breakpoint
ALTER TABLE "platform"."operators" ADD COLUMN "mfa_enabled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "platform"."operators" ADD COLUMN "mfa_last_step" integer;--> statement-breakpoint
ALTER TABLE "platform"."operators" ADD COLUMN "mfa_recovery_hashes" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."users" ADD COLUMN "mfa_secret" text;--> statement-breakpoint
ALTER TABLE "app"."users" ADD COLUMN "mfa_pending_secret" text;--> statement-breakpoint
ALTER TABLE "app"."users" ADD COLUMN "mfa_enabled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app"."users" ADD COLUMN "mfa_last_step" integer;--> statement-breakpoint
ALTER TABLE "app"."users" ADD COLUMN "mfa_recovery_hashes" jsonb DEFAULT '[]'::jsonb NOT NULL;