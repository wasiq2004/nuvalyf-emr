import "server-only";

// Shelf labels (docs/PHARMACY_DESIGN.md 4.8): a 3 x 8 sheet on A4 (about
// 65 x 34 mm each, the common 24-up label stock). Each label has the name,
// price, rack, nearest batch and a Code 128 barcode drawn as vector bars, so
// it scans at any printer resolution.
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { BRAND } from "@/lib/brand";
import { bars, isEncodable } from "@/features/pharmacy/code128";
import { A4 } from "./letter";

export type LabelForPdf = {
  name: string;
  strength: string | null;
  form: string;
  barcode: string | null;
  rack: string | null;
  price: string | null;
  packPrice: string | null;
  packSize: number;
  batch: string | null;
  priceUnit: string;
  packUnit: string;
};

const COLS = 3;
const ROWS = 8;
const MARGIN_X = 20;
const MARGIN_Y = 30;
const W = (A4.width - MARGIN_X * 2) / COLS;
const H = (A4.height - MARGIN_Y * 2) / ROWS;
const PAD = 7;
const INK = rgb(0, 0, 0);
const MUTED = rgb(0.35, 0.35, 0.38);
const GUIDE = rgb(0.88, 0.88, 0.9);

/** Text the standard font can draw ("?" otherwise), cut with "..." to fit `width`. */
function fit(text: string, font: PDFFont, size: number, width: number): string {
  const safe = [...text]
    .map((ch) => {
      try {
        font.encodeText(ch);
        return ch;
      } catch {
        return "?";
      }
    })
    .join("");
  if (font.widthOfTextAtSize(safe, size) <= width) return safe;
  let out = safe;
  while (out.length > 1 && font.widthOfTextAtSize(`${out}...`, size) > width) out = out.slice(0, -1);
  return `${out}...`;
}

/**
 * Lines, top to bottom: name | rack; strength · form | batch; MRP; barcode
 * with its digits underneath.
 */
function drawLabel(page: PDFPage, x: number, y: number, label: LabelForPdf, regular: PDFFont, bold: PDFFont, money: (v: string) => string) {
  const inner = W - PAD * 2;
  const left = x + PAD;
  const right = x + W - PAD;
  const rightText = (text: string, baseline: number, size: number, font: PDFFont, color = INK) =>
    page.drawText(text, { x: right - font.widthOfTextAtSize(text, size), y: baseline, size, font, color });
  page.drawRectangle({ x, y, width: W, height: H, borderColor: GUIDE, borderWidth: 0.4 });

  let line = y + H - PAD - 9;
  const rack = label.rack ? fit(label.rack, bold, 8, 40) : null;
  page.drawText(fit(label.name, bold, 9, inner - (rack ? bold.widthOfTextAtSize(rack, 8) + 6 : 0)), { x: left, y: line, size: 9, font: bold, color: INK });
  if (rack) rightText(rack, line, 8, bold);

  line -= 10;
  const batch = label.batch ? fit(label.batch, regular, 6.5, 80) : null;
  const sub = [label.strength, label.form].filter(Boolean).join(" · ");
  if (sub) page.drawText(fit(sub, regular, 7, inner - (batch ? regular.widthOfTextAtSize(batch, 6.5) + 6 : 0)), { x: left, y: line, size: 7, font: regular, color: MUTED });
  if (batch) rightText(batch, line, 6.5, regular, MUTED);

  line -= 10;
  const prices = [label.price ? `${money(label.price)} / ${label.priceUnit}` : null, label.packSize > 1 && label.packPrice ? `${money(label.packPrice)} / ${label.packUnit}` : null]
    .filter(Boolean)
    .join("   ");
  if (prices) page.drawText(fit(`MRP ${prices}`, bold, 7.5, inner), { x: left, y: line, size: 7.5, font: bold, color: INK });

  if (label.barcode && isEncodable(label.barcode)) {
    const code = bars(label.barcode);
    const unit = Math.min(1.2, inner / code.width);
    const start = left + (inner - code.width * unit) / 2;
    const barBottom = y + PAD + 9;
    const barHeight = line - 5 - barBottom;
    for (const [bx, bw] of code.bars) page.drawRectangle({ x: start + bx * unit, y: barBottom, width: bw * unit, height: barHeight, color: INK });
    const digits = fit(label.barcode, regular, 6.5, inner);
    page.drawText(digits, { x: left + (inner - regular.widthOfTextAtSize(digits, 6.5)) / 2, y: y + PAD + 1, size: 6.5, font: regular, color: INK });
  }
}

export async function renderLabelsPdf(labels: LabelForPdf[], meta: { clinicName: string }, money: (v: string) => string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle("Shelf labels");
  doc.setAuthor(meta.clinicName);
  doc.setProducer(BRAND.name);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let page: PDFPage | null = null;
  labels.forEach((label, i) => {
    const slot = i % (COLS * ROWS);
    if (slot === 0) page = doc.addPage([A4.width, A4.height]);
    const col = slot % COLS;
    const row = Math.floor(slot / COLS);
    drawLabel(page!, MARGIN_X + col * W, A4.height - MARGIN_Y - (row + 1) * H, label, regular, bold, money);
  });
  if (labels.length === 0) doc.addPage([A4.width, A4.height]);
  return doc.save();
}
