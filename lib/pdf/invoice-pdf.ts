import "server-only";

// Invoice / receipt PDF on the clinic letterhead.
import { formatDate, formatDateTime } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { PAYMENT_METHOD_LABELS, type PaymentMethod } from "@/features/billing/billing-rules";
import { ACCENT, Letter, MARGIN, MUTED, type Letterhead } from "./letter";

export type InvoiceForPdf = {
  number: string;
  status: string;
  createdAt: Date;
  issuedAt: Date | null;
  subtotal: string;
  discount: string;
  discountReason: string | null;
  total: string;
  amountPaid: string;
  balance: string;
  patient: { name: string; mrn: string; mobile: string | null };
  items: { description: string; quantity: number; unitPrice: string; amount: string }[];
  payments: { kind: string; amount: string; method: string; reference: string | null; receivedAt: Date }[];
};

export async function renderInvoicePdf(invoice: InvoiceForPdf, clinic: Letterhead, currency: string, timezone: string): Promise<Uint8Array> {
  const pdf = await Letter.create({ title: `Invoice ${invoice.number}`, author: clinic.name });
  const money = (v: string) => formatMoney(v, currency).replace(/₹/g, "Rs. ");
  pdf.letterhead(clinic);

  const heading = invoice.status === "void" ? "VOID INVOICE" : Number(invoice.balance) === 0 && Number(invoice.total) > 0 ? "RECEIPT" : "INVOICE";
  pdf.right(`${invoice.number}`, pdf.y - 14, { size: 12, font: pdf.bold });
  pdf.right(formatDate(invoice.issuedAt ?? invoice.createdAt, timezone), pdf.y - 28, { size: 9, color: MUTED });
  pdf.text(heading, { size: 16, font: pdf.bold, color: ACCENT, gap: 6 });
  pdf.text(invoice.patient.name, { size: 11, font: pdf.bold });
  pdf.text(`Record ${invoice.patient.mrn}${invoice.patient.mobile ? `   ·   ${invoice.patient.mobile}` : ""}`, { size: 9, color: MUTED });
  pdf.rule(18);

  // Lines
  const qtyX = MARGIN + 300;
  const priceEdge = MARGIN + 400;
  const amountEdge = MARGIN + pdf.contentWidth;
  const header = pdf.y - 9;
  pdf.page.drawText("Description", { x: MARGIN, y: header, size: 8.5, font: pdf.bold, color: MUTED });
  pdf.page.drawText("Qty", { x: qtyX, y: header, size: 8.5, font: pdf.bold, color: MUTED });
  pdf.right("Price", header, { size: 8.5, font: pdf.bold, color: MUTED, rightEdge: priceEdge });
  pdf.right("Amount", header, { size: 8.5, font: pdf.bold, color: MUTED, rightEdge: amountEdge });
  pdf.y -= 16;
  for (const item of invoice.items) {
    pdf.ensure(18);
    const top = pdf.y;
    pdf.text(item.description, { size: 10, width: 280, gap: 3 });
    const baseline = top - 10;
    pdf.page.drawText(String(item.quantity), { x: qtyX, y: baseline, size: 10, font: pdf.regular });
    pdf.right(money(item.unitPrice), baseline, { size: 10, rightEdge: priceEdge });
    pdf.right(money(item.amount), baseline, { size: 10, rightEdge: amountEdge });
    pdf.y -= 4;
  }
  pdf.rule(12);

  const row = (label: string, value: string, bold = false) => {
    pdf.ensure(16);
    const baseline = pdf.y - 10;
    pdf.right(label, baseline, { size: 10, font: bold ? pdf.bold : pdf.regular, color: bold ? undefined : MUTED, rightEdge: priceEdge });
    pdf.right(value, baseline, { size: 10, font: bold ? pdf.bold : pdf.regular, rightEdge: amountEdge });
    pdf.y -= 16;
  };
  row("Subtotal", money(invoice.subtotal));
  if (Number(invoice.discount) > 0) row(`Discount${invoice.discountReason ? ` (${invoice.discountReason})` : ""}`, `- ${money(invoice.discount)}`);
  row("Total", money(invoice.total), true);
  row("Paid", money(invoice.amountPaid));
  row("Balance due", money(invoice.balance), true);

  if (invoice.payments.length) {
    pdf.y -= 10;
    pdf.text("Payments", { size: 10, font: pdf.bold });
    for (const p of invoice.payments) {
      const label = `${formatDateTime(p.receivedAt, timezone)}   ${p.kind === "refund" ? "Refund" : "Paid"} by ${PAYMENT_METHOD_LABELS[p.method as PaymentMethod] ?? p.method}${p.reference ? ` (${p.reference})` : ""}`;
      pdf.ensure(14);
      const baseline = pdf.y - 9;
      pdf.text(label, { size: 9, color: MUTED, gap: 3 });
      pdf.right(`${p.kind === "refund" ? "- " : ""}${money(p.amount)}`, baseline, { size: 9, rightEdge: amountEdge });
    }
  }

  return pdf.finish(clinic.footerText, invoice.number);
}
