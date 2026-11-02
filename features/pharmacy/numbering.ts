// Financial-year document numbers (unit tested). docs/PHARMACY_DESIGN.md 4.6.
// The Indian financial year runs April to March; GST allows at most 16
// characters in an invoice number, unique within the year.

export const DOCUMENT_PREFIX = {
  sale: "S",
  creditNote: "CN",
  debitNote: "DN",
  receipt: "RC",
  payment: "PY",
} as const;
export type DocumentKind = keyof typeof DOCUMENT_PREFIX;

/** "2026-27" for any date from 1 April 2026 to 31 March 2027 (yyyy-mm-dd). */
export function fiscalYear(date: string): string {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const start = month >= 4 ? year : year - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

/** The counter key: one sequence per document kind per financial year. */
export function counterKey(kind: DocumentKind, fy: string): string {
  return `${kind}:${fy}`;
}

/** S/2627/000001 */
export function documentNumber(kind: DocumentKind, fy: string, n: number): string {
  const short = `${fy.slice(2, 4)}${fy.slice(5, 7)}`;
  return `${DOCUMENT_PREFIX[kind]}/${short}/${String(n).padStart(6, "0")}`;
}
