// GET /billing/:id/pdf -> the invoice (or receipt, once paid) as a PDF.
import { z } from "zod";
import { can, getClinicSession, recordDenied } from "@/lib/auth/clinic-session";
import { recordAudit } from "@/lib/audit";
import { withClinic } from "@/lib/db";
import { getRequestMeta } from "@/lib/request";
import { getInvoice } from "@/features/billing/billing.service";
import { getClinicSettings } from "@/features/settings/settings.service";
import { renderInvoicePdf } from "@/lib/pdf/invoice-pdf";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const state = await getClinicSession();
  if (state.status !== "ok") return new Response("Sign in to view this invoice.", { status: 401 });
  const ctx = state.ctx;
  if (ctx.mustChangePassword) return new Response("Change your password first.", { status: 403 });
  if (!can(ctx, "billing:read")) {
    await recordDenied(ctx, "PAGE_ACCESS_DENIED", { required: "billing:read", path: "/billing/[id]/pdf" });
    return new Response("You don't have permission to view invoices.", { status: 403 });
  }

  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return new Response("Not found", { status: 404 });
  const meta = await getRequestMeta();

  const data = await withClinic({ clinicId: ctx.clinicId, userId: ctx.userId }, async (tx) => {
    const invoice = await getInvoice(tx, id);
    if (!invoice || invoice.status === "draft") return null;
    await recordAudit(tx, {
      clinicId: ctx.clinicId,
      actorUserId: ctx.userId,
      action: "INVOICE_PRINTED",
      targetType: "invoice",
      targetId: id,
      patientId: invoice.patientId,
      meta,
    });
    return { invoice, settings: await getClinicSettings(tx, ctx.clinicId) };
  });
  if (!data) return new Response("No issued invoice here.", { status: 404 });

  const { invoice, settings } = data;
  const pdf = await renderInvoicePdf(
    invoice,
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
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${invoice.number}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
