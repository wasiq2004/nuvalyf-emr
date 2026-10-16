-- Aggregate views for the operations console.
--
-- Owned by the migration role, so they can count across clinics, but they
-- expose counts only - never a row of clinic data. medflow_platform is granted
-- SELECT on these views (security.sql) and nothing in schema "app".
--
-- Recreated on every migrate; extend as new clinic tables appear.

DROP VIEW IF EXISTS platform.clinic_usage;

CREATE VIEW platform.clinic_usage AS
SELECT
  c.id AS clinic_id,
  (SELECT count(*) FROM app.users u WHERE u.clinic_id = c.id)::int AS staff_total,
  (SELECT count(*) FROM app.users u WHERE u.clinic_id = c.id AND u.status = 'active')::int AS staff_active,
  (SELECT max(u.last_login_at) FROM app.users u WHERE u.clinic_id = c.id) AS last_activity_at
FROM platform.clinics c;
