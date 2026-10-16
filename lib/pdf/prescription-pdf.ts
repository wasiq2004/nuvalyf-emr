import "server-only";

// Prescription PDF on the clinic letterhead. Rendered only from the snapshot
// taken at signing, so editing the medicine list, the letterhead or the
// doctor's profile later never changes a signed document.
import type { SignedPrescriptionSnapshot } from "@/features/clinical/encounters.service";
import { formatDateTime } from "@/lib/format";
import { ACCENT, Letter, MARGIN, MUTED } from "./letter";

const SEX: Record<string, string> = { male: "M", female: "F", other: "O", unknown: "-" };

export async function renderPrescriptionPdf(snapshot: SignedPrescriptionSnapshot, reference: string): Promise<Uint8Array> {
  const { clinic, prescriber, patient } = snapshot;
  const pdf = await Letter.create({ title: `Prescription ${patient.mrn}`, author: prescriber.name });
  pdf.letterhead(clinic);

  // Prescriber and date
  const signedAt = formatDateTime(snapshot.signedAt, snapshot.timezone);
  pdf.right(signedAt, pdf.y - 12, { size: 9, color: MUTED });
  pdf.text(prescriber.name, { size: 12, font: pdf.bold });
  if (prescriber.specialty) pdf.text(prescriber.specialty, { size: 9, color: MUTED });
  pdf.text(`Reg. No. ${prescriber.registrationNumber}${prescriber.registrationCouncil ? ` (${prescriber.registrationCouncil})` : ""}`, { size: 9, color: MUTED });
  pdf.rule(14);

  // Patient
  pdf.text(patient.name, { size: 11, font: pdf.bold });
  pdf.text(`${patient.age !== null ? `${patient.age} y` : "Age -"} / ${SEX[patient.sex] ?? "-"}   ·   Record ${patient.mrn}`, { size: 9, color: MUTED });
  if (snapshot.diagnoses.length) {
    pdf.y -= 4;
    pdf.text(`Diagnosis: ${snapshot.diagnoses.map((d) => `${d.label} (${d.code})`).join("; ")}`, { size: 9.5 });
  }
  pdf.rule(16);

  // Rx
  pdf.text("Rx", { size: 20, font: pdf.bold, color: ACCENT, gap: 8 });
  snapshot.items.forEach((item, index) => {
    pdf.ensure(40);
    // "Paracetamol 650" already says 650: don't print "650 mg" after it again.
    const strengthNumber = item.strength?.match(/[\d.]+/)?.[0];
    const showStrength = item.strength && !(strengthNumber && item.drugName.includes(strengthNumber));
    pdf.text(`${index + 1}.  ${item.drugName}${showStrength ? ` ${item.strength}` : ""}  (${item.form})`, { size: 11, font: pdf.bold, gap: 3 });
    pdf.text(item.genericName, { size: 8.5, color: MUTED, x: MARGIN + 16, gap: 3 });
    const how = [
      item.dose,
      item.frequency,
      item.durationDays ? `for ${item.durationDays} ${item.durationDays === 1 ? "day" : "days"}` : null,
      item.instructions,
    ]
      .filter(Boolean)
      .join("  ·  ");
    pdf.text(how, { size: 10, x: MARGIN + 16, gap: 3 });
    if (item.quantity) pdf.text(`Qty: ${item.quantity}`, { size: 9, color: MUTED, x: MARGIN + 16, gap: 3 });
    pdf.y -= 8;
  });

  if (snapshot.advice) {
    pdf.rule(12);
    pdf.text("Advice", { size: 10, font: pdf.bold });
    pdf.text(snapshot.advice, { size: 10 });
  }
  if (snapshot.followUp) {
    pdf.y -= 4;
    pdf.text(`Follow-up: ${snapshot.followUp}`, { size: 10, font: pdf.bold });
  }

  // Signature
  pdf.ensure(70);
  pdf.y -= 30;
  for (const [i, line] of [prescriber.name, `Reg. No. ${prescriber.registrationNumber}`, `Signed electronically · ${signedAt}`].entries()) {
    const size = i === 0 ? 10 : 8.5;
    pdf.right(line, pdf.y - size, { size, font: i === 0 ? pdf.bold : pdf.regular, color: i === 0 ? undefined : MUTED });
    pdf.y -= size + 4;
  }

  return pdf.finish(clinic.footerText, reference);
}
