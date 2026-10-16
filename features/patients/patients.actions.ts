"use server";

import { z } from "zod";
import { clinicAction } from "@/lib/auth/actions";
import { AppError } from "@/lib/errors";
import { idField, optionalId, optionalPhone, requiredText } from "@/lib/validation";
import { todayInTimeZone } from "@/lib/time";
import { identitySchema, patientSchema, sexField } from "./patient.schema";
import { issueDuplicateToken, verifyDuplicateToken } from "./duplicate-token";
import { admitEmergency, findDuplicateCandidates, registerPatient, searchPatients, updatePatient } from "./patients.service";

export const searchPatientsAction = clinicAction(
  { name: "patients.search", permission: "patient:read", schema: z.object({ q: z.string().trim().max(100).default("") }) },
  async ({ session, db, audit }, input) =>
    db(async (tx) => {
      const results = await searchPatients(tx, input.q, todayInTimeZone(session.timezone), 15);
      if (input.q) await audit(tx, { action: "PATIENT_SEARCH", details: { query: input.q, results: results.length } });
      return results;
    }),
);

function tokenSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set");
  return secret;
}

/**
 * Step 1 of registration: search for existing records. Returns candidates and
 * a signed token that registration requires.
 */
export const searchDuplicatesAction = clinicAction(
  { name: "patients.searchDuplicates", permission: "patient:write", schema: identitySchema },
  async ({ session, db }, input) => {
    const today = todayInTimeZone(session.timezone);
    const candidates = await db((tx) => findDuplicateCandidates(tx, input, today));
    const token = issueDuplicateToken(
      { clinicId: session.clinicId, userId: session.userId, fields: input, likelyIds: candidates.filter((c) => c.likely).map((c) => c.id) },
      tokenSecret(),
    );
    return {
      token,
      candidates: candidates.map((c) => ({
        id: c.id,
        mrn: c.mrn,
        name: c.name,
        age: c.age,
        mobile: c.mobile,
        likely: c.likely,
        reasons: c.reasons,
      })),
    };
  },
);

const TOKEN_ERRORS = {
  missing: "Search for existing patients before registering.",
  invalid: "Search for existing patients before registering.",
  expired: "The duplicate search has expired. Search again before registering.",
  mismatch: "The details changed since the duplicate search. Search again before registering.",
} as const;

export const registerPatientAction = clinicAction(
  {
    name: "patients.register",
    permission: "patient:write",
    schema: patientSchema.and(z.object({ duplicateToken: z.string().optional(), overrideReason: z.string().trim().max(1000).optional() })),
  },
  async ({ session, db, audit }, input) => {
    const check = verifyDuplicateToken(
      input.duplicateToken,
      { clinicId: session.clinicId, userId: session.userId, fields: input },
      tokenSecret(),
    );
    if (!check.ok) throw new AppError(TOKEN_ERRORS[check.reason]);

    const today = todayInTimeZone(session.timezone);
    return db(async (tx) => {
      const patient = await registerPatient(tx, session.clinicId, input, {
        likelyIds: check.likelyIds,
        reason: input.overrideReason,
        actorId: session.userId,
        today,
      });
      await audit(tx, { action: "PATIENT_REGISTERED", targetType: "patient", targetId: patient.id, patientId: patient.id });
      if (check.likelyIds.length > 0) {
        await audit(tx, {
          action: "DUPLICATE_WARNING_OVERRIDDEN",
          targetType: "patient",
          targetId: patient.id,
          patientId: patient.id,
          severity: "warning",
          details: { candidates: check.likelyIds, reason: input.overrideReason },
        });
      }
      return patient;
    });
  },
);

export const updatePatientAction = clinicAction(
  { name: "patients.update", permission: "patient:write", schema: patientSchema.and(z.object({ id: idField })) },
  async ({ session, db, audit }, input) => {
    const today = todayInTimeZone(session.timezone);
    await db(async (tx) => {
      const { wasPlaceholder } = await updatePatient(tx, input.id, input, session.userId, today);
      await audit(tx, {
        action: wasPlaceholder ? "EMERGENCY_RECORD_COMPLETED" : "PATIENT_UPDATED",
        targetType: "patient",
        targetId: input.id,
        patientId: input.id,
      });
    });
  },
);

export const admitEmergencyAction = clinicAction(
  {
    name: "patients.admitEmergency",
    permission: "emergency:admit",
    schema: z.object({
      label: requiredText(200, "A description"),
      sex: sexField.optional(),
      approxAge: z
        .union([z.literal(""), z.coerce.number().int().min(0).max(130)])
        .optional()
        .transform((v) => (v === "" || v === undefined ? undefined : v)),
      companionPhone: optionalPhone,
      doctorId: optionalId,
    }),
  },
  async ({ session, db, audit }, input) => {
    const today = todayInTimeZone(session.timezone);
    return db(async (tx) => {
      const result = await admitEmergency(tx, session.clinicId, input, session.userId, today);
      await audit(tx, {
        action: "EMERGENCY_ADMITTED",
        targetType: "visit",
        targetId: result.visitId,
        patientId: result.patientId,
        severity: "warning",
        details: { label: input.label },
      });
      return result;
    });
  },
);
