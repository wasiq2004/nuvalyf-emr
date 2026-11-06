import "server-only";

// Puts a report's supporting documents after it in the same PDF, so one print
// is the whole report. A PDF keeps its own pages; a photo gets an A4 page. Every
// added page names the patient, because printed pages get separated. A document
// that cannot be added gets a page saying so, and never stops the report.
import { PDFDocument, StandardFonts, degrees, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { jpegOrientation } from "@/features/clinical/lab-document-rules";
import { A4, MARGIN } from "./letter";

export type PrintableDocument = { name: string; contentType: string; content: Buffer | null };

const MUTED = rgb(0.42, 0.42, 0.46);

/** Standard fonts cover Latin-1 only; anything else prints as "?". */
function latin(text: string, font: PDFFont) {
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

function fit(text: string, font: PDFFont, size: number, width: number) {
  if (font.widthOfTextAtSize(text, size) <= width) return text;
  let cut = text;
  while (cut.length > 1 && font.widthOfTextAtSize(`${cut}...`, size) > width) cut = cut.slice(0, -1);
  return `${cut}...`;
}

function stamp(page: PDFPage, label: string, font: PDFFont) {
  page.drawText(fit(latin(label, font), font, 7, page.getWidth() - 40), { x: 20, y: 10, size: 7, font, color: MUTED });
}

async function drawImage(doc: PDFDocument, page: PDFPage, document: PrintableDocument, font: PDFFont) {
  const isJpeg = document.contentType === "image/jpeg";
  const image = isJpeg ? await doc.embedJpg(document.content!) : await doc.embedPng(document.content!);
  const orientation = isJpeg ? jpegOrientation(document.content!) : 1;
  const sideways = orientation >= 5;

  page.drawText(fit(latin(document.name, font), font, 9, A4.width - MARGIN * 2), { x: MARGIN, y: A4.height - MARGIN + 12, size: 9, font, color: MUTED });
  const box = { width: A4.width - MARGIN * 2, height: A4.height - MARGIN * 2 };
  const scale = Math.min(box.width / (sideways ? image.height : image.width), box.height / (sideways ? image.width : image.height), 1);
  const [width, height] = [image.width * scale, image.height * scale];
  const [shownWidth, shownHeight] = sideways ? [height, width] : [width, height];
  const left = (A4.width - shownWidth) / 2;
  const bottom = A4.height - MARGIN - shownHeight;

  // pdf-lib turns an image about its lower-left corner.
  if (orientation === 3 || orientation === 4) page.drawImage(image, { x: left + width, y: bottom + height, width, height, rotate: degrees(180) });
  else if (orientation === 6 || orientation === 5) page.drawImage(image, { x: left, y: bottom + width, width, height, rotate: degrees(-90) });
  else if (orientation === 8 || orientation === 7) page.drawImage(image, { x: left + height, y: bottom, width, height, rotate: degrees(90) });
  else page.drawImage(image, { x: left, y: bottom, width, height });
}

function missingPage(doc: PDFDocument, name: string, font: PDFFont) {
  const page = doc.addPage([A4.width, A4.height]);
  page.drawText(fit(latin(name, font), font, 12, A4.width - MARGIN * 2), { x: MARGIN, y: A4.height - MARGIN - 12, size: 12, font });
  page.drawText("This document could not be printed with the report.", { x: MARGIN, y: A4.height - MARGIN - 34, size: 10, font });
  page.drawText("Open it from the patient's record.", { x: MARGIN, y: A4.height - MARGIN - 48, size: 10, font });
  return page;
}

export async function appendDocuments(report: Uint8Array, documents: PrintableDocument[], reference: string): Promise<Uint8Array> {
  if (documents.length === 0) return report;
  const doc = await PDFDocument.load(report);
  const font = await doc.embedFont(StandardFonts.Helvetica);

  for (const [index, document] of documents.entries()) {
    const label = `${reference} · Attachment ${index + 1} of ${documents.length}: ${document.name}`;
    let added: PDFPage[];
    try {
      if (!document.content) throw new Error("Not included");
      if (document.contentType === "application/pdf") {
        const source = await PDFDocument.load(document.content);
        added = (await doc.copyPages(source, source.getPageIndices())).map((page) => doc.addPage(page));
      } else {
        const page = doc.addPage([A4.width, A4.height]);
        added = [page];
        try {
          await drawImage(doc, page, document, font);
        } catch (error) {
          doc.removePage(doc.getPageCount() - 1);
          throw error;
        }
      }
    } catch {
      added = [missingPage(doc, document.name, font)];
    }
    for (const page of added) stamp(page, label, font);
  }
  return doc.save();
}
