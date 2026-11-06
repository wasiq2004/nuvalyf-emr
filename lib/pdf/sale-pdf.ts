import "server-only";

// Pharmacy documents on the clinic letterhead (docs/PHARMACY_DESIGN.md 4.1-4.3):
// the sale as a tax invoice, bill of supply or cash memo, the credit note for
// a return or cancellation, and the debit note for stock sent back to a
// supplier. Batch and expiry are on every line, as pharmacy records require.
import { formatDate, formatDateTime } from "@/lib/format";
import { formatMoney, fromMinor, toMinor } from "@/lib/money";
import { describeQuantity, unitWord } from "@/features/pharmacy/selling-rules";
import { dosageText } from "@/features/pharmacy/dispensing-rules";
import { ACCENT, Letter, MARGIN, MUTED, type Letterhead } from "./letter";

/** The pharmacy's registration, printed under the letterhead. */
export type PharmacyIdentity = {
  gstin: string | null;
  gstScheme: "regular" | "composition" | "unregistered";
  drugLicence20b: string | null;
  drugLicence21b: string | null;
};

const METHOD_WORDS: Record<string, string> = {
  cash: "cash",
  upi: "UPI",
  card: "card",
  bank: "bank transfer",
  cheque: "cheque",
  other: "other",
  credit: "on account",
  account: "to the customer's account",
};

type Line = {
  description: string;
  batchNo: string;
  expiryDate: string;
  hsn: string | null;
  gstRate: string | null;
  quantity: string;
  rate: string | null;
  amount: string;
  /** How to take it, as dispensed. */
  dosage?: string;
  /** Null on sales from before GST. */
  taxable: string | null;
  cgst: string;
  sgst: string;
  igst: string;
};

type Document = {
  title: string;
  number: string;
  date: string;
  party: { heading: string; lines: string[] };
  references: string[];
  lines: Line[];
  /** split: CGST/SGST/IGST columns; single: one GST column (purchases). */
  tax: "split" | "single" | "none";
  totals: { label: string; value: string; strong?: boolean }[];
  footnotes: string[];
};

