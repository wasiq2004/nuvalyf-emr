// Discharge summary sections (unit tested). A clinic chooses which standard
// sections it uses and adds its own; standard sections are filled from the
// record, the clinic's own start empty for the doctor.

export type SummarySection = { key: string; title: string; body: string };
export type SectionChoice = { key: string; title: string };

export const STANDARD_SECTIONS: SectionChoice[] = [
  { key: "reason", title: "Reason for admission" },
  { key: "history", title: "History and examination" },
  { key: "diagnosis", title: "Diagnosis" },
  { key: "investigations", title: "Investigations" },
  { key: "course", title: "Course in hospital" },
  { key: "treatment", title: "Treatment given" },
  { key: "condition", title: "Condition at discharge" },
  { key: "medicines", title: "Discharge medicines" },
  { key: "advice", title: "Advice and follow-up" },
];

/** Must be written by the doctor before signing; the record cannot supply it. */
export const REQUIRED_SECTIONS = ["condition"];

export function sectionsFrom(saved: unknown): SectionChoice[] {
  if (!Array.isArray(saved) || saved.length === 0) return STANDARD_SECTIONS;
  return saved.filter((s): s is SectionChoice => typeof s?.key === "string" && typeof s?.title === "string");
}

/** Builds the choice list from ticked standard sections and typed-in headings. */
export function choiceFrom(enabled: string[], custom: string[]): SectionChoice[] {
  const standard = STANDARD_SECTIONS.filter((s) => enabled.includes(s.key));
  const own = [...new Set(custom.map((c) => c.trim()).filter(Boolean))].map((title, i) => ({ key: `custom-${i + 1}`, title: title.slice(0, 80) }));
  return [...standard, ...own];
}

/** Fills empty sections from the record; anything the doctor wrote stays. */
export function mergeDraft(choices: SectionChoice[], filled: Record<string, string>, current: SummarySection[] = []): SummarySection[] {
  return choices.map((c) => {
    const body = current.find((s) => s.key === c.key)?.body.trim();
    return { key: c.key, title: c.title, body: body || filled[c.key] || "" };
  });
}

export function missingForSigning(sections: SummarySection[]): string[] {
  return sections.filter((s) => REQUIRED_SECTIONS.includes(s.key) && !s.body.trim()).map((s) => s.title);
}
