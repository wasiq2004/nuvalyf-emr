"use server";

import { z } from "zod";
import { clinicAction } from "@/lib/auth/actions";
import { booleanField, checkbox, idField, optionalId, optionalText, requiredText } from "@/lib/validation";
import { todayInTimeZone } from "@/lib/time";
import { AppError } from "@/lib/errors";
import { verifyConnection } from "@/lib/messaging/whatsapp";
import { decryptSecret } from "@/lib/crypto";
import { whatsappConfig } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { setConsent } from "./consent.service";
import { createBroadcast, previewAudience, saveConfig, saveTemplate } from "./messaging.service";
import { CONSENT_TYPES } from "./messaging-rules";

// ---------------------------------------------------------------------------
// Consent (front desk)
// ---------------------------------------------------------------------------

export const setConsentAction = clinicAction(
  {
    name: "messaging.setConsent",
    permission: "patient:write",
    schema: z.object({ patientId: idField, type: z.enum(CONSENT_TYPES), granted: booleanField, note: optionalText(300) }),
  },
  async ({ session, db, audit }, input) =>
    db(async (tx) => {
      const result = await setConsent(tx, session.clinicId, { ...input, source: "front_desk" }, session.userId);
      if (result.changed) {
        await audit(tx, {
          action: input.granted ? "CONSENT_GRANTED" : "CONSENT_WITHDRAWN",
          targetType: "patient",
          targetId: input.patientId,
          patientId: input.patientId,
          details: { type: input.type },
        });
      }
      return result;
    }),
);

// ---------------------------------------------------------------------------
// Settings (Clinic Admin)
// ---------------------------------------------------------------------------

export const saveWhatsAppConfigAction = clinicAction(
  {
    name: "messaging.saveConfig",
    permission: "settings:manage",
    module: "whatsapp",
    schema: z.object({
      phoneNumberId: optionalText(40),
      businessAccountId: optionalText(40),
      displayPhone: optionalText(30),
      accessToken: optionalText(1000),
      enabled: checkbox,
      remindersEnabled: checkbox,
      reminderHoursBefore: z.coerce.number({ message: "Enter hours" }).int().min(1, "At least 1 hour").max(72, "At most 72 hours"),
      reminderTemplate: z.string().trim().regex(/^[a-z0-9_]{1,100}$/, "Template names are lowercase letters, numbers and underscores"),
      templateLanguage: z.string().trim().regex(/^[a-z]{2}(_[A-Z]{2})?$/, "Use a code like en or en_US"),
    }),
  },
  async ({ session, db, audit }, input) =>
    db(async (tx) => {
      await saveConfig(tx, session.clinicId, input, session.userId);
      await audit(tx, {
        action: "WHATSAPP_SETTINGS_UPDATED",
        targetType: "whatsapp_config",
        details: { enabled: input.enabled, remindersEnabled: input.remindersEnabled, tokenChanged: Boolean(input.accessToken) },
      });
    }),
);

export const verifyWhatsAppAction = clinicAction(
  { name: "messaging.verify", permission: "settings:manage", module: "whatsapp", schema: z.object({}) },
  async ({ session, db }) =>
    db(async (tx) => {
      const [row] = await tx.select().from(whatsappConfig).where(eq(whatsappConfig.clinicId, session.clinicId)).limit(1);
      if (!row?.phoneNumberId || !row.accessTokenEncrypted) throw new AppError("Save the phone number ID and access token first.");
      return verifyConnection({ phoneNumberId: row.phoneNumberId, accessToken: decryptSecret(row.accessTokenEncrypted) });
    }),
);

export const saveTemplateAction = clinicAction(
  {
    name: "messaging.saveTemplate",
    permission: "settings:manage",
    module: "whatsapp",
    schema: z.object({
      id: optionalId,
      name: z.string().trim().regex(/^[a-z0-9_]{1,100}$/, "Use the exact template name from Meta: lowercase, numbers, underscores"),
      language: z.string().trim().regex(/^[a-z]{2}(_[A-Z]{2})?$/, "Use a code like en or en_US"),
      category: z.enum(["utility", "marketing"]),
      preview: requiredText(1000, "The message text"),
      isActive: checkbox,
    }),
  },
  async ({ session, db, audit }, input) =>
    db(async (tx) => {
      const { id, ...values } = input;
      const row = await saveTemplate(tx, session.clinicId, id, values);
      await audit(tx, { action: id ? "MESSAGE_TEMPLATE_UPDATED" : "MESSAGE_TEMPLATE_ADDED", targetType: "message_template", targetId: row.id, details: { name: input.name } });
      return row;
    }),
);

// ---------------------------------------------------------------------------
// Broadcasts
// ---------------------------------------------------------------------------

const audienceField = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("all") }),
  z.object({ kind: z.literal("seen_within_days"), days: z.coerce.number().int().min(1).max(3650) }),
]);

export const previewAudienceAction = clinicAction(
  { name: "messaging.previewAudience", permission: "broadcast:send", module: "whatsapp", schema: z.object({ audience: audienceField }) },
  async ({ session, db }, input) => db((tx) => previewAudience(tx, input.audience, todayInTimeZone(session.timezone))),
);

export const createBroadcastAction = clinicAction(
  {
    name: "messaging.broadcast",
    permission: "broadcast:send",
    module: "whatsapp",
    schema: z.object({
      templateId: idField,
      title: requiredText(200, "A title"),
      audience: audienceField,
      idempotencyKey: z.string().trim().min(16).max(64),
    }),
  },
  async ({ session, db, audit }, input) =>
    db(async (tx) => {
      const { result, replayed } = await createBroadcast(tx, session.clinicId, input, session.userId, todayInTimeZone(session.timezone));
      if (!replayed) {
        await audit(tx, {
          action: "BROADCAST_QUEUED",
          targetType: "broadcast",
          targetId: result.broadcastId,
          severity: "warning",
          details: { title: input.title, audience: input.audience, recipients: result.recipients, excluded: result.excluded },
        });
      }
      return result;
    }),
);
