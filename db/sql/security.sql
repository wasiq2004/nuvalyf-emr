-- NuvaLyf security layer: roles, grants, row-level security, append-only audit.
--
-- Idempotent. Applied by `npm run db:migrate` after every schema migration,
-- so new tables are covered automatically:
--   * every table in schema "app" gets RLS + a tenant policy on clinic_id
--   * medflow_app can reach clinic data only through those policies
--   * medflow_platform has no grant on any table in schema "app"
--   * medflow_provisioner can only write staff accounts and roles
--
-- Runs as the schema owner (migration role). Never used at runtime.

-- ---------------------------------------------------------------------------
-- Roles (setup-roles.ts gives them LOGIN + passwords; created NOLOGIN here so
-- migrations work on their own)
-- ---------------------------------------------------------------------------
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['medflow_app', 'medflow_platform', 'medflow_provisioner'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('CREATE ROLE %I NOLOGIN', r);
    END IF;
  END LOOP;
END $$;

-- Nobody gets anything by default.
REVOKE ALL ON SCHEMA app, platform, sys FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.current_clinic_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.clinic_id', true), '')::uuid $$;

CREATE OR REPLACE FUNCTION app.current_user_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;

CREATE OR REPLACE FUNCTION sys.reject_change() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  RAISE EXCEPTION '% on %.% is not allowed: table is append-only', TG_OP, TG_TABLE_SCHEMA, TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege';
END $$;

GRANT USAGE ON SCHEMA app TO medflow_app, medflow_provisioner;
GRANT USAGE ON SCHEMA platform TO medflow_app, medflow_platform, medflow_provisioner;
GRANT USAGE ON SCHEMA sys TO medflow_app, medflow_platform;
GRANT EXECUTE ON FUNCTION app.current_clinic_id(), app.current_user_id() TO medflow_app, medflow_provisioner;

-- ---------------------------------------------------------------------------
-- Clinic data: RLS on every table in schema "app"
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t record;
  has_clinic boolean;
BEGIN
  FOR t IN
    SELECT c.relname AS name
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'app' AND c.relkind = 'r'
  LOOP
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'app' AND table_name = t.name AND column_name = 'clinic_id'
    ) INTO has_clinic;

    IF NOT has_clinic THEN
      RAISE EXCEPTION 'Table app.% has no clinic_id column; every app table must be clinic-scoped', t.name;
    END IF;

    EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY', t.name);

    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON app.%I', t.name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON app.%I FOR ALL TO medflow_app
         USING (clinic_id = app.current_clinic_id())
         WITH CHECK (clinic_id = app.current_clinic_id())',
      t.name
    );

    EXECUTE format('REVOKE ALL ON app.%I FROM medflow_app, medflow_platform, medflow_provisioner', t.name);

    IF t.name = 'audit_events' THEN
      EXECUTE format('GRANT SELECT, INSERT ON app.%I TO medflow_app', t.name);
    ELSE
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON app.%I TO medflow_app', t.name);
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- Provisioner: onboarding a clinic and rescuing a clinic administrator.
-- Staff accounts, roles and the starter reference catalogues (medicines,
-- codes, ranges) - never patient data.
-- ---------------------------------------------------------------------------
DO $$
DECLARE tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'users', 'roles', 'role_permissions', 'user_roles', 'clinic_settings',
    'drugs', 'allergy_classes', 'drug_allergy_classes', 'drug_interactions',
    'prescribing_presets', 'diagnosis_codes', 'vital_ranges', 'lab_tests'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS provisioner_access ON app.%I', tbl);
    EXECUTE format(
      'CREATE POLICY provisioner_access ON app.%I FOR ALL TO medflow_provisioner USING (true) WITH CHECK (true)',
      tbl
    );
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON app.%I TO medflow_provisioner', tbl);
  END LOOP;

  DROP POLICY IF EXISTS provisioner_insert ON app.audit_events;
  CREATE POLICY provisioner_insert ON app.audit_events FOR INSERT TO medflow_provisioner WITH CHECK (true);
  GRANT INSERT ON app.audit_events TO medflow_provisioner;
