// GET /pharmacy/returns/:id/pdf -> the credit note.
import { z } from "zod";
import { can, getClinicSession, hasModule, setupPending } from "@/lib/auth/clinic-session";
import { withClinic } from "@/lib/db";
import { getSaleReturn } from "@/features/pharmacy/returns.service";
import { pdfResponse, pharmacyPdfContext } from "@/features/pharmacy/pdf-context";
import { renderCreditNotePdf } from "@/lib/pdf/sale-pdf";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const state = await getClinicSession();
  if (state.status !== "ok") return new Response("Sign in first.", { status: 401 });
  const ctx = state.ctx;
  if (setupPending(ctx) || !hasModule(ctx, "pharmacy") || !(can(ctx, "pharmacy:sell") || can(ctx, "pharmacy:dispense") || can(ctx, "pharmacy:return"))) {
    return new Response("Not allowed.", { status: 403 });
  }
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return new Response("Not found", { status: 404 });
  const data = await withClinic({ clinicId: ctx.clinicId, userId: ctx.userId }, async (tx) => {
    const note = await getSaleReturn(tx, id);
    return note ? { note, context: await pharmacyPdfContext(tx, ctx.clinicId) } : null;
  });
  if (!data) return new Response("Not found", { status: 404 });
  const { note, context } = data;
  return pdfResponse(await renderCreditNotePdf(note, context.letterhead, context.identity, context.currency, context.timezone), note.number);
}
