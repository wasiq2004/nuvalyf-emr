import "server-only";

import { db } from "@/lib/db";
import { auditLogs } from "@/lib/db/schema";
import { getClientIp } from "@/lib/request";

export interface LogAuditParams {
  userId?: string | null;
  action: string;
  resource: string;
  resourceId?: string | null;
  details?: string | null;
  /** Defaults to the current request's client IP. */
  ipAddress?: string | null;
}

/** Records an audit event. Never throws - auditing must not break the request. */
export async function logAuditAction(params: LogAuditParams) {
  try {
    const ipAddress = params.ipAddress !== undefined ? params.ipAddress : await getClientIp();
    await db.insert(auditLogs).values({
      userId: params.userId ?? null,
      action: params.action,
      resource: params.resource,
      resourceId: params.resourceId ?? null,
      details: params.details ?? null,
      ipAddress,
    });
  } catch (error) {
    console.error("[audit] failed to write audit log:", error);
  }
}