END $$;

-- ---------------------------------------------------------------------------
-- Platform tables
-- ---------------------------------------------------------------------------
REVOKE ALL ON ALL TABLES IN SCHEMA platform FROM medflow_app, medflow_platform, medflow_provisioner;

GRANT SELECT, INSERT, UPDATE, DELETE ON platform.plans, platform.plan_modules TO medflow_platform;
GRANT SELECT, UPDATE ON platform.clinics TO medflow_platform;
GRANT SELECT, INSERT, UPDATE ON platform.operators TO medflow_platform;
GRANT SELECT, INSERT ON platform.audit_events TO medflow_platform;
GRANT SELECT ON platform.clinic_usage TO medflow_platform;

-- Onboarding creates the clinic and its first admin in one transaction.
GRANT SELECT, INSERT ON platform.clinics TO medflow_provisioner;
GRANT SELECT ON platform.plans, platform.plan_modules TO medflow_provisioner;
GRANT INSERT ON platform.audit_events TO medflow_provisioner;

-- The clinic app reads only what it needs to resolve a clinic and its modules.
GRANT SELECT (id, name, code, status, plan_id) ON platform.clinics TO medflow_app;
GRANT SELECT ON platform.plan_modules TO medflow_app;
GRANT SELECT (id, name) ON platform.plans TO medflow_app;

-- ---------------------------------------------------------------------------
-- Infrastructure
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON sys.rate_limits TO medflow_app, medflow_platform;
-- The worker reports in; health checks read it. Nothing clinical.
GRANT SELECT, INSERT, UPDATE ON sys.heartbeats TO medflow_app;

-- ---------------------------------------------------------------------------
-- Append-only audit trails (blocks even the owner role)
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS audit_events_append_only ON app.audit_events;
CREATE TRIGGER audit_events_append_only
  BEFORE UPDATE OR DELETE ON app.audit_events
  FOR EACH ROW EXECUTE FUNCTION sys.reject_change();

DROP TRIGGER IF EXISTS audit_events_no_truncate ON app.audit_events;
CREATE TRIGGER audit_events_no_truncate
  BEFORE TRUNCATE ON app.audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION sys.reject_change();

DROP TRIGGER IF EXISTS platform_audit_append_only ON platform.audit_events;
CREATE TRIGGER platform_audit_append_only
  BEFORE UPDATE OR DELETE ON platform.audit_events
  FOR EACH ROW EXECUTE FUNCTION sys.reject_change();

DROP TRIGGER IF EXISTS platform_audit_no_truncate ON platform.audit_events;
CREATE TRIGGER platform_audit_no_truncate
  BEFORE TRUNCATE ON platform.audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION sys.reject_change();

-- ---------------------------------------------------------------------------
-- Clinical record guards
--
-- A finalised consultation is a legal record: nobody, including a direct
-- database call from the app, can change it or what hangs off it. Corrections
-- are added as amendments. These run for every role, the owner included.
-- Refusals use SQLSTATE MFL01 so the app can tell them apart (lib/errors.ts).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.guard_encounter() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Consultations cannot be deleted' USING ERRCODE = 'MFL01';
  END IF;
  IF OLD.status = 'finalized' THEN
    RAISE EXCEPTION 'Consultation % is finalised and cannot be changed', OLD.id USING ERRCODE = 'MFL01';
  END IF;
  RETURN NEW;
END $$;

-- Rows that belong to a consultation (vitals, diagnoses, prescriptions, lab
-- orders) can only be written while it is open. FOR SHARE serialises with a
-- concurrent finalisation.
CREATE OR REPLACE FUNCTION app.guard_encounter_child() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  enc uuid;
  enc_status text;
