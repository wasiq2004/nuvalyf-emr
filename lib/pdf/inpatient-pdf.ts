import "server-only";

// Inpatient documents on the clinic letterhead: the bill (interim until the
// patient leaves) and the signed discharge summary. The summary shows the
// balance due: it is never held back for payment.
import { formatDateTime } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { BILLING_MODE_LABELS, hoursText, type BillingMode } from "@/features/inpatient/bed-billing-rules";
import type { SummarySection } from "@/features/inpatient/summary-rules";
import { ACCENT, Letter, MARGIN, MUTED, type Letterhead } from "./letter";

export type AdmissionForPdf = {
  number: string;
  patient: { name: string; mrn: string; age: number | null; sex: string; addressLine: string | null; city: string | null };
  doctorName: string;
  admittedAt: Date;
  dischargedAt: Date | null;
  attendantName: string | null;
  attendantPhone: string | null;
};

type Bill = {
  billingMode: BillingMode;
  discountReason: string | null;
  beds: { bedLabel: string; categoryName: string; rate: string; hours: number; amount: string; startedAt: Date; endedAt: Date | null; overrideReason: string | null }[];
  charges: { kind: string; description: string; quantity: number; unitAmount: string; amount: string; voidedAt: Date | null }[];
  payments: { number: string; kind: string; amount: string; method: string; receivedAt: Date }[];
  totals: { bed: string; charges: string; gross: string; discount: string; net: string; paid: string; balance: string };
  balance: number;
};

type Context = { letterhead: Letterhead; currency: string; timezone: string };

const SEX: Record<string, string> = { male: "Male", female: "Female", other: "Other", unknown: "Not stated" };
const KIND: Record<string, string> = { doctor: "Doctor", nursing: "Nursing", procedure: "Procedure", lab: "Lab", pharmacy: "Pharmacy", other: "Other" };
const PAYMENT: Record<string, string> = { advance: "Advance", payment: "Payment", refund: "Refund" };

function patientBlock(pdf: Letter, admission: AdmissionForPdf, timezone: string) {
  const p = admission.patient;
  pdf.text(p.name, { size: 12, font: pdf.bold, gap: 3 });
  pdf.text(`${p.mrn} · ${p.age !== null ? `${p.age} years` : "Age not stated"} · ${SEX[p.sex] ?? p.sex}`, { size: 9, color: MUTED, gap: 3 });
  const address = [p.addressLine, p.city].filter(Boolean).join(", ");
  if (address) pdf.text(address, { size: 9, color: MUTED, gap: 3 });
  pdf.text(`Consultant: ${admission.doctorName}`, { size: 9, gap: 3 });
  pdf.text(`Admitted ${formatDateTime(admission.admittedAt, timezone)} · ${admission.dischargedAt ? `Discharged ${formatDateTime(admission.dischargedAt, timezone)}` : "Still admitted"}`, { size: 9, gap: 3 });
  if (admission.attendantName) pdf.text(`Attendant: ${[admission.attendantName, admission.attendantPhone].filter(Boolean).join(" · ")}`, { size: 9, color: MUTED, gap: 3 });
  pdf.rule(14);
}