async function renderDocument(doc: Document, clinic: Letterhead, pharmacy: PharmacyIdentity, currency: string): Promise<Uint8Array> {
  const pdf = await Letter.create({ title: `${doc.title} ${doc.number}`, author: clinic.name });
  const money = (v: string) => formatMoney(v, currency).replace(/₹/g, "Rs. ");
  pdf.letterhead(clinic);
  const registration = [
    pharmacy.gstin ? `GSTIN ${pharmacy.gstin}` : null,
    pharmacy.drugLicence20b ? `DL 20B ${pharmacy.drugLicence20b}` : null,
    pharmacy.drugLicence21b ? `DL 21B ${pharmacy.drugLicence21b}` : null,
  ].filter((v): v is string => v !== null);
  if (registration.length) {
    pdf.y += 6;
    pdf.text(registration.join("   ·   "), { size: 8.5, color: MUTED, gap: 8 });
  }

  pdf.right(doc.number, pdf.y - 14, { size: 12, font: pdf.bold });
  pdf.right(doc.date, pdf.y - 28, { size: 9, color: MUTED });
  pdf.text(doc.title, { size: 16, font: pdf.bold, color: ACCENT, gap: 6 });
  pdf.text(doc.party.heading, { size: 11, font: pdf.bold, width: 330 });
  for (const line of doc.party.lines) pdf.text(line, { size: 9, color: MUTED, width: 330, gap: 3 });
  for (const line of doc.references) pdf.text(line, { size: 9, width: 330, gap: 3 });
  pdf.rule(18);

  // Columns: medicine | HSN | qty | rate | GST | amount (HSN and GST only with tax).
  const withTax = doc.tax !== "none";
  const nameWidth = withTax ? 165 : 230;
  const hsnX = MARGIN + 172;
  const qtyX = withTax ? MARGIN + 220 : MARGIN + 245;
  const rateEdge = withTax ? MARGIN + 372 : MARGIN + 410;
  const gstEdge = MARGIN + 410;
  const amountEdge = MARGIN + pdf.contentWidth;
  const header = pdf.y - 9;
  const head = { size: 8, font: pdf.bold, color: MUTED };
  pdf.page.drawText("Medicine / batch", { x: MARGIN, y: header, ...head });
  if (withTax) pdf.page.drawText("HSN", { x: hsnX, y: header, ...head });
  pdf.page.drawText("Qty", { x: qtyX, y: header, ...head });
  pdf.right("Rate", header, { ...head, rightEdge: rateEdge });
  if (withTax) pdf.right("GST", header, { ...head, rightEdge: gstEdge });
  pdf.right("Amount", header, { ...head, rightEdge: amountEdge });
  pdf.y -= 16;
  for (const item of doc.lines) {
    pdf.ensure(30);
    const top = pdf.y;
    const baseline = top - 10;
    pdf.text(item.description, { size: 9.5, width: nameWidth, gap: 2 });
    pdf.text(`Batch ${item.batchNo} · Exp ${formatDate(item.expiryDate, "UTC")}`, { size: 7.5, color: MUTED, width: nameWidth, gap: item.dosage ? 2 : 4 });
    if (item.dosage) pdf.text(item.dosage, { size: 8, width: nameWidth, gap: 4 });
    const after = pdf.y;
    if (withTax && item.hsn) pdf.page.drawText(pdf.safe(item.hsn), { x: hsnX, y: baseline, size: 8.5, font: pdf.regular });
    pdf.wrap(item.quantity, 8.5, rateEdge - qtyX - 52).forEach((line, i) => pdf.page.drawText(line, { x: qtyX, y: baseline - i * 10, size: 8.5, font: pdf.regular }));
    if (item.rate) pdf.right(money(item.rate), baseline, { size: 9, rightEdge: rateEdge });
    if (withTax) pdf.right(item.gstRate === null ? "-" : `${Number(item.gstRate)}%`, baseline, { size: 9, rightEdge: gstEdge });
    pdf.right(money(item.amount), baseline, { size: 9.5, rightEdge: amountEdge });
    pdf.y = Math.min(after, top - 30) - 2;
  }
  pdf.rule(12);

  if (withTax) {
    const groups = new Map<string, { taxable: number; cgst: number; sgst: number; igst: number }>();
    for (const l of doc.lines) {
      if (l.taxable === null) continue;
      const key = String(Number(l.gstRate ?? 0));
      const g = groups.get(key) ?? { taxable: 0, cgst: 0, sgst: 0, igst: 0 };
      g.taxable += toMinor(l.taxable);
      g.cgst += toMinor(l.cgst);
      g.sgst += toMinor(l.sgst);
      g.igst += toMinor(l.igst);
      groups.set(key, g);
    }
    if (groups.size) {
      const anyIgst = [...groups.values()].some((g) => g.igst > 0);
      const cols =
        doc.tax === "single"
          ? [{ label: "GST", pick: (g: { cgst: number; sgst: number; igst: number }) => g.cgst + g.sgst + g.igst }]
          : anyIgst
            ? [{ label: "IGST", pick: (g: { igst: number }) => g.igst }]
            : [
                { label: "CGST", pick: (g: { cgst: number }) => g.cgst },
                { label: "SGST", pick: (g: { sgst: number }) => g.sgst },
              ];
      const edges = [MARGIN + 200, MARGIN + 290, MARGIN + 380];
      pdf.ensure(30 + groups.size * 13);
      const top = pdf.y - 9;
      pdf.page.drawText("GST rate", { x: MARGIN, y: top, ...head });
      pdf.right("Taxable value", top, { ...head, rightEdge: edges[0] });
      cols.forEach((c, i) => pdf.right(c.label, top, { ...head, rightEdge: edges[i + 1] }));
      pdf.y -= 14;
      for (const [rate, g] of [...groups.entries()].sort((a, b) => Number(a[0]) - Number(b[0]))) {
        const row = pdf.y - 9;
        pdf.page.drawText(`${rate}%`, { x: MARGIN, y: row, size: 8.5, font: pdf.regular });
        pdf.right(money(fromMinor(g.taxable)), row, { size: 8.5, rightEdge: edges[0] });
        cols.forEach((c, i) => pdf.right(money(fromMinor(c.pick(g))), row, { size: 8.5, rightEdge: edges[i + 1] }));
        pdf.y -= 13;
      }
      pdf.y -= 6;
    }
  }

  const labelEdge = MARGIN + 400;
  pdf.ensure(doc.totals.length * 16 + 20);
  for (const t of doc.totals) {
    const size = t.strong ? 11 : 9.5;
    const font = t.strong ? pdf.bold : pdf.regular;
    const row = pdf.y - size;
    pdf.right(t.label, row, { size, font, rightEdge: labelEdge });
    pdf.right(t.value, row, { size, font, rightEdge: amountEdge });
    pdf.y -= size + 6;
  }
  pdf.y -= 6;
  for (const note of doc.footnotes) pdf.text(note, { size: 8.5, color: MUTED, gap: 3 });

  return pdf.finish(clinic.footerText, doc.number);
}

