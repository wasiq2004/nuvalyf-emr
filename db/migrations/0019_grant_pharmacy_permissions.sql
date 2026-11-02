-- New pharmacy permissions (docs/PHARMACY_DESIGN.md section 6) for clinics
-- that already exist. New clinics get them from lib/access/roles.ts at
-- onboarding. A migration runs once, so a permission an admin later removes
-- is not granted again.
INSERT INTO app.role_permissions (clinic_id, role_id, permission)
SELECT r.clinic_id, r.id, p.permission
FROM app.roles r
JOIN (VALUES
  ('clinic_admin', 'pharmacy:return'),
  ('clinic_admin', 'pharmacy:cancel'),
  ('clinic_admin', 'pharmacy:reports'),
  ('clinic_admin', 'accounts:manage'),
  ('pharmacist', 'pharmacy:return'),
  ('pharmacist', 'pharmacy:reports'),
  ('pharmacist', 'accounts:manage')
) AS p(role_key, permission) ON p.role_key = r.key
WHERE r.is_system
ON CONFLICT DO NOTHING;