BEGIN
  IF TG_OP = 'DELETE' THEN enc := OLD.encounter_id; ELSE enc := NEW.encounter_id; END IF;
  SELECT status INTO enc_status FROM app.encounters WHERE id = enc FOR SHARE;
  IF enc_status = 'finalized' THEN
    RAISE EXCEPTION 'Consultation % is finalised and cannot be changed', enc USING ERRCODE = 'MFL01';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.encounter_id IS DISTINCT FROM OLD.encounter_id THEN
    RAISE EXCEPTION 'Clinical entries cannot be moved between consultations' USING ERRCODE = 'MFL01';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

-- A signed prescription is frozen; only the pharmacy's dispensing status moves.
CREATE OR REPLACE FUNCTION app.guard_prescription() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.encounter_id IS DISTINCT FROM OLD.encounter_id THEN
    RAISE EXCEPTION 'Prescriptions cannot be moved between consultations' USING ERRCODE = 'MFL01';
  END IF;
  IF OLD.status = 'signed' THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'Signed prescriptions cannot be deleted' USING ERRCODE = 'MFL01';
    END IF;
    IF (NEW.clinic_id, NEW.encounter_id, NEW.patient_id, NEW.prescriber_id, NEW.status, NEW.signed_snapshot, NEW.signed_at)
       IS DISTINCT FROM
       (OLD.clinic_id, OLD.encounter_id, OLD.patient_id, OLD.prescriber_id, OLD.status, OLD.signed_snapshot, OLD.signed_at) THEN
      RAISE EXCEPTION 'Prescription % is signed and cannot be changed', OLD.id USING ERRCODE = 'MFL01';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION app.guard_prescription_item() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  rx uuid;
  rx_status text;
BEGIN
  IF TG_OP = 'DELETE' THEN rx := OLD.prescription_id; ELSE rx := NEW.prescription_id; END IF;
  SELECT status INTO rx_status FROM app.prescriptions WHERE id = rx FOR SHARE;
  IF rx_status = 'signed' THEN
    RAISE EXCEPTION 'Prescription % is signed and cannot be changed', rx USING ERRCODE = 'MFL01';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.prescription_id IS DISTINCT FROM OLD.prescription_id THEN
    RAISE EXCEPTION 'Prescription items cannot be moved' USING ERRCODE = 'MFL01';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

-- Lab orders are never deleted; a result, once entered, is final (the doctor
-- marking it read is the only change allowed).
CREATE OR REPLACE FUNCTION app.guard_lab_order() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Lab orders cannot be deleted' USING ERRCODE = 'MFL01';
  END IF;
  IF OLD.status IN ('resulted', 'cancelled') AND
     (to_jsonb(NEW) - 'read_at') IS DISTINCT FROM (to_jsonb(OLD) - 'read_at') THEN
    RAISE EXCEPTION 'Lab order % is closed and cannot be changed', OLD.id USING ERRCODE = 'MFL01';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS encounters_guard ON app.encounters;
CREATE TRIGGER encounters_guard BEFORE UPDATE OR DELETE ON app.encounters
  FOR EACH ROW EXECUTE FUNCTION app.guard_encounter();

DO $$
DECLARE tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['vitals', 'diagnoses'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON app.%I', tbl || '_encounter_guard', tbl);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE INSERT OR UPDATE OR DELETE ON app.%I FOR EACH ROW EXECUTE FUNCTION app.guard_encounter_child()',
      tbl || '_encounter_guard', tbl
    );
  END LOOP;
END $$;

-- A prescription is created or discarded only while its consultation is open;
-- updates are governed by guard_prescription (the pharmacy updates dispensing
-- status on signed prescriptions after the consultation has closed).
DROP TRIGGER IF EXISTS prescriptions_encounter_guard ON app.prescriptions;
CREATE TRIGGER prescriptions_encounter_guard BEFORE INSERT OR DELETE ON app.prescriptions
  FOR EACH ROW EXECUTE FUNCTION app.guard_encounter_child();

-- New lab orders need an open consultation; results arrive after it closes.
DROP TRIGGER IF EXISTS lab_orders_encounter_guard ON app.lab_orders;
CREATE TRIGGER lab_orders_encounter_guard BEFORE INSERT ON app.lab_orders
  FOR EACH ROW EXECUTE FUNCTION app.guard_encounter_child();

