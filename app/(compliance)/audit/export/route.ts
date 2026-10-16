// GET /audit/export?<filters> -> the filtered audit trail as CSV (up to 10,000
// rows). The export itself is audited, with the filters used.
import { can, getClinicSession, recordDenied } from "@/lib/auth/clinic-session";
import { recordAudit } from "@/lib/audit";
import { withClinic } from "@/lib/db";
import { getRequestMeta } from "@/lib/request";
import { addDaysToDateString, todayInTimeZone, zonedTimeToUtc } from "@/lib/time";
import { csvCell, parseFilters } from "@/features/audit/audit-rules";
import { searchAudit, type AuditRow } from "@/features/audit/audit.service";

const MAX_ROWS = 10_000;

export async function GET(request: Request) {
  const state = await getClinicSession();
  if (state.status !== "ok") return new Response("Sign in first.", { status: 401 });
  const ctx = state.ctx;
  if (ctx.mustChangePassword) return new Response("Change your password first.", { status: 403 });
  if (!can(ctx, "audit:read")) {
    await recordDenied(ctx, "PAGE_ACCESS_DENIED", { required: "audit:read", path: "/audit/export" });
    return new Response("Not allowed.", { status: 403 });
  }

  const params = Object.fromEntries(new URL(request.url).searchParams.entries());
  const today = todayInTimeZone(ctx.timezone);
  const filters = parseFilters(params, today, addDaysToDateString);
  const range = { from: zonedTimeToUtc(filters.from, "00:00", ctx.timezone), to: zonedTimeToUtc(addDaysToDateString(filters.to, 1), "00:00", ctx.timezone) };
  const meta = await getRequestMeta();

  const rows = await withClinic({ clinicId: ctx.clinicId, userId: ctx.userId }, async (tx) => {
    const all: AuditRow[] = [];
    let cursor: string | null = null;
    do {
      const page = await searchAudit(tx, filters, range, cursor, 1000);
      all.push(...page.rows);
      cursor = page.nextCursor;
    } while (cursor && all.length < MAX_ROWS);
    await recordAudit(tx, {
      clinicId: ctx.clinicId,
      actorUserId: ctx.userId,
      action: "AUDIT_EXPORTED",
      targetType: "audit",
      severity: "warning",
      details: { ...filters, rows: Math.min(all.length, MAX_ROWS) },
      meta,
    });
    return all.slice(0, MAX_ROWS);
  });

  const header = ["time_utc", "person", "event", "category", "outcome", "severity", "patient_record_no", "target_type", "target_id", "ip_address", "details"];
  const lines = rows.map((r) =>
    [r.createdAt.toISOString(), r.actorName, r.action, r.category, r.outcome, r.severity, r.patientMrn, r.targetType, r.targetId, r.ipAddress, r.details].map(csvCell).join(","),
  );
  const body = [header.join(","), ...lines].join("\r\n");
  return new Response(`﻿${body}\r\n`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="audit-${filters.from}-to-${filters.to}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
