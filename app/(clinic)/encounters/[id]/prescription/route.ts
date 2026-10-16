// GET /encounters/:id/prescription -> the signed prescription as a PDF.
// Same rules as the page: a live clinic session with encounter:read, and
// every print is audited.
import { z } from "zod";
import { can, getClinicSession, recordDenied } from "@/lib/auth/clinic-session";
import { recordAudit } from "@/lib/audit";
import { withClinic } from "@/lib/db";
import { getRequestMeta } from "@/lib/request";
import { getSignedPrescription } from "@/features/clinical/prescriptions.service";
import type { SignedPrescriptionSnapshot } from "@/features/clinical/encounters.service";
import { renderPrescriptionPdf } from "@/lib/pdf/prescription-pdf";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const state = await getClinicSession();
  if (state.status !== "ok") return new Response("Sign in to view this prescription.", { status: 401 });
  const ctx = state.ctx;
  if (ctx.mustChangePassword) return new Response("Change your password first.", { status: 403 });
  if (!can(ctx, "encounter:read")) {
    await recordDenied(ctx, "PAGE_ACCESS_DENIED", { required: "encounter:read", path: "/encounters/[id]/prescription" });
    return new Response("You don't have permission to view prescriptions.", { status: 403 });
  }

  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return new Response("Not found", { status: 404 });
  const meta = await getRequestMeta();

  const rx = await withClinic({ clinicId: ctx.clinicId, userId: ctx.userId }, async (tx) => {
    const row = await getSignedPrescription(tx, id);
    if (!row?.signedSnapshot) return null;
    await recordAudit(tx, {
      clinicId: ctx.clinicId,
      actorUserId: ctx.userId,
      action: "PRESCRIPTION_PRINTED",
      targetType: "prescription",
      targetId: row.id,
      patientId: row.patientId,
      meta,
    });
    return row;
  });
  if (!rx) return new Response("No signed prescription for this consultation.", { status: 404 });

  const snapshot = rx.signedSnapshot as SignedPrescriptionSnapshot;
  const pdf = await renderPrescriptionPdf(snapshot, rx.id.slice(0, 8).toUpperCase());
  const filename = `prescription-${snapshot.patient.mrn}-${snapshot.signedAt.slice(0, 10)}.pdf`;
  return new Response(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
