// GET /pharmacy/stock/counts/:id/sheet -> the printed count sheet (no system figures).
import { z } from "zod";
import { can, getClinicSession, hasModule, setupPending } from "@/lib/auth/clinic-session";
import { withClinic } from "@/lib/db";
import { blindLines, getCountHeader } from "@/features/pharmacy/stock-count.service";
import { pdfResponse, pharmacyPdfContext } from "@/features/pharmacy/pdf-context";
import { renderCountSheetPdf } from "@/lib/pdf/stock-count-pdf";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const state = await getClinicSession();
  if (state.status !== "ok") return new Response("Sign in first.", { status: 401 });
  const ctx = state.ctx;
  if (setupPending(ctx) || !hasModule(ctx, "pharmacy") || !can(ctx, "stock:manage")) return new Response("Not allowed.", { status: 403 });
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return new Response("Not found", { status: 404 });
  const data = await withClinic({ clinicId: ctx.clinicId, userId: ctx.userId }, async (tx) => {
    const count = await getCountHeader(tx, id);
    return count ? { count, lines: await blindLines(tx, id), context: await pharmacyPdfContext(tx, ctx.clinicId) } : null;
  });
  if (!data) return new Response("Not found", { status: 404 });
  const { count, lines, context } = data;
  return pdfResponse(await renderCountSheetPdf({ number: count.number, scopeLabel: count.scopeLabel, createdAt: count.createdAt, lines }, context.letterhead, context.timezone), count.number);
}
