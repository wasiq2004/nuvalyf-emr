// GET /lab/report/:encounterId -> the printable lab report for a consultation.
import { z } from "zod";
import { can, getClinicSession, hasModule, recordDenied, setupPending } from "@/lib/auth/clinic-session";
import { recordAudit } from "@/lib/audit";
import { withClinic } from "@/lib/db";
import { getRequestMeta } from "@/lib/request";
import { todayInTimeZone } from "@/lib/time";
import { documentsToPrint } from "@/features/clinical/lab-document-rules";
import { labDocumentContents } from "@/features/clinical/lab-documents.service";
import { labReport } from "@/features/clinical/lab.service";
import { pdfResponse, pharmacyPdfContext } from "@/features/pharmacy/pdf-context";
import { appendDocuments } from "@/lib/pdf/attachments";
import { renderLabReportPdf } from "@/lib/pdf/lab-report-pdf";

export async function GET(_request: Request, { params }: { params: Promise<{ encounterId: string }> }) {
  const state = await getClinicSession();
  if (state.status !== "ok") return new Response("Sign in first.", { status: 401 });
  const ctx = state.ctx;
  if (setupPending(ctx) || !hasModule(ctx, "lab")) return new Response("Not allowed.", { status: 403 });
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
    const documents = report.tests.flatMap((t) => t.documents);
    const contents = await labDocumentContents(tx, documentsToPrint(documents).map((d) => d.id));
    return { report, documents, contents, context: await pharmacyPdfContext(tx, ctx.clinicId) };
  });
  if (!data) return new Response("No results to report yet.", { status: 404 });
  const { mrn, name } = data.report.patient;
  const report = await renderLabReportPdf(data.report, data.context.letterhead, data.context.timezone);
  const printable = data.documents.map((d) => ({ name: d.name, contentType: d.contentType, content: data.contents.get(d.id) ?? null }));
  return pdfResponse(await appendDocuments(report, printable, `${name} ${mrn}`), `lab-report-${mrn}`);
}
