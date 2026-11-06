// GET /lab/documents/:id -> one attached document, opened in the browser. The
// type is the one worked out from the file at upload, so nothing else can be
// served from here, and every opening is on the audit trail.
import { z } from "zod";
import { can, getClinicSession, hasModule, recordDenied } from "@/lib/auth/clinic-session";
import { recordAudit } from "@/lib/audit";
import { withClinic } from "@/lib/db";
import { getRequestMeta } from "@/lib/request";
import { inlineDisposition } from "@/features/clinical/lab-document-rules";
import { labDocumentForViewing } from "@/features/clinical/lab-documents.service";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const state = await getClinicSession();
  if (state.status !== "ok") return new Response("Sign in first.", { status: 401 });
  const ctx = state.ctx;
  if (ctx.mustChangePassword || !hasModule(ctx, "lab")) return new Response("Not allowed.", { status: 403 });
  if (!can(ctx, "lab:result") && !can(ctx, "encounter:read")) {
    await recordDenied(ctx, "PAGE_ACCESS_DENIED", { required: ["lab:result", "encounter:read"], path: "/lab/documents/[id]" });
    return new Response("Not allowed.", { status: 403 });
  }
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return new Response("Not found", { status: 404 });
  const meta = await getRequestMeta();
  const row = await withClinic({ clinicId: ctx.clinicId, userId: ctx.userId }, async (tx) => {
    const found = await labDocumentForViewing(tx, id);
    if (found) await recordAudit(tx, { clinicId: ctx.clinicId, actorUserId: ctx.userId, action: "LAB_DOCUMENT_VIEWED", targetType: "lab_document", targetId: id, patientId: found.document.patientId, meta });
    return found;
  });
  if (!row) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(row.content), {
    headers: { "Content-Type": row.document.contentType, "Content-Disposition": inlineDisposition(row.document.fileName), "Cache-Control": "private, no-store" },
  });
}
