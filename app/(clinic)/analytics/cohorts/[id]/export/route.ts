// GET /analytics/cohorts/:id/export -> pseudonymous cohort CSV with the
// definition, version and column list in a header block. Refused for cohorts
// below the suppression threshold. Every export is recorded and audited.
import { z } from "zod";
import { can, getClinicSession, hasModule, recordDenied } from "@/lib/auth/clinic-session";
import { recordAudit } from "@/lib/audit";
import { withClinic } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { getRequestMeta } from "@/lib/request";
import { exportCohort, minCell } from "@/features/analytics/analytics.service";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const state = await getClinicSession();
  if (state.status !== "ok") return new Response("Sign in first.", { status: 401 });
  const ctx = state.ctx;
  if (ctx.mustChangePassword || !hasModule(ctx, "analytics")) return new Response("Not allowed.", { status: 403 });
  if (!can(ctx, "analytics:manage")) {
    await recordDenied(ctx, "PAGE_ACCESS_DENIED", { required: "analytics:manage", path: "/analytics/cohorts/[id]/export" });
    return new Response("Not allowed.", { status: 403 });
  }
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return new Response("Not found", { status: 404 });
  const meta = await getRequestMeta();

  try {
    const file = await withClinic({ clinicId: ctx.clinicId, userId: ctx.userId }, async (tx) => {
      const result = await exportCohort(tx, ctx.clinicId, id, ctx.userId, await minCell(tx, ctx.clinicId), new Date());
      await recordAudit(tx, {
        clinicId: ctx.clinicId,
        actorUserId: ctx.userId,
        action: "ANALYTICS_EXPORTED",
        targetType: "cohort",
        targetId: id,
        severity: "warning",
        details: { version: result.version, rows: result.rows },
        meta,
      });
      return result;
    });
    const safeName = file.name.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "cohort";
    return new Response(`﻿${file.csv}`, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${safeName}-v${file.version}.csv"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    if (error instanceof AppError) return new Response(error.message, { status: 422 });
    throw error;
  }
}
