// GET /inpatient/:id/bill -> the interim bill, or the final bill after discharge.
import { z } from "zod";
import { can, getClinicSession, hasModule, setupPending } from "@/lib/auth/clinic-session";
import { withClinic } from "@/lib/db";
import { todayInTimeZone } from "@/lib/time";
import { admissionBill, getAdmission } from "@/features/inpatient/inpatient.service";
import { pdfResponse, pharmacyPdfContext } from "@/features/pharmacy/pdf-context";
import { renderInpatientBillPdf } from "@/lib/pdf/inpatient-pdf";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const state = await getClinicSession();
  if (state.status !== "ok") return new Response("Sign in first.", { status: 401 });
  const ctx = state.ctx;
  if (setupPending(ctx) || !hasModule(ctx, "inpatient") || !can(ctx, "inpatient:read")) return new Response("Not allowed.", { status: 403 });
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return new Response("Not found", { status: 404 });
  const data = await withClinic({ clinicId: ctx.clinicId, userId: ctx.userId }, async (tx) => {
    const admission = await getAdmission(tx, id, todayInTimeZone(ctx.timezone));
    return admission ? { admission, bill: (await admissionBill(tx, id))!, context: await pharmacyPdfContext(tx, ctx.clinicId) } : null;
  });
  if (!data) return new Response("Not found", { status: 404 });
  return pdfResponse(await renderInpatientBillPdf(data.admission, data.bill, data.context), `bill-${data.admission.number}`);
}
