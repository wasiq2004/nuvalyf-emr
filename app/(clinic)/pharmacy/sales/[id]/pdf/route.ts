// GET /pharmacy/sales/:id/pdf -> the tax invoice, bill of supply or receipt.
import { z } from "zod";
import { can, getClinicSession, hasModule, setupPending } from "@/lib/auth/clinic-session";
import { withClinic } from "@/lib/db";
import { getSale } from "@/features/pharmacy/sales.service";
import { pdfResponse, pharmacyPdfContext } from "@/features/pharmacy/pdf-context";
import { renderSalePdf } from "@/lib/pdf/sale-pdf";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const state = await getClinicSession();
  if (state.status !== "ok") return new Response("Sign in first.", { status: 401 });
  const ctx = state.ctx;
  if (setupPending(ctx) || !hasModule(ctx, "pharmacy") || !(can(ctx, "pharmacy:sell") || can(ctx, "pharmacy:dispense"))) {
    return new Response("Not allowed.", { status: 403 });
  }
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return new Response("Not found", { status: 404 });
  const data = await withClinic({ clinicId: ctx.clinicId, userId: ctx.userId }, async (tx) => {
    const sale = await getSale(tx, id);
    return sale ? { sale, context: await pharmacyPdfContext(tx, ctx.clinicId) } : null;
  });
  if (!data) return new Response("Not found", { status: 404 });
  const { sale, context } = data;
  return pdfResponse(await renderSalePdf(sale, context.letterhead, context.identity, context.currency, context.timezone), sale.number);
}
