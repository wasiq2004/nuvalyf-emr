ALTER TABLE "app"."encounters" ADD COLUMN "nursing_notes" text;--> statement-breakpoint
ALTER TABLE "app"."encounters" ADD COLUMN "triage_notes_by" uuid;--> statement-breakpoint
ALTER TABLE "app"."encounters" ADD COLUMN "triage_notes_at" timestamp with time zone;--> statement-breakpoint
-- Nurses update contact details in triage. New clinics get this from
-- lib/access/roles.ts at onboarding.
INSERT INTO app.role_permissions (clinic_id, role_id, permission)
SELECT r.clinic_id, r.id, 'patient:contact'
FROM app.roles r
WHERE r.is_system AND r.key = 'nurse'
ON CONFLICT DO NOTHING;