DROP TRIGGER IF EXISTS lab_orders_guard ON app.lab_orders;
CREATE TRIGGER lab_orders_guard BEFORE UPDATE OR DELETE ON app.lab_orders
  FOR EACH ROW EXECUTE FUNCTION app.guard_lab_order();

DROP TRIGGER IF EXISTS prescriptions_guard ON app.prescriptions;
CREATE TRIGGER prescriptions_guard BEFORE UPDATE OR DELETE ON app.prescriptions
  FOR EACH ROW EXECUTE FUNCTION app.guard_prescription();

DROP TRIGGER IF EXISTS prescription_items_guard ON app.prescription_items;
CREATE TRIGGER prescription_items_guard BEFORE INSERT OR UPDATE OR DELETE ON app.prescription_items
  FOR EACH ROW EXECUTE FUNCTION app.guard_prescription_item();

-- Allergies are corrected (with a reason, kept in allergy_history), never deleted.
DROP TRIGGER IF EXISTS allergies_no_delete ON app.allergies;
CREATE TRIGGER allergies_no_delete BEFORE DELETE ON app.allergies
  FOR EACH ROW EXECUTE FUNCTION sys.reject_change();

DO $$
DECLARE tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['allergy_history', 'encounter_amendments'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON app.%I', tbl || '_append_only', tbl);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON app.%I FOR EACH ROW EXECUTE FUNCTION sys.reject_change()',
      tbl || '_append_only', tbl
    );
  END LOOP;
END $$;

-- Private notes are not part of the clinical record: only their author can
-- read or write them - not a Clinic Admin, not another doctor.
DROP POLICY IF EXISTS private_notes_author_only ON app.private_notes;
CREATE POLICY private_notes_author_only ON app.private_notes AS RESTRICTIVE FOR ALL TO medflow_app
  USING (author_id = app.current_user_id())
  WITH CHECK (author_id = app.current_user_id());

-- ---------------------------------------------------------------------------
-- Billing guards
-- ---------------------------------------------------------------------------
-- Lines can change only while the invoice is a draft.
CREATE OR REPLACE FUNCTION app.guard_invoice_item() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  inv uuid;
  inv_status text;
BEGIN
  IF TG_OP = 'DELETE' THEN inv := OLD.invoice_id; ELSE inv := NEW.invoice_id; END IF;
  SELECT status INTO inv_status FROM app.invoices WHERE id = inv FOR SHARE;
  -- NULL: the invoice itself is being deleted (a discarded draft cascades).
  IF inv_status IS NOT NULL AND inv_status <> 'draft' THEN
    RAISE EXCEPTION 'Invoice % is %; its lines cannot be changed', inv, inv_status USING ERRCODE = 'MFL01';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.invoice_id IS DISTINCT FROM OLD.invoice_id THEN
    RAISE EXCEPTION 'Invoice lines cannot be moved' USING ERRCODE = 'MFL01';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

-- Invoices are never deleted once issued; an issued invoice's amounts are
-- fixed (only what has been paid moves), and a void invoice is final.
CREATE OR REPLACE FUNCTION app.guard_invoice() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN
      RAISE EXCEPTION 'Invoice % is % and cannot be deleted', OLD.number, OLD.status USING ERRCODE = 'MFL01';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'void' THEN
    RAISE EXCEPTION 'Invoice % is void and cannot be changed', OLD.number USING ERRCODE = 'MFL01';
  END IF;
  IF OLD.status = 'issued' AND
     (NEW.number, NEW.patient_id, NEW.visit_id, NEW.subtotal, NEW.discount, NEW.total, NEW.issued_at, NEW.issued_by)
     IS DISTINCT FROM
     (OLD.number, OLD.patient_id, OLD.visit_id, OLD.subtotal, OLD.discount, OLD.total, OLD.issued_at, OLD.issued_by) THEN
    RAISE EXCEPTION 'Invoice % is issued; its amounts cannot be changed', OLD.number USING ERRCODE = 'MFL01';
  END IF;
  IF OLD.status = 'issued' AND NEW.status = 'draft' THEN
    RAISE EXCEPTION 'An issued invoice cannot go back to draft' USING ERRCODE = 'MFL01';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS invoice_items_guard ON app.invoice_items;
