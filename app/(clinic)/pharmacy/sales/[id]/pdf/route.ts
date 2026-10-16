// GET /pharmacy/sales/:id/pdf -> the pharmacy receipt.
import { z } from "zod";
import { can, getClinicSession, hasModule } from "@/lib/auth/clinic-session";
import { withClinic } from "@/lib/db";
import { getSale } from "@/features/pharmacy/sales.service";
import { getClinicSettings } from "@/features/settings/settings.service";
import { renderSalePdf } from "@/lib/pdf/sale-pdf";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const state = await getClinicSession();
  if (state.status !== "ok") return new Response("Sign in first.", { status: 401 });
  const ctx = state.ctx;
  if (ctx.mustChangePassword || !hasModule(ctx, "pharmacy") || !(can(ctx, "pharmacy:sell") || can(ctx, "pharmacy:dispense"))) {
    return new Response("Not allowed.", { status: 403 });
  }
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return new Response("Not found", { status: 404 });
  const data = await withClinic({ clinicId: ctx.clinicId, userId: ctx.userId }, async (tx) => {
    const sale = await getSale(tx, id);
    return sale ? { sale, settings: await getClinicSettings(tx, ctx.clinicId) } : null;
  });
  if (!data) return new Response("Not found", { status: 404 });
  const { sale, settings } = data;
  const pdf = await renderSalePdf(
    sale,
    {
      name: settings.displayName,
      addressLine: settings.addressLine,
      city: settings.city,
      phone: settings.phone,
      email: settings.email,
      letterheadText: settings.letterheadText,
      footerText: settings.footerText,
    },
    settings.currency,
    settings.timezone,
  );
  return new Response(Buffer.from(pdf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${sale.number}.pdf"`, "Cache-Control": "private, no-store" },
  });
}
