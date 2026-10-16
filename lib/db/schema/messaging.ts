// WhatsApp messaging (module "whatsapp"), patient consent and CSV import.
//
// Consent is an append-only history; the latest event per patient and type
// is the current state. Outgoing messages are queued in message_log (an
// outbox) and sent by the worker, which checks consent again at send time.
import { bigint, boolean, check, foreignKey, index, integer, jsonb, text, timestamp, unique, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { appSchema, clinicId, createdAt, id, updatedAt } from "./_shared";
import { clinics } from "./platform";
import { appointments, patients } from "./frontdesk";

export const consentEvents = appSchema.table(
  "consent_events",
  {
    id: id(),
    /** Strict order of events (timestamps tie within one transaction). */
    seq: bigint("seq", { mode: "number" }).generatedAlwaysAsIdentity(),
    clinicId: clinicId(),
    patientId: uuid("patient_id").notNull(),
    type: varchar("type", { length: 30 }).notNull(),
    granted: boolean("granted").notNull(),
    source: varchar("source", { length: 20 }).notNull(),
    note: varchar("note", { length: 300 }),
    recordedBy: uuid("recorded_by"),
    recordedAt: createdAt(),
  },
  (t) => [
    foreignKey({ name: "consent_events_patient_fk", columns: [t.clinicId, t.patientId], foreignColumns: [patients.clinicId, patients.id] }),
    index("consent_events_patient_idx").on(t.clinicId, t.patientId, t.type, t.recordedAt),
    check("consent_events_type_check", sql`${t.type} IN ('whatsapp_reminders', 'whatsapp_broadcasts')`),
    check("consent_events_source_check", sql`${t.source} IN ('front_desk', 'import', 'patient_reply', 'portal')`),
  ],
);

/** One per clinic. The access token is stored encrypted (lib/crypto.ts). */
export const whatsappConfig = appSchema.table("whatsapp_config", {
  clinicId: uuid("clinic_id")
    .primaryKey()
    .references(() => clinics.id, { onDelete: "restrict" }),
  phoneNumberId: varchar("phone_number_id", { length: 40 }),
  businessAccountId: varchar("business_account_id", { length: 40 }),
  displayPhone: varchar("display_phone", { length: 30 }),
  accessTokenEncrypted: text("access_token_encrypted"),
  enabled: boolean("enabled").notNull().default(false),
  remindersEnabled: boolean("reminders_enabled").notNull().default(false),
  reminderHoursBefore: integer("reminder_hours_before").notNull().default(24),
  reminderTemplate: varchar("reminder_template", { length: 100 }).notNull().default("appointment_reminder"),
  templateLanguage: varchar("template_language", { length: 10 }).notNull().default("en"),
  updatedBy: uuid("updated_by"),
  updatedAt: updatedAt(),
});

/** Approved WhatsApp templates the clinic may use for broadcasts. */
export const messageTemplates = appSchema.table(
  "message_templates",
  {
    id: id(),
    clinicId: clinicId().references(() => clinics.id, { onDelete: "restrict" }),
    name: varchar("name", { length: 100 }).notNull(),
    language: varchar("language", { length: 10 }).notNull().default("en"),
    category: varchar("category", { length: 20 }).notNull().default("marketing"),
    /** What the patient will read, with {{1}} for the patient's first name. */
    preview: text("preview").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    unique("message_templates_clinic_id_id_key").on(t.clinicId, t.id),
    uniqueIndex("message_templates_name_idx").on(t.clinicId, t.name, t.language),
    check("message_templates_category_check", sql`${t.category} IN ('utility', 'marketing')`),
  ],
);

export const broadcasts = appSchema.table(
  "broadcasts",
  {
    id: id(),
    clinicId: clinicId().references(() => clinics.id, { onDelete: "restrict" }),
    templateId: uuid("template_id").notNull(),
    title: varchar("title", { length: 200 }).notNull(),
    /** Who it was aimed at (e.g. everyone, or seen in the last N days). */
    audience: jsonb("audience").notNull(),
    recipients: integer("recipients").notNull().default(0),
    excluded: integer("excluded").notNull().default(0),
    status: varchar("status", { length: 20 }).notNull().default("queued"),
    createdBy: uuid("created_by").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("broadcasts_clinic_id_id_key").on(t.clinicId, t.id),
    foreignKey({ name: "broadcasts_template_fk", columns: [t.clinicId, t.templateId], foreignColumns: [messageTemplates.clinicId, messageTemplates.id] }),
    check("broadcasts_status_check", sql`${t.status} IN ('queued', 'sent', 'cancelled')`),
  ],
);

/** The outbox and the record of every message: queued -> sent / failed / skipped. */
export const messageLog = appSchema.table(
  "message_log",
  {
    id: id(),
    clinicId: clinicId(),
    patientId: uuid("patient_id").notNull(),
    kind: varchar("kind", { length: 20 }).notNull(),
    appointmentId: uuid("appointment_id"),
    broadcastId: uuid("broadcast_id"),
    toPhone: varchar("to_phone", { length: 20 }).notNull(),
    template: varchar("template", { length: 100 }).notNull(),
    language: varchar("language", { length: 10 }).notNull(),
    params: jsonb("params").notNull().default([]),
    status: varchar("status", { length: 20 }).notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    providerMessageId: varchar("provider_message_id", { length: 120 }),
    error: varchar("error", { length: 500 }),
    createdAt: createdAt(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
  },
  (t) => [
    foreignKey({ name: "message_log_patient_fk", columns: [t.clinicId, t.patientId], foreignColumns: [patients.clinicId, patients.id] }),
    foreignKey({ name: "message_log_appointment_fk", columns: [t.clinicId, t.appointmentId], foreignColumns: [appointments.clinicId, appointments.id] }),
    foreignKey({ name: "message_log_broadcast_fk", columns: [t.clinicId, t.broadcastId], foreignColumns: [broadcasts.clinicId, broadcasts.id] }),
    // One reminder per appointment, one message per patient per broadcast.
    uniqueIndex("message_log_reminder_idx").on(t.appointmentId).where(sql`${t.kind} = 'reminder'`),
    uniqueIndex("message_log_broadcast_idx").on(t.broadcastId, t.patientId).where(sql`${t.broadcastId} IS NOT NULL`),
    index("message_log_queue_idx").on(t.clinicId, t.status, t.createdAt),
    check("message_log_kind_check", sql`${t.kind} IN ('reminder', 'broadcast', 'test')`),
    check("message_log_status_check", sql`${t.status} IN ('queued', 'sent', 'failed', 'skipped')`),
  ],
);

export const importJobs = appSchema.table(
  "import_jobs",
  {
    id: id(),
    clinicId: clinicId().references(() => clinics.id, { onDelete: "restrict" }),
    fileName: varchar("file_name", { length: 200 }).notNull(),
    rowCount: integer("row_count").notNull(),
    imported: integer("imported").notNull().default(0),
    status: varchar("status", { length: 20 }).notNull(),
    /** Every problem found, by row (the whole file is refused if any). */
    errors: jsonb("errors").notNull().default([]),
    createdBy: uuid("created_by").notNull(),
    createdAt: createdAt(),
  },
  (t) => [check("import_jobs_status_check", sql`${t.status} IN ('rejected', 'imported')`)],
);
