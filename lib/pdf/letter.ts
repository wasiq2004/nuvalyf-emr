import "server-only";

// A4 documents on the clinic letterhead (prescriptions, invoices). Standard
// PDF fonts only, so text is mapped to what they can draw.
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import { BRAND } from "@/lib/brand";

export const A4 = { width: 595.28, height: 841.89 };
export const MARGIN = 50;
export const INK = rgb(0.1, 0.1, 0.12);
export const MUTED = rgb(0.42, 0.42, 0.46);
/** NuvaLyf brand teal (#0b7a78), as in globals.css. */
export const ACCENT = rgb(11 / 255, 122 / 255, 120 / 255);
const RULE = rgb(0.85, 0.86, 0.88);

export type Letterhead = {
  name: string;
  addressLine: string | null;
  city: string | null;
  phone: string | null;
  email: string | null;
  letterheadText: string | null;
  footerText: string | null;
};

type TextOptions = { size?: number; font?: PDFFont; color?: RGB; x?: number; width?: number; gap?: number };

export class Letter {
  readonly contentWidth = A4.width - MARGIN * 2;
  page!: PDFPage;
  y = 0;

  private constructor(
    readonly doc: PDFDocument,
    readonly regular: PDFFont,
    readonly bold: PDFFont,
  ) {
    this.addPage();
  }

  static async create(meta: { title: string; author: string }) {
    const doc = await PDFDocument.create();
    doc.setTitle(meta.title);
    doc.setAuthor(meta.author);
    doc.setProducer(BRAND.name);
    const regular = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    return new Letter(doc, regular, bold);
  }

  private addPage() {
    this.page = this.doc.addPage([A4.width, A4.height]);
    this.y = A4.height - MARGIN;
  }

  /** The standard fonts only cover Latin-1; anything else becomes "?". */
  safe(text: string, font: PDFFont = this.regular): string {
    return [...text]
      .map((ch) => {
        try {
          font.encodeText(ch);
          return ch;
        } catch {
          return "?";
        }
      })
      .join("");
  }

  wrap(text: string, size: number, width: number, font: PDFFont = this.regular): string[] {
    const lines: string[] = [];
    for (const paragraph of this.safe(text, font).split(/\r?\n/)) {
      let line = "";
      for (const word of paragraph.split(/\s+/)) {
        const candidate = line ? `${line} ${word}` : word;
        if (font.widthOfTextAtSize(candidate, size) <= width) line = candidate;
        else {
          if (line) lines.push(line);
          line = word;
        }
      }
      lines.push(line);
    }
    return lines;
  }

  /** Starts a new page if fewer than `needed` points remain. */
  ensure(needed: number) {
    if (this.y - needed < MARGIN + 40) this.addPage();
  }

  text(value: string, opts: TextOptions = {}) {
    const size = opts.size ?? 10;
    const font = opts.font ?? this.regular;
    const x = opts.x ?? MARGIN;
    for (const line of this.wrap(value, size, opts.width ?? this.contentWidth - (x - MARGIN), font)) {
      this.ensure(size + 4);
      this.page.drawText(line, { x, y: this.y - size, size, font, color: opts.color ?? INK });
      this.y -= size + (opts.gap ?? 4);
    }
  }

  /** Right-aligned text at a given baseline (does not move the cursor). */
  right(value: string, baseline: number, opts: { size?: number; font?: PDFFont; color?: RGB; rightEdge?: number } = {}) {
    const size = opts.size ?? 10;
    const font = opts.font ?? this.regular;
    const safe = this.safe(value, font);
    const width = font.widthOfTextAtSize(safe, size);
    this.page.drawText(safe, { x: (opts.rightEdge ?? A4.width - MARGIN) - width, y: baseline, size, font, color: opts.color ?? INK });
  }

  rule(space = 10) {
    this.y -= space / 2;
    this.page.drawLine({ start: { x: MARGIN, y: this.y }, end: { x: A4.width - MARGIN, y: this.y }, thickness: 0.8, color: RULE });
    this.y -= space / 2;
  }

  letterhead(clinic: Letterhead) {
    this.text(clinic.name, { size: 18, font: this.bold, color: ACCENT });
    const address = [clinic.addressLine, clinic.city].filter(Boolean).join(", ");
    if (address) this.text(address, { size: 9, color: MUTED });
    const contact = [clinic.phone, clinic.email].filter(Boolean).join("  ·  ");
    if (contact) this.text(contact, { size: 9, color: MUTED });
    if (clinic.letterheadText) this.text(clinic.letterheadText, { size: 9, color: MUTED });
    this.rule(16);
  }

  /** Footer on every page: the clinic's footer text, a reference, page numbers. */
  async finish(footerText: string | null, reference: string): Promise<Uint8Array> {
    const pages = this.doc.getPages();
    pages.forEach((p, i) => {
      const footer = [footerText, `Ref ${reference}`, pages.length > 1 ? `Page ${i + 1} of ${pages.length}` : null].filter(Boolean).join("   ·   ");
      this.wrap(footer, 7.5, this.contentWidth).forEach((line, j) => {
        p.drawText(line, { x: MARGIN, y: MARGIN - 10 - j * 10, size: 7.5, font: this.regular, color: MUTED });
      });
    });
    return this.doc.save();
  }
}
