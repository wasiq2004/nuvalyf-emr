import "server-only";

// WhatsApp configuration, templates, broadcasts, reminders and the send loop.
//
// message_log is the outbox: broadcasts and reminders insert "queued" rows;
// processQueue() sends them. Consent is checked twice - when the audience is
// built and again for every single message at the moment it is sent - so a
// patient who withdraws after a broadcast was queued is still not messaged.
import { and, asc, desc, eq, gte, lt, sql } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import { appointments, broadcasts, clinicSettings, messageLog, messageTemplates, patients, users, visits, whatsappConfig } from "@/lib/db/schema";
import { AppError } from "@/lib/errors";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { idempotent } from "@/lib/idempotency";
import { formatDateTime } from "@/lib/format";
import { sendTemplate, type SendResult } from "@/lib/messaging/whatsapp";
import { staffName } from "@/features/clinical/encounters.service";
import { currentConsent, hasConsentSql } from "./consent.service";
import { MAX_SEND_ATTEMPTS, toWhatsAppNumber, type Audience, type ConsentType } from "./messaging-rules";

// ---------------------------------------------------------------------------
// Configuration and templates
// ---------------------------------------------------------------------------

export async function getConfig(tx: Tx, clinicId: string) {
  const [row] = await tx.select().from(whatsappConfig).where(eq(whatsappConfig.clinicId, clinicId)).limit(1);
  if (!row) return null;
  const { accessTokenEncrypted, ...rest } = row;
  return { ...rest, hasToken: Boolean(accessTokenEncrypted) };
}

export type ConfigInput = {
  phoneNumberId?: string;
  businessAccountId?: string;
  displayPhone?: string;
  accessToken?: string;
  enabled: boolean;
  remindersEnabled: boolean;
  reminderHoursBefore: number;
  reminderTemplate: string;
  templateLanguage: string;
};

export async function saveConfig(tx: Tx, clinicId: string, input: ConfigInput, actorId: string) {
  const values = {
    phoneNumberId: input.phoneNumberId ?? null,
    businessAccountId: input.businessAccountId ?? null,
    displayPhone: input.displayPhone ?? null,
    enabled: input.enabled,
    remindersEnabled: input.remindersEnabled,
    reminderHoursBefore: input.reminderHoursBefore,
    reminderTemplate: input.reminderTemplate,
    templateLanguage: input.templateLanguage,
    updatedBy: actorId,
    updatedAt: new Date(),
    // A blank token field keeps the stored one.
    ...(input.accessToken ? { accessTokenEncrypted: encryptSecret(input.accessToken) } : {}),
  };
  const existing = await getConfig(tx, clinicId);
  if (input.enabled && (!input.phoneNumberId || (!input.accessToken && !existing?.hasToken))) {
    throw new AppError("Add the phone number ID and access token before switching messaging on.");
  }
  await tx.insert(whatsappConfig).values({ clinicId, ...values }).onConflictDoUpdate({ target: whatsappConfig.clinicId, set: values });
}

async function credentials(tx: Tx, clinicId: string) {
  const [row] = await tx.select().from(whatsappConfig).where(eq(whatsappConfig.clinicId, clinicId)).limit(1);
  if (!row?.enabled || !row.phoneNumberId || !row.accessTokenEncrypted) return null;
  return { config: row, phoneNumberId: row.phoneNumberId, accessToken: decryptSecret(row.accessTokenEncrypted) };
}

export function listTemplates(tx: Tx) {
  return tx.select().from(messageTemplates).orderBy(desc(messageTemplates.isActive), asc(messageTemplates.name));
}

export async function saveTemplate(
  tx: Tx,
  clinicId: string,
  id: string | null,
  input: { name: string; language: string; category: "utility" | "marketing"; preview: string; isActive: boolean },
) {
  if (id) {
    const [row] = await tx.update(messageTemplates).set(input).where(eq(messageTemplates.id, id)).returning({ id: messageTemplates.id });
    if (!row) throw new AppError("Template not found.");
    return row;
  }
  const [row] = await tx.insert(messageTemplates).values({ clinicId, ...input }).returning({ id: messageTemplates.id });
  return row;
}

// ---------------------------------------------------------------------------
// Audiences and broadcasts
// ---------------------------------------------------------------------------

function audienceSql(audience: Audience, today: string) {
  if (audience.kind === "all") return sql`${patients.isPlaceholder} = false`;
  const since = new Date(Date.parse(`${today}T00:00:00Z`) - audience.days * 86_400_000).toISOString().slice(0, 10);
  return sql`${patients.isPlaceholder} = false and exists (
    select 1 from ${visits} v where v.patient_id = ${patients.id} and v.status = 'completed' and v.visit_date >= ${since}
  )`;
}