CREATE TRIGGER invoice_items_guard BEFORE INSERT OR UPDATE OR DELETE ON app.invoice_items
  FOR EACH ROW EXECUTE FUNCTION app.guard_invoice_item();

DROP TRIGGER IF EXISTS invoices_guard ON app.invoices;
CREATE TRIGGER invoices_guard BEFORE UPDATE OR DELETE ON app.invoices
  FOR EACH ROW EXECUTE FUNCTION app.guard_invoice();

-- Money received is history: a mistake is corrected with a refund row.
DROP TRIGGER IF EXISTS payments_append_only ON app.payments;
CREATE TRIGGER payments_append_only BEFORE UPDATE OR DELETE ON app.payments
  FOR EACH ROW EXECUTE FUNCTION sys.reject_change();

-- ---------------------------------------------------------------------------
-- Pharmacy stock ledger
--
-- Every change to stock is a stock_movements row; this trigger applies it to
-- the batch. A batch's quantity cannot be set any other way, and the CHECK
-- (quantity >= 0) makes overselling impossible even under concurrency.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.apply_stock_movement() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  UPDATE app.stock_batches SET quantity = quantity + NEW.change
    WHERE id = NEW.batch_id AND drug_id = NEW.drug_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Stock movement for an unknown batch' USING ERRCODE = 'MFL01';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION app.guard_stock_batch() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Stock batches cannot be deleted' USING ERRCODE = 'MFL01';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.quantity <> 0 THEN
      RAISE EXCEPTION 'A new batch starts empty; stock arrives as a movement' USING ERRCODE = 'MFL01';
    END IF;
    RETURN NEW;
  END IF;
  -- Depth 2 = called from apply_stock_movement.
  IF NEW.quantity IS DISTINCT FROM OLD.quantity AND pg_trigger_depth() < 2 THEN
    RAISE EXCEPTION 'Stock quantities change only through stock movements' USING ERRCODE = 'MFL01';
  END IF;
  IF (NEW.drug_id, NEW.batch_no, NEW.expiry_date) IS DISTINCT FROM (OLD.drug_id, OLD.batch_no, OLD.expiry_date) THEN
    RAISE EXCEPTION 'A batch''s medicine, number and expiry cannot be changed' USING ERRCODE = 'MFL01';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS stock_movements_apply ON app.stock_movements;
CREATE TRIGGER stock_movements_apply AFTER INSERT ON app.stock_movements
  FOR EACH ROW EXECUTE FUNCTION app.apply_stock_movement();

DROP TRIGGER IF EXISTS stock_batches_guard ON app.stock_batches;
CREATE TRIGGER stock_batches_guard BEFORE INSERT OR UPDATE OR DELETE ON app.stock_batches
  FOR EACH ROW EXECUTE FUNCTION app.guard_stock_batch();

DO $$
DECLARE tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['stock_movements', 'pharmacy_sales', 'pharmacy_sale_items'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON app.%I', tbl || '_append_only', tbl);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON app.%I FOR EACH ROW EXECUTE FUNCTION sys.reject_change()',
      tbl || '_append_only', tbl
    );
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- Consent history is append-only: a change of mind is a new event.
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS consent_events_append_only ON app.consent_events;
CREATE TRIGGER consent_events_append_only BEFORE UPDATE OR DELETE ON app.consent_events
  FOR EACH ROW EXECUTE FUNCTION sys.reject_change();

-- ---------------------------------------------------------------------------
-- Analytics: runs and exports are a permanent record of what was analysed.
-- ---------------------------------------------------------------------------
DO $$
DECLARE tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['cohort_runs', 'analytics_exports'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON app.%I', tbl || '_append_only', tbl);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON app.%I FOR EACH ROW EXECUTE FUNCTION sys.reject_change()',
      tbl || '_append_only', tbl
    );
  END LOOP;
END $$;
