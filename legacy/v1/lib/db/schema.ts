// Drizzle mirror of scripts/init-db.sql. The SQL file is what actually creates
// the database objects; keep both in sync when changing the schema.
import {
  pgSchema,
  uuid,
  varchar,
  text,
  integer,
  timestamp,
  time,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";

export const medflowSchema = pgSchema("medflow");

// 1. Users Table
export const users = medflowSchema.table(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    email: varchar("email", { length: 255 }).notNull().unique(),
    passwordHash: text("password_hash").notNull(),
    role: varchar("role", { length: 50 }).notNull(),
    firstName: varchar("first_name", { length: 100 }),
    lastName: varchar("last_name", { length: 100 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    check("users_role_check", sql`${t.role} IN ('admin', 'doctor', 'patient')`),
    uniqueIndex("users_email_lower_idx").on(sql`lower(${t.email})`),
  ],
);

// 2. Departments Table
export const departments = medflowSchema.table(
  "departments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [uniqueIndex("departments_name_lower_idx").on(sql`lower(${t.name})`)],
);

// 3. Doctors Table
export const doctors = medflowSchema.table(
  "doctors",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    specialization: varchar("specialization", { length: 255 }).notNull(),
    licenseNumber: varchar("license_number", { length: 100 }),
    yearsOfExperience: integer("years_of_experience").default(0),
    departmentId: uuid("department_id").references(() => departments.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("doctors_user_id_idx").on(t.userId),
    index("doctors_department_id_idx").on(t.departmentId),
  ],
);

// 4. Doctor Availability Table
export const doctorAvailability = medflowSchema.table(
  "doctor_availability",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    doctorId: uuid("doctor_id")
      .notNull()
      .references(() => doctors.id, { onDelete: "cascade" }),
    dayOfWeek: integer("day_of_week").notNull(),
    startTime: time("start_time").notNull(),
    endTime: time("end_time").notNull(),
  },
  (t) => [
    check("doctor_availability_day_check", sql`${t.dayOfWeek} BETWEEN 0 AND 6`),
    check("doctor_availability_time_check", sql`${t.endTime} > ${t.startTime}`),
    uniqueIndex("doctor_availability_doctor_day_idx").on(t.doctorId, t.dayOfWeek),
  ],
);

// 5. Patients Table
// Names live on `users`; the copies here are kept in sync for older readers.
export const patients = medflowSchema.table(
  "patients",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    firstName: varchar("first_name", { length: 100 }),
    lastName: varchar("last_name", { length: 100 }),
    gender: varchar("gender", { length: 20 }),
    contactNumber: varchar("contact_number", { length: 50 }),
    address: text("address"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("patients_user_id_idx").on(t.userId)],
);

// 6. Appointments Table
export const appointments = medflowSchema.table(
  "appointments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    patientId: uuid("patient_id")
      .notNull()
      .references(() => patients.id, { onDelete: "cascade" }),
    doctorId: uuid("doctor_id")
      .notNull()
      .references(() => doctors.id, { onDelete: "cascade" }),
    appointmentDatetime: timestamp("appointment_datetime", {
      withTimezone: true,
    }).notNull(),
    notes: text("notes"),
    status: varchar("status", { length: 50 }).notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    check(
      "appointments_status_check",
      sql`${t.status} IN ('pending', 'confirmed', 'completed', 'cancelled')`,
    ),
    index("appointments_doctor_time_idx").on(t.doctorId, t.appointmentDatetime),
    index("appointments_patient_time_idx").on(t.patientId, t.appointmentDatetime),
    // One active booking per doctor per slot; cancelled bookings free the slot.
    uniqueIndex("appointments_doctor_slot_active_idx")
      .on(t.doctorId, t.appointmentDatetime)
      .where(sql`status <> 'cancelled' AND deleted_at IS NULL`),
  ],
);

// 7. PHI Audit Logs Table
export const auditLogs = medflowSchema.table(
  "audit_logs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id"),
    action: varchar("action", { length: 100 }).notNull(),
    resource: varchar("resource", { length: 100 }).notNull(),
    resourceId: varchar("resource_id", { length: 255 }),
    details: text("details"),
    ipAddress: varchar("ip_address", { length: 45 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    index("audit_logs_created_at_idx").on(t.createdAt),
    index("audit_logs_user_id_idx").on(t.userId),
  ],
);

// --- RELATIONS ---

export const usersRelations = relations(users, ({ one }) => ({
  doctor: one(doctors, {
    fields: [users.id],
    references: [doctors.userId],
  }),
  patient: one(patients, {
    fields: [users.id],
    references: [patients.userId],
  }),
}));

export const departmentsRelations = relations(departments, ({ many }) => ({
  doctors: many(doctors),
}));

export const doctorsRelations = relations(doctors, ({ one, many }) => ({
  user: one(users, {
    fields: [doctors.userId],
    references: [users.id],
  }),
  department: one(departments, {
    fields: [doctors.departmentId],
    references: [departments.id],
  }),
  availability: many(doctorAvailability),
  appointments: many(appointments),
}));

export const doctorAvailabilityRelations = relations(
  doctorAvailability,
  ({ one }) => ({
    doctor: one(doctors, {
      fields: [doctorAvailability.doctorId],
      references: [doctors.id],
    }),
  }),
);

export const patientsRelations = relations(patients, ({ one, many }) => ({
  user: one(users, {
    fields: [patients.userId],
    references: [users.id],
  }),
  appointments: many(appointments),
}));

export const appointmentsRelations = relations(appointments, ({ one }) => ({
  patient: one(patients, {
    fields: [appointments.patientId],
    references: [patients.id],
  }),
  doctor: one(doctors, {
    fields: [appointments.doctorId],
    references: [doctors.id],
  }),
}));
