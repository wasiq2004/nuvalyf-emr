-- MedFlow EMR Database Schema
-- Schema: medflow
--
-- Idempotent: safe to run on every deploy (`npm run db:init`). New databases
-- get the full schema; existing databases get any missing constraints/indexes.
-- Keep lib/db/schema.ts in sync with this file.

CREATE SCHEMA IF NOT EXISTS medflow;

-- Extension for UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Users Table
CREATE TABLE IF NOT EXISTS medflow.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role VARCHAR(50) NOT NULL CHECK (role IN ('admin', 'doctor', 'patient')),
  first_name VARCHAR(100),
  last_name VARCHAR(100),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

-- Departments Table
CREATE TABLE IF NOT EXISTS medflow.departments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Doctors Table
CREATE TABLE IF NOT EXISTS medflow.doctors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES medflow.users(id) ON DELETE CASCADE,
  specialization VARCHAR(255) NOT NULL,
  license_number VARCHAR(100),
  years_of_experience INT DEFAULT 0,
  department_id UUID REFERENCES medflow.departments(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

-- Doctor Availability Table
CREATE TABLE IF NOT EXISTS medflow.doctor_availability (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doctor_id UUID NOT NULL REFERENCES medflow.doctors(id) ON DELETE CASCADE,
  day_of_week INT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time TIME NOT NULL,
  end_time TIME NOT NULL
);

-- Patients Table
CREATE TABLE IF NOT EXISTS medflow.patients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES medflow.users(id) ON DELETE CASCADE,
  first_name VARCHAR(100),
  last_name VARCHAR(100),
  gender VARCHAR(20),
  contact_number VARCHAR(50),
  address TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

-- Appointments Table
CREATE TABLE IF NOT EXISTS medflow.appointments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES medflow.patients(id) ON DELETE CASCADE,
  doctor_id UUID NOT NULL REFERENCES medflow.doctors(id) ON DELETE CASCADE,
  appointment_datetime TIMESTAMPTZ NOT NULL,
  notes TEXT,
  status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'completed', 'cancelled')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

-- PHI Audit Logs Table
CREATE TABLE IF NOT EXISTS medflow.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,
  action VARCHAR(100) NOT NULL,
  resource VARCHAR(100) NOT NULL,
  resource_id VARCHAR(255),
  details TEXT,
  ip_address VARCHAR(45),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Upgrades for databases created before these constraints existed
-- ---------------------------------------------------------------------------

UPDATE medflow.appointments SET status = 'pending' WHERE status IS NULL;
ALTER TABLE medflow.appointments ALTER COLUMN status SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'doctor_availability_time_check'
  ) THEN
    ALTER TABLE medflow.doctor_availability
      ADD CONSTRAINT doctor_availability_time_check CHECK (end_time > start_time);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

-- Case-insensitive uniqueness
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_idx
  ON medflow.users (lower(email));
CREATE UNIQUE INDEX IF NOT EXISTS departments_name_lower_idx
  ON medflow.departments (lower(name));

-- One profile per user account
CREATE UNIQUE INDEX IF NOT EXISTS doctors_user_id_idx ON medflow.doctors (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS patients_user_id_idx ON medflow.patients (user_id);
CREATE INDEX IF NOT EXISTS doctors_department_id_idx ON medflow.doctors (department_id);

-- One working-hours window per doctor per weekday
CREATE UNIQUE INDEX IF NOT EXISTS doctor_availability_doctor_day_idx
  ON medflow.doctor_availability (doctor_id, day_of_week);

-- Appointment lookups
CREATE INDEX IF NOT EXISTS appointments_doctor_time_idx
  ON medflow.appointments (doctor_id, appointment_datetime);
CREATE INDEX IF NOT EXISTS appointments_patient_time_idx
  ON medflow.appointments (patient_id, appointment_datetime);

-- Prevents double booking: one active appointment per doctor per slot.
CREATE UNIQUE INDEX IF NOT EXISTS appointments_doctor_slot_active_idx
  ON medflow.appointments (doctor_id, appointment_datetime)
  WHERE status <> 'cancelled' AND deleted_at IS NULL;

-- Audit trail queries
CREATE INDEX IF NOT EXISTS audit_logs_created_at_idx ON medflow.audit_logs (created_at);
CREATE INDEX IF NOT EXISTS audit_logs_user_id_idx ON medflow.audit_logs (user_id);
