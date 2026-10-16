// Services the clinic offers and the weekly schedules slots are derived from.
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  numeric,
  primaryKey,
  text,
  time,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { appSchema, clinicId, createdAt, id, updatedAt } from "./_shared";
import { clinics } from "./platform";
import { users } from "./identity";

export const services = appSchema.table(
  "services",
  {
    id: id(),
    clinicId: clinicId().references(() => clinics.id, { onDelete: "restrict" }),
    name: varchar("name", { length: 150 }).notNull(),
    description: text("description"),
    durationMinutes: integer("duration_minutes").notNull(),
    price: numeric("price", { precision: 10, scale: 2 }).notNull().default("0"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("services_clinic_id_id_key").on(t.clinicId, t.id),
    uniqueIndex("services_clinic_name_idx").on(t.clinicId, sql`lower(${t.name})`),
    check("services_duration_check", sql`${t.durationMinutes} BETWEEN 5 AND 480`),
    check("services_price_check", sql`${t.price} >= 0`),
  ],
);

/** A doctor's recurring working window. Several per weekday are allowed (split shifts). */
export const schedules = appSchema.table(
  "schedules",
  {
    id: id(),
    clinicId: clinicId(),
    doctorId: uuid("doctor_id").notNull(),
    weekday: integer("weekday").notNull(),
    startTime: time("start_time").notNull(),
    endTime: time("end_time").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: "schedules_doctor_fk",
      columns: [t.clinicId, t.doctorId],
      foreignColumns: [users.clinicId, users.id],
    }).onDelete("cascade"),
    index("schedules_doctor_idx").on(t.clinicId, t.doctorId, t.weekday),
    check("schedules_weekday_check", sql`${t.weekday} BETWEEN 0 AND 6`),
    check("schedules_time_check", sql`${t.endTime} > ${t.startTime}`),
  ],
);

/** Services a doctor offers. A doctor with no rows offers every active service. */
export const doctorServices = appSchema.table(
  "doctor_services",
  {
    clinicId: clinicId(),
    doctorId: uuid("doctor_id").notNull(),
    serviceId: uuid("service_id").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.doctorId, t.serviceId] }),
    foreignKey({
      name: "doctor_services_doctor_fk",
      columns: [t.clinicId, t.doctorId],
      foreignColumns: [users.clinicId, users.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "doctor_services_service_fk",
      columns: [t.clinicId, t.serviceId],
      foreignColumns: [services.clinicId, services.id],
    }).onDelete("cascade"),
  ],
);

/** Days a doctor is away: no slots are offered and nothing can be booked. */
export const scheduleExceptions = appSchema.table(
  "schedule_exceptions",
  {
    id: id(),
    clinicId: clinicId().references(() => clinics.id, { onDelete: "restrict" }),
    doctorId: uuid("doctor_id").notNull(),
    date: date("date").notNull(),
    reason: varchar("reason", { length: 200 }).notNull(),
    createdBy: uuid("created_by").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("schedule_exceptions_doctor_date_idx").on(t.clinicId, t.doctorId, t.date),
    foreignKey({ name: "schedule_exceptions_doctor_fk", columns: [t.clinicId, t.doctorId], foreignColumns: [users.clinicId, users.id] }),
  ],
);
