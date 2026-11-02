// GET /pharmacy/purchases/returns/:id/pdf -> the debit note for the supplier.
import { z } from "zod";
import { can, getClinicSession, hasModule } from "@/lib/auth/clinic-session";
import { withClinic } from "@/lib/db";
import { getPurchaseReturn } from "@/features/pharmacy/supplier-accounts.service";
import { pdfResponse, pharmacyPdfContext } from "@/features/pharmacy/pdf-context";
import { renderDebitNotePdf } from "@/lib/pdf/sale-pdf";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const state = await getClinicSession();
  if (state.status !== "ok") return new Response("Sign in first.", { status: 401 });
  const ctx = state.ctx;
  if (ctx.mustChangePassword || !hasModule(ctx, "pharmacy") || !(can(ctx, "stock:manage") || can(ctx, "purchase:create") || can(ctx, "accounts:manage"))) {
    return new Response("Not allowed.", { status: 403 });
  }
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return new Response("Not found", { status: 404 });
  const data = await withClinic({ clinicId: ctx.clinicId, userId: ctx.userId }, async (tx) => {
    const note = await getPurchaseReturn(tx, id);
    return note ? { note, context: await pharmacyPdfContext(tx, ctx.clinicId) } : null;
  });
  if (!data) return new Response("Not found", { status: 404 });
  const { note, context } = data;
  return pdfResponse(await renderDebitNotePdf(note, context.letterhead, context.identity, context.currency, context.timezone), note.number);
}