export async function renderInpatientBillPdf(admission: AdmissionForPdf, bill: Bill, context: Context): Promise<Uint8Array> {
  const { letterhead, currency, timezone } = context;
  const money = (v: string) => formatMoney(v, currency).replace(/₹/g, "Rs. ");
  const pdf = await Letter.create({ title: `Inpatient bill ${admission.number}`, author: letterhead.name });
  pdf.letterhead(letterhead);
  pdf.right(admission.number, pdf.y - 14, { size: 12, font: pdf.bold });
  pdf.text(admission.dischargedAt ? "FINAL BILL" : "INTERIM BILL", { size: 16, font: pdf.bold, color: ACCENT, gap: 8 });
  patientBlock(pdf, admission, timezone);

  const right = MARGIN + pdf.contentWidth;
  const row = (label: string, detail: string | null, amount: string, strong = false) => {
    pdf.ensure(24);
    const font = strong ? pdf.bold : pdf.regular;
    const baseline = pdf.y - 10;
    pdf.page.drawText(pdf.safe(label), { x: MARGIN, y: baseline, size: 9.5, font });
    pdf.right(amount, baseline, { size: 9.5, font, rightEdge: right });
    pdf.y -= 13;
    if (detail) pdf.text(detail, { size: 8, color: MUTED, width: 400, gap: 3 });
  };

  pdf.text(`Bed charges · ${BILLING_MODE_LABELS[bill.billingMode]}`, { size: 10, font: pdf.bold, color: ACCENT, gap: 4 });
  for (const b of bill.beds) {
    row(`${b.categoryName}, ${b.bedLabel}`, `${formatDateTime(b.startedAt, timezone)} to ${b.endedAt ? formatDateTime(b.endedAt, timezone) : "now"} · ${hoursText(b.hours)} at ${money(b.rate)} a day${b.overrideReason ? ` · ${b.overrideReason}` : ""}`, money(b.amount));
  }
  const live = bill.charges.filter((c) => !c.voidedAt);
  if (live.length) {
    pdf.y -= 6;
    pdf.text("Other charges", { size: 10, font: pdf.bold, color: ACCENT, gap: 4 });
    for (const c of live) row(`${KIND[c.kind] ?? c.kind}: ${c.description}`, c.quantity > 1 ? `${c.quantity} x ${money(c.unitAmount)}` : null, money(c.amount));
  }
  pdf.rule(14);
  row("Total", null, money(bill.totals.gross));
  if (Number(bill.totals.discount) > 0) row("Discount", bill.discountReason, `- ${money(bill.totals.discount)}`);
  row("Bill amount", null, money(bill.totals.net), true);
  row("Paid", null, money(bill.totals.paid));
  row(bill.balance < 0 ? "To refund" : "Balance due", null, money(bill.totals.balance.replace("-", "")), true);

  if (bill.payments.length) {
    pdf.y -= 8;
    pdf.text("Payments", { size: 10, font: pdf.bold, color: ACCENT, gap: 4 });
    for (const p of bill.payments) row(`${PAYMENT[p.kind] ?? p.kind} ${p.number} · ${p.method.toUpperCase()}`, formatDateTime(p.receivedAt, timezone), `${p.kind === "refund" ? "- " : ""}${money(p.amount)}`);
  }
  return pdf.finish(letterhead.footerText, admission.number);
}

export async function renderDischargeSummaryPdf(
  admission: AdmissionForPdf,
  summary: { status: string; sections: SummarySection[]; signedByName: string | null; signedRegistration: string | null; signedAt: Date | null },
  bill: Bill,
  context: Context,
): Promise<Uint8Array> {
  const { letterhead, currency, timezone } = context;
  const money = (v: string) => formatMoney(v, currency).replace(/₹/g, "Rs. ");
  const pdf = await Letter.create({ title: `Discharge summary ${admission.number}`, author: letterhead.name });
  pdf.letterhead(letterhead);
  pdf.right(admission.number, pdf.y - 14, { size: 12, font: pdf.bold });
  pdf.text(summary.status === "signed" ? "DISCHARGE SUMMARY" : "DISCHARGE SUMMARY (DRAFT)", { size: 16, font: pdf.bold, color: ACCENT, gap: 8 });
  patientBlock(pdf, admission, timezone);

  for (const section of summary.sections) {
    if (!section.body.trim()) continue;
    pdf.ensure(40);
    pdf.text(section.title, { size: 10, font: pdf.bold, color: ACCENT, gap: 3 });
    pdf.text(section.body, { size: 9.5, gap: 3 });
    pdf.y -= 7;
  }

  pdf.rule(14);
  pdf.text(
    bill.balance > 0 ? `Bill ${money(bill.totals.net)} · Paid ${money(bill.totals.paid)} · Balance due ${money(bill.totals.balance)}` : `Bill ${money(bill.totals.net)} · Paid ${money(bill.totals.paid)} · Nothing due`,
    { size: 9, font: pdf.bold, gap: 8 },
  );
  if (summary.status === "signed") {
    pdf.text(summary.signedByName ?? "", { size: 10, font: pdf.bold, gap: 2 });
    pdf.text(`Reg. ${summary.signedRegistration ?? ""} · Signed ${summary.signedAt ? formatDateTime(summary.signedAt, timezone) : ""}`, { size: 8.5, color: MUTED });
  } else {
    pdf.text("Draft: not valid until signed by the doctor.", { size: 9, color: MUTED });
  }
  return pdf.finish(letterhead.footerText, admission.number);
}
