// GET /pharmacy/reports/export?view=&section=&from=&to=&month= -> one report
// section as CSV, exactly as on screen. The export is audited; the Schedule
// register names patients, so it is recorded as a warning.
import { can, getClinicSession, hasModule, recordDenied, setupPending } from "@/lib/auth/clinic-session";
import { recordAudit } from "@/lib/audit";
import { withClinic } from "@/lib/db";
import { getRequestMeta } from "@/lib/request";
import { todayInTimeZone } from "@/lib/time";
import { csvCell } from "@/features/audit/audit-rules";
import { getPharmacySettings } from "@/features/pharmacy/settings.service";
import { buildReport, parseReportParams, type Cell } from "@/features/pharmacy/report-views";

const NUMBER = /^-?\d+(\.\d+)?$/;
/** Plain numbers stay numbers (a leading minus is not a formula); the rest is escaped. */
const cell = (v: Cell | undefined) => (typeof v === "number" || (typeof v === "string" && NUMBER.test(v)) ? String(v) : csvCell(v ?? ""));

export async function GET(request: Request) {
  const state = await getClinicSession();
  if (state.status !== "ok") return new Response("Sign in first.", { status: 401 });
  const ctx = state.ctx;
  if (setupPending(ctx) || !hasModule(ctx, "pharmacy")) return new Response("Not allowed.", { status: 403 });
  if (!can(ctx, "pharmacy:reports")) {
    await recordDenied(ctx, "PAGE_ACCESS_DENIED", { required: "pharmacy:reports", path: "/pharmacy/reports/export" });
    return new Response("Not allowed.", { status: 403 });
  }
  const sp = Object.fromEntries(new URL(request.url).searchParams.entries());
  const p = parseReportParams(sp, todayInTimeZone(ctx.timezone));
  const meta = await getRequestMeta();

  const found = await withClinic({ clinicId: ctx.clinicId, userId: ctx.userId }, async (tx) => {
    const sections = await buildReport(tx, p, ctx.timezone, await getPharmacySettings(tx, ctx.clinicId));
    const s = sections.find((x) => x.key === sp.section) ?? sections[0]!;
    await recordAudit(tx, {
      clinicId: ctx.clinicId,
      actorUserId: ctx.userId,
      action: "PHARMACY_REPORT_EXPORTED",
      targetType: "pharmacy_report",
      severity: p.view === "register" ? "warning" : "info",
      details: { view: p.view, section: s.key, from: p.fromDate, to: p.toDate, month: p.month, rows: s.rows.length },
      meta,
    });
    return s;
  });

  const period = p.view === "gstr1" || p.view === "gstr3b" ? p.month : `${p.fromDate}-to-${p.toDate}`;
  const lines = [
    found.columns.map((c) => csvCell(c.label || c.key)).join(","),
    ...found.rows.map((r) => found.columns.map((c) => cell(r[c.key])).join(",")),
    ...(found.totals ? [found.columns.map((c) => cell(found.totals![c.key])).join(",")] : []),
  ];
  return new Response(`﻿${lines.join("\r\n")}\r\n`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="pharmacy-${p.view}-${found.key}-${period}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
