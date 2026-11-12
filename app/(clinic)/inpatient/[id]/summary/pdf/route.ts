// GET /inpatient/:id/summary/pdf -> the discharge summary.
import { z } from "zod";
import { can, getClinicSession, hasModule, setupPending } from "@/lib/auth/clinic-session";
import { recordAudit } from "@/lib/audit";
import { withClinic } from "@/lib/db";
import { getRequestMeta } from "@/lib/request";
import { todayInTimeZone } from "@/lib/time";
import { admissionBill, getAdmission } from "@/features/inpatient/inpatient.service";
import { getSummary } from "@/features/inpatient/summary.service";
import { pdfResponse, pharmacyPdfContext } from "@/features/pharmacy/pdf-context";
import { renderDischargeSummaryPdf } from "@/lib/pdf/inpatient-pdf";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const state = await getClinicSession();
  if (state.status !== "ok") return new Response("Sign in first.", { status: 401 });
  const ctx = state.ctx;
  if (setupPending(ctx) || !hasModule(ctx, "inpatient") || !can(ctx, "inpatient:read")) return new Response("Not allowed.", { status: 403 });
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return new Response("Not found", { status: 404 });
  const meta = await getRequestMeta();
  const data = await withClinic({ clinicId: ctx.clinicId, userId: ctx.userId }, async (tx) => {
    const admission = await getAdmission(tx, id, todayInTimeZone(ctx.timezone));
    const summary = await getSummary(tx, id);
    if (!admission || !summary) return null;
    await recordAudit(tx, { clinicId: ctx.clinicId, actorUserId: ctx.userId, action: "CONSULTATION_DISCHARGE_PRINTED", targetType: "admission", targetId: id, patientId: admission.patientId, meta });
    return { admission, summary, bill: (await admissionBill(tx, id))!, context: await pharmacyPdfContext(tx, ctx.clinicId) };
  });
  if (!data) return new Response("No summary yet.", { status: 404 });
  return pdfResponse(await renderDischargeSummaryPdf(data.admission, data.summary, data.bill, data.context), `discharge-${data.admission.number}`);
}