export type SaleForPdf = {
  number: string;
  documentType: string;
  fiscalYear: string | null;
  soldAt: Date;
  soldByName: string;
  customer: string;
  customerGstin: string | null;
  interState: boolean;
  total: string;
  discount: string;
  roundOff: string;
  method: string;
  reference: string | null;
  prescriptionId: string | null;
  prescriberName: string | null;
  prescriberRegNo: string | null;
  patientAddress: string | null;
  items: {
    description: string;
    batchNo: string;
    expiryDate: string;
    /** Units; with soldAs "pack", `packs` strips of `packSize`. */
    quantity: number;
    soldAs: string;
    packs: number | null;
    packSize: number;
    form: string;
    unitPrice: string;
    amount: string;
    hsn: string | null;
    gstRate: string | null;
    taxable: string | null;
    cgst: string;
    sgst: string;
    igst: string;
    dose: string | null;
    frequency: string | null;
    durationDays: number | null;
    instructions: string | null;
  }[];
};

const SALE_TITLES: Record<string, string> = { tax_invoice: "TAX INVOICE", bill_of_supply: "BILL OF SUPPLY", cash_memo: "CASH MEMO" };

export async function renderSalePdf(sale: SaleForPdf, clinic: Letterhead, pharmacy: PharmacyIdentity, currency: string, timezone: string): Promise<Uint8Array> {
  const money = (v: string) => formatMoney(v, currency).replace(/₹/g, "Rs. ");
  const gst = sale.fiscalYear !== null;
  const taxInvoice = gst && sale.documentType === "tax_invoice";
  const gross = sale.items.reduce((s, i) => s + toMinor(i.amount), 0);
  const sum = (pick: (i: SaleForPdf["items"][number]) => string | null) => sale.items.reduce((s, i) => s + toMinor(pick(i) ?? "0"), 0);
  const igst = sum((i) => i.igst);
  const totals: Document["totals"] = [{ label: "Items", value: money(fromMinor(gross)) }];
  if (toMinor(sale.discount) > 0) totals.push({ label: "Discount", value: `- ${money(sale.discount)}` });
  if (taxInvoice) {
    totals.push({ label: "Taxable value", value: money(fromMinor(sum((i) => i.taxable))) });
    if (igst > 0) totals.push({ label: "IGST", value: money(fromMinor(igst)) });
    else totals.push({ label: "CGST", value: money(fromMinor(sum((i) => i.cgst))) }, { label: "SGST", value: money(fromMinor(sum((i) => i.sgst))) });
  }
  if (toMinor(sale.roundOff) !== 0) totals.push({ label: "Round-off", value: money(sale.roundOff) });
  totals.push({ label: sale.method === "credit" ? "Total (on account)" : "Total paid", value: money(sale.total), strong: true });

  const footnotes = [`${sale.method === "credit" ? "Charged to the customer's account" : `Paid by ${METHOD_WORDS[sale.method] ?? sale.method}`}${sale.reference ? ` (${sale.reference})` : ""} · served by ${sale.soldByName}`];
  if (taxInvoice) footnotes.push("Prices include GST. Tax shown is the part of each price that is GST.");
  if (gst && sale.documentType === "bill_of_supply")
    footnotes.push(pharmacy.gstScheme === "composition" ? "Composition taxable person, not eligible to collect tax on supplies." : "Supplier not registered under GST; no tax charged.");

  return renderDocument(
    {
      title: gst ? (SALE_TITLES[sale.documentType] ?? "PHARMACY RECEIPT") : "PHARMACY RECEIPT",
      number: sale.number,
      date: formatDateTime(sale.soldAt, timezone),
      party: {
        heading: sale.customer,
        lines: [
          sale.customerGstin ? `GSTIN ${sale.customerGstin}${sale.interState ? " · inter-state supply" : ""}` : null,
          sale.prescriptionId ? "Against a prescription" : "Counter sale",
        ].filter((v): v is string => v !== null),
      },
      references:
        sale.prescriberName || sale.patientAddress
          ? [
              sale.prescriberName ? `Prescribed by ${sale.prescriberName}${sale.prescriberRegNo ? ` (Reg. ${sale.prescriberRegNo})` : ""}` : "",
              sale.patientAddress ? `Patient address: ${sale.patientAddress}` : "",
            ].filter(Boolean)
          : [],
      lines: sale.items.map((i) => ({
        description: i.description,
        batchNo: i.batchNo,
        expiryDate: i.expiryDate,
        hsn: i.hsn,
        gstRate: i.gstRate,
        quantity: describeQuantity(i, i.form),
        rate: i.unitPrice,
        amount: i.amount,
        dosage: dosageText(i) || undefined,
        taxable: i.taxable,
        cgst: i.cgst,
        sgst: i.sgst,
        igst: i.igst,
      })),
      tax: taxInvoice ? "split" : "none",
      totals,
      footnotes,
    },
    clinic,
    pharmacy,
    currency,
  );
}