/** How many patients the audience covers, and why some are left out. */
export async function previewAudience(tx: Tx, audience: Audience, today: string) {
  const [row] = await tx
    .select({
      matched: sql<number>`count(*)::int`,
      consenting: sql<number>`count(*) filter (where ${hasConsentSql("whatsapp_broadcasts")})::int`,
      reachable: sql<number>`count(*) filter (where ${hasConsentSql("whatsapp_broadcasts")} and coalesce(${patients.mobile}, '') <> '')::int`,
    })
    .from(patients)
    .where(audienceSql(audience, today));
  const matched = row?.matched ?? 0;
  const consenting = row?.consenting ?? 0;
  const reachable = row?.reachable ?? 0;
  return { matched, recipients: reachable, noConsent: matched - consenting, noMobile: consenting - reachable };
}

/** Queues one message per consenting patient with a mobile. Idempotent. */
export async function createBroadcast(
  tx: Tx,
  clinicId: string,
  input: { templateId: string; title: string; audience: Audience; idempotencyKey: string },
  actorId: string,
  today: string,
) {
  const { idempotencyKey, ...request } = input;
  return idempotent(tx, { clinicId, name: "broadcast", key: idempotencyKey, input: request }, async () => {
    const config = await getConfig(tx, clinicId);
    if (!config?.enabled) throw new AppError("WhatsApp messaging is not switched on for this clinic.");
    const [template] = await tx
      .select()
      .from(messageTemplates)
      .where(and(eq(messageTemplates.id, input.templateId), eq(messageTemplates.isActive, true)))
      .limit(1);
    if (!template) throw new AppError("Choose an active template.");

    const preview = await previewAudience(tx, input.audience, today);
    if (preview.recipients === 0) throw new AppError("Nobody in this audience has agreed to receive WhatsApp updates.");

    const recipients = await tx
      .select({ id: patients.id, firstName: patients.firstName, mobile: patients.mobile })
      .from(patients)
      .where(and(audienceSql(input.audience, today), hasConsentSql("whatsapp_broadcasts"), sql`coalesce(${patients.mobile}, '') <> ''`));

    const [broadcast] = await tx
      .insert(broadcasts)
      .values({
        clinicId,
        templateId: template.id,
        title: input.title,
        audience: input.audience,
        recipients: 0,
        excluded: preview.matched,
        createdBy: actorId,
      })
      .returning({ id: broadcasts.id });

    const rows = recipients.flatMap((p) => {
      const to = toWhatsAppNumber(p.mobile);
      return to
        ? [{ clinicId, patientId: p.id, kind: "broadcast", broadcastId: broadcast.id, toPhone: to, template: template.name, language: template.language, params: [p.firstName ?? ""] }]
        : [];
    });
    for (let i = 0; i < rows.length; i += 500) await tx.insert(messageLog).values(rows.slice(i, i + 500));
    await tx
      .update(broadcasts)
      .set({ recipients: rows.length, excluded: preview.matched - rows.length })
      .where(eq(broadcasts.id, broadcast.id));
    return { broadcastId: broadcast.id, recipients: rows.length, excluded: preview.matched - rows.length };
  });
}

export async function listBroadcasts(tx: Tx) {
  const rows = await tx
    .select({
      broadcast: broadcasts,
      template: messageTemplates.name,
      title: users.title,
      firstName: users.firstName,
      lastName: users.lastName,
      sent: sql<number>`(select count(*) from ${messageLog} m where m.broadcast_id = ${broadcasts.id} and m.status = 'sent')::int`,
      failed: sql<number>`(select count(*) from ${messageLog} m where m.broadcast_id = ${broadcasts.id} and m.status in ('failed', 'skipped'))::int`,
      queued: sql<number>`(select count(*) from ${messageLog} m where m.broadcast_id = ${broadcasts.id} and m.status = 'queued')::int`,
    })
    .from(broadcasts)
    .innerJoin(messageTemplates, eq(messageTemplates.id, broadcasts.templateId))
    .innerJoin(users, eq(users.id, broadcasts.createdBy))
    .orderBy(desc(broadcasts.createdAt))
    .limit(100);
  return rows.map((r) => ({ ...r.broadcast, template: r.template, createdByName: staffName(r), sent: r.sent, failed: r.failed, queued: r.queued }));
}

// ---------------------------------------------------------------------------
// Reminders and sending (run by the worker)
// ---------------------------------------------------------------------------

