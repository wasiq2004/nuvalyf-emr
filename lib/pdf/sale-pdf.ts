import "server-only";

// Pharmacy receipt on the clinic letterhead: batch and expiry per line, as
// pharmacy records require.
import { formatDate, formatDateTime } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { PAYMENT_METHOD_LABELS, type PaymentMethod } from "@/features/billing/billing-rules";
import { ACCENT, Letter, MARGIN, MUTED, type Letterhead } from "./letter";

export type SaleForPdf = {
  number: string;
  soldAt: Date;
  soldByName: string;
  customer: string;
  total: string;
  method: string;
  reference: string | null;
  prescriptionId: string | null;
  items: { description: string; batchNo: string; expiryDate: string; quantity: number; unitPrice: string; amount: string }[];
};

export async function renderSalePdf(sale: SaleForPdf, clinic: Letterhead, currency: string, timezone: string): Promise<Uint8Array> {
  const pdf = await Letter.create({ title: `Pharmacy receipt ${sale.number}`, author: clinic.name });
  const money = (v: string) => formatMoney(v, currency).replace(/₹/g, "Rs. ");
  pdf.letterhead(clinic);

  pdf.right(sale.number, pdf.y - 14, { size: 12, font: pdf.bold });
  pdf.right(formatDateTime(sale.soldAt, timezone), pdf.y - 28, { size: 9, color: MUTED });
  pdf.text("PHARMACY RECEIPT", { size: 16, font: pdf.bold, color: ACCENT, gap: 6 });
  pdf.text(sale.customer, { size: 11, font: pdf.bold });
  pdf.text(sale.prescriptionId ? "Against a prescription" : "Counter sale", { size: 9, color: MUTED });
  pdf.rule(18);

  const qtyX = MARGIN + 290;
  const priceEdge = MARGIN + 400;
  const amountEdge = MARGIN + pdf.contentWidth;
  const header = pdf.y - 9;
  pdf.page.drawText("Medicine / batch", { x: MARGIN, y: header, size: 8.5, font: pdf.bold, color: MUTED });
  pdf.page.drawText("Qty", { x: qtyX, y: header, size: 8.5, font: pdf.bold, color: MUTED });
  pdf.right("Price", header, { size: 8.5, font: pdf.bold, color: MUTED, rightEdge: priceEdge });
  pdf.right("Amount", header, { size: 8.5, font: pdf.bold, color: MUTED, rightEdge: amountEdge });
  pdf.y -= 16;
  for (const item of sale.items) {
    pdf.ensure(28);
    const baseline = pdf.y - 10;
    pdf.text(item.description, { size: 10, width: 270, gap: 2 });
    pdf.text(`Batch ${item.batchNo} · Exp ${formatDate(item.expiryDate, "UTC")}`, { size: 8, color: MUTED, gap: 4 });
    pdf.page.drawText(String(item.quantity), { x: qtyX, y: baseline, size: 10, font: pdf.regular });
    pdf.right(money(item.unitPrice), baseline, { size: 10, rightEdge: priceEdge });
    pdf.right(money(item.amount), baseline, { size: 10, rightEdge: amountEdge });
    pdf.y -= 2;
  }
  pdf.rule(12);
  const baseline = pdf.y - 11;
  pdf.right("Total paid", baseline, { size: 11, font: pdf.bold, rightEdge: priceEdge });
  pdf.right(money(sale.total), baseline, { size: 11, font: pdf.bold, rightEdge: amountEdge });
  pdf.y -= 20;
  pdf.right(
    `${PAYMENT_METHOD_LABELS[sale.method as PaymentMethod] ?? sale.method}${sale.reference ? ` (${sale.reference})` : ""} · served by ${sale.soldByName}`,
    pdf.y - 9,
    { size: 9, color: MUTED },
  );
  pdf.y -= 16;

  return pdf.finish(clinic.footerText, sale.number);
}
