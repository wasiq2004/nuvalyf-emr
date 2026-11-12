// GET /pharmacy/stock/labels/pdf?items=<id>.<copies>,... -> a sheet of shelf labels.
import { z } from "zod";
import { can, getClinicSession, hasModule, setupPending } from "@/lib/auth/clinic-session";
import { withClinic } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { todayInTimeZone } from "@/lib/time";
import { getClinicSettings } from "@/features/settings/settings.service";
import { labelItems } from "@/features/pharmacy/labels.service";
import { packWord, unitWord } from "@/features/pharmacy/selling-rules";
import { pdfResponse } from "@/features/pharmacy/pdf-context";
import { renderLabelsPdf } from "@/lib/pdf/labels-pdf";

const MAX_ITEMS = 150;
const MAX_LABELS = 480;

export async function GET(request: Request) {
  const state = await getClinicSession();
  if (state.status !== "ok") return new Response("Sign in first.", { status: 401 });
  const ctx = state.ctx;
  if (setupPending(ctx) || !hasModule(ctx, "pharmacy") || !can(ctx, "stock:manage")) return new Response("Not allowed.", { status: 403 });

  const copies = new Map<string, number>();
  for (const part of (new URL(request.url).searchParams.get("items") ?? "").split(",").slice(0, MAX_ITEMS)) {
    const [id, n] = part.split(".");
    if (!id || !z.uuid().safeParse(id).success) continue;
    copies.set(id, Math.min(50, Math.max(1, Math.floor(Number(n) || 1))));
  }
  if (copies.size === 0) return new Response("Choose the items to label.", { status: 400 });

  const data = await withClinic({ clinicId: ctx.clinicId, userId: ctx.userId }, async (tx) => ({
    items: await labelItems(tx, [...copies.keys()], todayInTimeZone(ctx.timezone)),
    settings: await getClinicSettings(tx, ctx.clinicId),
  }));
  const labels = data.items
    .flatMap((item) =>
      Array.from({ length: copies.get(item.id) ?? 1 }, () => ({
        ...item,
        priceUnit: unitWord(item.form),
        packUnit: packWord(item.form),
      })),
    )
    .slice(0, MAX_LABELS);
  const money = (v: string) => formatMoney(v, data.settings.currency).replace(/₹/g, "Rs.");
  return pdfResponse(await renderLabelsPdf(labels, { clinicName: data.settings.displayName }, money), "shelf-labels");
}
