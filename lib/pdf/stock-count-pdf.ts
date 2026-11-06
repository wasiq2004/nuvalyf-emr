import "server-only";

// The count sheet: what to count, rack by rack, with empty boxes to write in.
// It never prints what the system expects.
import { formatDate } from "@/lib/format";
import { Letter, MARGIN, MUTED, type Letterhead } from "./letter";

export type CountSheet = {
  number: string;
  scopeLabel: string;
  createdAt: Date;
  lines: { name: string; rack: string | null; schedule: string; packSize: number; batchNo: string; expiryDate: string }[];
};

const ROW = 22;

export async function renderCountSheetPdf(sheet: CountSheet, clinic: Letterhead, timezone: string): Promise<Uint8Array> {
  const pdf = await Letter.create({ title: `Stock count ${sheet.number}`, author: clinic.name });
  pdf.letterhead(clinic);
  pdf.text(`STOCK COUNT ${sheet.number}`, { size: 14, font: pdf.bold, gap: 4 });
  pdf.text(`${sheet.scopeLabel} · started ${formatDate(sheet.createdAt, timezone)} · ${sheet.lines.length} batches`, { size: 9, color: MUTED, gap: 3 });
  pdf.text("Count what is on the shelf, in single units. Note anything on the shelf that is not listed here.", { size: 9, color: MUTED, gap: 3 });
  pdf.text("Counted by: ______________________     Date and time: ______________________", { size: 9, gap: 8 });

  const columns = { rack: MARGIN, item: MARGIN + 54, batch: MARGIN + 262, expiry: MARGIN + 342, count: MARGIN + 398, recount: MARGIN + 456 };
  const box = 50;

  const header = () => {
    pdf.ensure(ROW * 2);
    const y = pdf.y - 8;
    const style = { size: 8, font: pdf.bold, color: MUTED };
    pdf.page.drawText("RACK", { x: columns.rack, y, ...style });
    pdf.page.drawText("ITEM", { x: columns.item, y, ...style });
    pdf.page.drawText("BATCH", { x: columns.batch, y, ...style });
    pdf.page.drawText("EXPIRY", { x: columns.expiry, y, ...style });
    pdf.page.drawText("COUNT", { x: columns.count, y, ...style });
    pdf.page.drawText("RECOUNT", { x: columns.recount, y, ...style });
    pdf.y -= 12;
    pdf.rule(4);
  };

  header();
  let page = pdf.page;
  for (const line of sheet.lines) {
    pdf.ensure(ROW);
    if (pdf.page !== page) {
      page = pdf.page;
      header();
      page = pdf.page;
    }
    const y = pdf.y - 14;
    const name = [line.name, line.packSize > 1 ? `(${line.packSize} per pack)` : null, line.schedule === "H1" || line.schedule === "X" ? `[${line.schedule}]` : null].filter(Boolean).join(" ");
    pdf.page.drawText(fit(pdf, line.rack ?? "-", 48), { x: columns.rack, y, size: 9, font: pdf.regular });
    pdf.page.drawText(fit(pdf, name, 200), { x: columns.item, y, size: 9, font: pdf.regular });
    pdf.page.drawText(fit(pdf, line.batchNo, 74), { x: columns.batch, y, size: 9, font: pdf.regular });
    pdf.page.drawText(line.expiryDate.slice(0, 7), { x: columns.expiry, y, size: 9, font: pdf.regular });
    for (const x of [columns.count, columns.recount]) {
      pdf.page.drawRectangle({ x, y: y - 5, width: box, height: 17, borderWidth: 0.6, borderColor: MUTED });
    }
    pdf.y -= ROW;
  }
  return pdf.finish(clinic.footerText ?? null, sheet.number);
}

/** Cuts text to a width, so a long name cannot run into the next column. */
function fit(pdf: Letter, text: string, width: number): string {
  let safe = pdf.safe(text);
  while (safe.length > 3 && pdf.regular.widthOfTextAtSize(safe, 9) > width) safe = safe.slice(0, -1);
  return safe;
}
