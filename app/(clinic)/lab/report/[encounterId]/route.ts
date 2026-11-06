// GET /lab/report/:encounterId -> the printable lab report for a consultation.
import { z } from "zod";
import { can, getClinicSession, hasModule, recordDenied } from "@/lib/auth/clinic-session";
import { recordAudit } from "@/lib/audit";
import { withClinic } from "@/lib/db";
import { getRequestMeta } from "@/lib/request";
import { todayInTimeZone } from "@/lib/time";
import { labReport } from "@/features/clinical/lab.service";
import { pdfResponse, pharmacyPdfContext } from "@/features/pharmacy/pdf-context";
import { renderLabReportPdf } from "@/lib/pdf/lab-report-pdf";

export async function GET(_request: Request, { params }: { params: Promise<{ encounterId: string }> }) {
  const state = await getClinicSession();
  if (state.status !== "ok") return new Response("Sign in first.", { status: 401 });
  const ctx = state.ctx;
  if (ctx.mustChangePassword || !hasModule(ctx, "lab")) return new Response("Not allowed.", { status: 403 });
  if (!can(ctx, "lab:result") && !can(ctx, "encounter:read")) {
    await recordDenied(ctx, "PAGE_ACCESS_DENIED", { required: ["lab:result", "encounter:read"], path: "/lab/report/[encounterId]" });
    return new Response("Not allowed.", { status: 403 });
  }
  const { encounterId } = await params;
  if (!z.uuid().safeParse(encounterId).success) return new Response("Not found", { status: 404 });
  const meta = await getRequestMeta();
  const data = await withClinic({ clinicId: ctx.clinicId, userId: ctx.userId }, async (tx) => {
    const report = await labReport(tx, encounterId, todayInTimeZone(ctx.timezone));
    if (!report) return null;
    await recordAudit(tx, { clinicId: ctx.clinicId, actorUserId: ctx.userId, action: "LAB_REPORT_PRINTED", targetType: "encounter", targetId: encounterId, patientId: report.patientId, meta });
    return { report, context: await pharmacyPdfContext(tx, ctx.clinicId) };
  });
  if (!data) return new Response("No results to report yet.", { status: 404 });
  return pdfResponse(await renderLabReportPdf(data.report, data.context.letterhead, data.context.timezone), `lab-report-${data.report.patient.mrn}`);
}