/** Queues a reminder for every upcoming appointment inside the reminder window. */
export async function enqueueDueReminders(tx: Tx, clinicId: string, now: Date) {
  const [config] = await tx.select().from(whatsappConfig).where(eq(whatsappConfig.clinicId, clinicId)).limit(1);
  if (!config?.enabled || !config.remindersEnabled) return 0;
  const [settings] = await tx.select().from(clinicSettings).where(eq(clinicSettings.clinicId, clinicId)).limit(1);
  const windowEnd = new Date(now.getTime() + config.reminderHoursBefore * 3_600_000);

  const due = await tx
    .select({ appointment: appointments, patient: patients, title: users.title, firstName: users.firstName, lastName: users.lastName })
    .from(appointments)
    .innerJoin(patients, eq(patients.id, appointments.patientId))
    .innerJoin(users, eq(users.id, appointments.doctorId))
    .where(
      and(
        eq(appointments.status, "booked"),
        gte(appointments.startsAt, now),
        lt(appointments.startsAt, windowEnd),
        hasConsentSql("whatsapp_reminders"),
        sql`not exists (select 1 from ${messageLog} m where m.appointment_id = ${appointments.id} and m.kind = 'reminder')`,
      ),
    );

  let queued = 0;
  for (const row of due) {
    const to = toWhatsAppNumber(row.patient.mobile);
    if (!to) continue;
    const inserted = await tx
      .insert(messageLog)
      .values({
        clinicId,
        patientId: row.patient.id,
        kind: "reminder",
        appointmentId: row.appointment.id,
        toPhone: to,
        template: config.reminderTemplate,
        language: config.templateLanguage,
        params: [
          row.patient.firstName ?? "",
          formatDateTime(row.appointment.startsAt, settings?.timezone ?? "UTC"),
          staffName(row),
          settings?.displayName ?? "",
        ],
      })
      .onConflictDoNothing()
      .returning({ id: messageLog.id });
    queued += inserted.length;
  }
  return queued;
}

export type Sender = (credentials: { phoneNumberId: string; accessToken: string }, message: { to: string; template: string; language: string; params: string[] }) => Promise<SendResult>;

/** Sends queued messages for one clinic. Each is re-checked against consent first. */
export async function processQueue(tx: Tx, clinicId: string, sender: Sender = sendTemplate, limit = 50) {
  const creds = await credentials(tx, clinicId);
  if (!creds) return { sent: 0, failed: 0, skipped: 0 };

  const batch = await tx
    .select()
    .from(messageLog)
    .where(eq(messageLog.status, "queued"))
    .orderBy(asc(messageLog.createdAt))
    .limit(limit)
    .for("update", { skipLocked: true });
  if (batch.length === 0) return { sent: 0, failed: 0, skipped: 0 };

  const consentFor = async (type: ConsentType) => currentConsent(tx, type, batch.map((m) => m.patientId));
  const reminders = await consentFor("whatsapp_reminders");
  const broadcastsConsent = await consentFor("whatsapp_broadcasts");
  const stats = { sent: 0, failed: 0, skipped: 0 };

  for (const message of batch) {
    const consented = message.kind === "reminder" ? reminders.get(message.patientId) : message.kind === "broadcast" ? broadcastsConsent.get(message.patientId) : true;
    if (!consented) {
      await tx.update(messageLog).set({ status: "skipped", error: "No consent at the time of sending" }).where(eq(messageLog.id, message.id));
      stats.skipped += 1;
      continue;
    }
    if (message.kind === "reminder" && message.appointmentId) {
      const [appointment] = await tx.select({ status: appointments.status }).from(appointments).where(eq(appointments.id, message.appointmentId)).limit(1);
      if (appointment?.status !== "booked") {
        await tx.update(messageLog).set({ status: "skipped", error: "Appointment no longer booked" }).where(eq(messageLog.id, message.id));
        stats.skipped += 1;
        continue;
      }
    }
    const result = await sender(creds, { to: message.toPhone, template: message.template, language: message.language, params: message.params as string[] });
    const attempts = message.attempts + 1;
    if (result.ok) {
      await tx.update(messageLog).set({ status: "sent", attempts, providerMessageId: result.providerMessageId, sentAt: new Date(), error: null }).where(eq(messageLog.id, message.id));
      stats.sent += 1;
    } else {
      const giveUp = result.permanent || attempts >= MAX_SEND_ATTEMPTS;
      await tx.update(messageLog).set({ status: giveUp ? "failed" : "queued", attempts, error: result.error.slice(0, 500) }).where(eq(messageLog.id, message.id));
      if (giveUp) stats.failed += 1;
    }
  }

  // Broadcasts with nothing left to send are done.
  await tx.execute(sql`
    update app.broadcasts b set status = 'sent'
    where b.status = 'queued' and not exists (select 1 from app.message_log m where m.broadcast_id = b.id and m.status = 'queued')`);
  return stats;
}

export async function messageStats(tx: Tx, since: Date) {
  const rows = await tx
    .select({ kind: messageLog.kind, status: messageLog.status, n: sql<number>`count(*)::int` })
    .from(messageLog)
    .where(gte(messageLog.createdAt, since))
    .groupBy(messageLog.kind, messageLog.status);
  return rows;
}
