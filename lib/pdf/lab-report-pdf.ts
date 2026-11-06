import "server-only";

// The printable lab report on the clinic letterhead: every test from one
// consultation, each with its own parameters, results, units and reference
// ranges. Values outside the range are bold and marked L, H, LL, HH or *.
import { formatDateTime } from "@/lib/format";
import { LAB_FLAG_MARKS, type LabFlag } from "@/features/clinical/lab-rules";
import { ACCENT, Letter, MARGIN, MUTED, type Letterhead } from "./letter";

export type LabReportForPdf = {
  patient: { name: string; mrn: string; age: number | null; sex: string };
  doctorName: string | null;
  pending: string[];
  tests: {
    id: string;
    name: string;
    sampleType: string | null;
    orderedAt: Date;
    resultedAt: Date;
    resultedByName: string | null;
    notes: string | null;
    single: { value: string; unit: string | null; reference: string | null; flag: string | null } | null;
    lines: { name: string; section: string | null; unit: string | null; value: string; flag: string; referenceText: string | null }[];
  }[];
};

const SEX: Record<string, string> = { male: "Male", female: "Female", other: "Other", unknown: "Not stated" };

export async function renderLabReportPdf(report: LabReportForPdf, clinic: Letterhead, timezone: string): Promise<Uint8Array> {
  const pdf = await Letter.create({ title: `Lab report ${report.patient.mrn}`, author: clinic.name });
  pdf.letterhead(clinic);
  pdf.text("LABORATORY REPORT", { size: 16, font: pdf.bold, color: ACCENT, gap: 8 });

  pdf.text(report.patient.name, { size: 12, font: pdf.bold, gap: 3 });
  pdf.text(`${report.patient.mrn} · ${report.patient.age !== null ? `${report.patient.age} years` : "Age not stated"} · ${SEX[report.patient.sex] ?? report.patient.sex}`, { size: 9, color: MUTED, gap: 3 });
  if (report.doctorName) pdf.text(`Referred by ${report.doctorName}`, { size: 9, color: MUTED, gap: 3 });
  pdf.rule(14);

  const unitX = MARGIN + 290;
  const valueEdge = MARGIN + 270;
  const refEdge = MARGIN + pdf.contentWidth;
  const head = { size: 8, font: pdf.bold, color: MUTED };

  for (const test of report.tests) {
    pdf.ensure(70);
    pdf.text(test.name, { size: 11, font: pdf.bold, gap: 2 });
    pdf.text(
      [test.sampleType ? `Sample: ${test.sampleType}` : null, `Ordered ${formatDateTime(test.orderedAt, timezone)}`, `Reported ${formatDateTime(test.resultedAt, timezone)}`].filter(Boolean).join(" · "),
      { size: 8, color: MUTED, gap: 6 },
    );
    const header = pdf.y - 8;
    pdf.page.drawText("Parameter", { x: MARGIN, y: header, ...head });
    pdf.right("Result", header, { ...head, rightEdge: valueEdge });
    pdf.page.drawText("Unit", { x: unitX, y: header, ...head });
    pdf.right("Reference range", header, { ...head, rightEdge: refEdge });
    pdf.y -= 14;

    const row = (name: string, value: string, unit: string | null, reference: string | null, flag: string) => {
      pdf.ensure(16);
      const off = flag !== "normal" && flag !== "";
      const mark = LAB_FLAG_MARKS[flag as LabFlag] ?? "";
      const font = off ? pdf.bold : pdf.regular;
      const baseline = pdf.y - 9;
      pdf.page.drawText(pdf.safe(name), { x: MARGIN, y: baseline, size: 9.5, font });
      pdf.right(`${value}${mark ? ` ${mark}` : ""}`, baseline, { size: 9.5, font, rightEdge: valueEdge });
      if (unit) pdf.page.drawText(pdf.safe(unit), { x: unitX, y: baseline, size: 8.5, font: pdf.regular, color: MUTED });
      if (reference) pdf.right(reference, baseline, { size: 8.5, color: MUTED, rightEdge: refEdge });
      pdf.y -= 14;
    };

    if (test.single) {
      const flag = test.single.flag === "abnormal" || test.single.flag === "critical" ? "abnormal" : "normal";
      if (test.single.value.length > 40) {
        pdf.text(test.single.value, { size: 9.5, gap: 4 });
      } else {
        row(test.name, test.single.value, test.single.unit, test.single.reference, flag);
      }
    } else {
      let section: string | null = null;
      for (const line of test.lines) {
        if (line.section !== section) {
          section = line.section;
          if (section) {
            pdf.ensure(28);
            pdf.y -= 3;
            pdf.text(section, { size: 8.5, font: pdf.bold, color: ACCENT, gap: 3 });
          }
        }
        row(line.name, line.value, line.unit, line.referenceText, line.flag);
      }
    }
    if (test.notes) pdf.text(`Note: ${test.notes}`, { size: 8.5, gap: 3 });
    if (test.resultedByName) pdf.text(`Reported by ${test.resultedByName}`, { size: 8, color: MUTED, gap: 3 });
    pdf.rule(14);
  }

  if (report.pending.length) pdf.text(`Still pending: ${report.pending.join(", ")}`, { size: 9, gap: 4 });
  pdf.text("L low · H high · LL critically low · HH critically high · * not the expected finding", { size: 7.5, color: MUTED, gap: 3 });
  pdf.text("End of report", { size: 8, color: MUTED });
  return pdf.finish(clinic.footerText, `LAB ${report.patient.mrn}`);
}
