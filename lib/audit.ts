import "server-only";

import type { Queryable } from "@/lib/db";
import { auditEvents, platformAuditEvents } from "@/lib/db/schema";
import type { RequestMeta } from "@/lib/request";

export type AuditOutcome = "success" | "denied" | "error";
export type AuditSeverity = "info" | "warning" | "critical";

export type ClinicAuditEvent = {
  clinicId: string;
  actorUserId?: string | null;
  action: string;
  targetType?: string;
  targetId?: string | null;
  patientId?: string | null;
  outcome?: AuditOutcome;
  severity?: AuditSeverity;
  details?: Record<string, unknown>;
  meta?: RequestMeta;
};

/**
 * Records a clinic audit event. Call it inside the same transaction as the
 * change it describes, so the record and the change succeed or fail together.
 */
export async function recordAudit(tx: Queryable, event: ClinicAuditEvent) {
  await tx.insert(auditEvents).values({
    clinicId: event.clinicId,
    actorUserId: event.actorUserId ?? null,
    action: event.action,
    targetType: event.targetType ?? null,
    targetId: event.targetId ?? null,
    patientId: event.patientId ?? null,
    outcome: event.outcome ?? "success",
    severity: event.severity ?? (event.outcome === "denied" ? "warning" : "info"),
    details: event.details ?? null,
    ipAddress: event.meta?.ipAddress ?? null,
    userAgent: event.meta?.userAgent ?? null,
  });
}

export type PlatformAuditEvent = {
  operatorId?: string | null;
  action: string;
  targetType?: string;
  targetId?: string | null;
  outcome?: AuditOutcome;
  details?: Record<string, unknown>;
  meta?: RequestMeta;
};

export async function recordPlatformAudit(db: Queryable, event: PlatformAuditEvent) {
  await db.insert(platformAuditEvents).values({
    operatorId: event.operatorId ?? null,
    action: event.action,
    targetType: event.targetType ?? null,
    targetId: event.targetId ?? null,
    outcome: event.outcome ?? "success",
    details: event.details ?? null,
    ipAddress: event.meta?.ipAddress ?? null,
  });
}