export type CreditNoteForPdf = {
  number: string;
  kind: string;
  reason: string;
  refundMethod: string;
  total: string;
  roundOff: string;
  createdAt: Date;
  createdByName: string;
  sale: { number: string; soldAt: Date; customer: string; customerGstin: string | null; documentType: string };
  items: { description: string; batchNo: string; expiryDate: string; hsn: string | null; gstRate: string | null; form: string; quantity: number; net: string; taxable: string; cgst: string; sgst: string; igst: string }[];
};

export async function renderCreditNotePdf(note: CreditNoteForPdf, clinic: Letterhead, pharmacy: PharmacyIdentity, currency: string, timezone: string): Promise<Uint8Array> {
  const money = (v: string) => formatMoney(v, currency).replace(/₹/g, "Rs. ");
  const taxInvoice = note.sale.documentType === "tax_invoice";
  const goods = note.items.reduce((s, i) => s + toMinor(i.net), 0);
  const totals: Document["totals"] = [{ label: "Goods returned", value: money(fromMinor(goods)) }];
  if (toMinor(note.roundOff) !== 0) totals.push({ label: "Round-off given back", value: money(note.roundOff) });
  totals.push({ label: note.refundMethod === "account" ? "Credited to the account" : "Refunded", value: money(note.total), strong: true });
  return renderDocument(
    {
      title: "CREDIT NOTE",
      number: note.number,
      date: formatDateTime(note.createdAt, timezone),
      party: { heading: note.sale.customer, lines: note.sale.customerGstin ? [`GSTIN ${note.sale.customerGstin}`] : [] },
      references: [
        `${note.kind === "cancellation" ? "Cancels" : "Against"} ${note.sale.number} of ${formatDate(note.sale.soldAt, timezone)}`,
        `Reason: ${note.reason}`,
      ],
      lines: note.items.map((i) => ({
        description: i.description,
        batchNo: i.batchNo,
        expiryDate: i.expiryDate,
        hsn: i.hsn,
        gstRate: i.gstRate,
        quantity: `${i.quantity} ${unitWord(i.form, i.quantity)}`,
        rate: null,
        amount: i.net,
        taxable: i.taxable,
        cgst: i.cgst,
        sgst: i.sgst,
        igst: i.igst,
      })),
      tax: taxInvoice ? "split" : "none",
      totals,
      footnotes: [`${note.refundMethod === "account" ? "Credited to the customer's account" : `Refunded by ${METHOD_WORDS[note.refundMethod] ?? note.refundMethod}`} · issued by ${note.createdByName}`],
    },
    clinic,
    pharmacy,
    currency,
  );
}

export type DebitNoteForPdf = {
  number: string;
  reason: string;
  taxable: string;
  taxTotal: string;
  total: string;
  createdAt: Date;
  createdByName: string;
  supplier: { name: string; taxId: string | null; phone: string | null; email: string | null };
  items: { drugName: string; batchNo: string; expiryDate: string; quantity: number; unitCost: string; gstRate: string; taxable: string; tax: string }[];
};

export async function renderDebitNotePdf(note: DebitNoteForPdf, clinic: Letterhead, pharmacy: PharmacyIdentity, currency: string, timezone: string): Promise<Uint8Array> {
  const money = (v: string) => formatMoney(v, currency).replace(/₹/g, "Rs. ");
  return renderDocument(
    {
      title: "DEBIT NOTE",
      number: note.number,
      date: formatDateTime(note.createdAt, timezone),
      party: {
        heading: note.supplier.name,
        lines: [note.supplier.taxId ? `GSTIN ${note.supplier.taxId}` : null, [note.supplier.phone, note.supplier.email].filter(Boolean).join(" · ") || null].filter(
          (v): v is string => v !== null,
        ),
      },
      references: [`Goods returned to the supplier. Reason: ${note.reason}`],
      lines: note.items.map((i) => ({
        description: i.drugName,
        batchNo: i.batchNo,
        expiryDate: i.expiryDate,
        hsn: null,
        gstRate: i.gstRate,
        quantity: `${i.quantity} units`,
        rate: i.unitCost,
        amount: i.taxable,
        taxable: i.taxable,
        cgst: i.tax,
        sgst: "0",
        igst: "0",
      })),
      tax: "single",
      totals: [
        { label: "Taxable value", value: money(note.taxable) },
        { label: "GST", value: money(note.taxTotal) },
        { label: "Total", value: money(note.total), strong: true },
      ],
      footnotes: [`Values at purchase cost, before GST · issued by ${note.createdByName}`],
    },
    clinic,
    pharmacy,
    currency,
  );
}
