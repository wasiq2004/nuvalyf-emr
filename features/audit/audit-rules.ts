// Pure rules for the compliance panel (unit tested).
//
// The auditor answers "who did what, when, to whose record" - never "what
// was written". Events about clinical content keep their who/what/when/whom,
// but their details (a drug name, a diagnosis code, a reason for an allergy
// correction) are withheld.

const CLINICAL_PREFIXES = [
  "DIAGNOSIS_",
  "PRESCRIPTION_",
  "VITALS_",
  "ALLERGY_",
  "NO_KNOWN_ALLERGIES",
  "LAB_",
  "CONSULTATION_",
  "TRIAGE_",
];

export function isClinicalAction(action: string): boolean {
  return CLINICAL_PREFIXES.some((prefix) => action.startsWith(prefix));
}

/**
 * Detail fields the auditor may see: amounts, identifiers of records,
 * statuses and counts. Anything else (free text such as a search term, an
 * emergency description, a cancellation reason, an invoice line, an email
 * typed into a failed sign-in) is withheld by default.
 */
const VISIBLE_DETAIL_KEYS = new Set([
  "action", "affected", "amount", "change", "date", "direction", "discount", "doctorId", "enabled", "excluded", "flag",
  "flagged", "found", "from", "imported", "invoice", "isActive", "isFavourite", "kind", "level", "method", "modules",
  "next", "number", "page", "permission", "planId", "prescriptionSigned", "previousDoctorId", "previousId", "quantity",
  "recipients", "remindersEnabled", "required", "results", "role", "roles", "rows", "sale", "severity", "size", "startsAt",
  "status", "to", "tokenChanged", "total", "type", "userId", "version", "visitId", "path", "problems", "outcome", "days",
]);

export function redactDetails(action: string, details: unknown): Record<string, unknown> | null {
  if (!details || typeof details !== "object") return null;
  if (isClinicalAction(action)) return { withheld: "clinical details are not shown in the audit trail" };
  const visible: Record<string, unknown> = {};
  let hidden = 0;
  for (const [key, value] of Object.entries(details as Record<string, unknown>)) {
    if (VISIBLE_DETAIL_KEYS.has(key)) visible[key] = value;
    else hidden += 1;
  }
  if (hidden > 0) visible.withheldFields = hidden;
  return visible;
}

/** Events that mean someone looked at (or printed) a patient's information. */
export const ACCESS_ACTIONS = [
  "PATIENT_VIEWED",
  "ENCOUNTER_VIEWED",
  "PRESCRIPTION_PRINTED",
  "PRESCRIPTION_VIEWED_BY_PHARMACY",
  "INVOICE_VIEWED",
  "INVOICE_PRINTED",
] as const;

export type AuditCategory = "access" | "clinical" | "billing" | "pharmacy" | "front desk" | "sign-in" | "administration" | "security";

export function categoryOf(action: string): AuditCategory {
  if ((ACCESS_ACTIONS as readonly string[]).includes(action)) return "access";
  if (action === "ACTION_DENIED" || action === "PAGE_ACCESS_DENIED" || action.endsWith("_REFUSED")) return "security";
  if (action.startsWith("LOGIN") || action.startsWith("PASSWORD_")) return "sign-in";
  if (isClinicalAction(action)) return "clinical";
  if (/^(INVOICE|PAYMENT|REFUND)_/.test(action)) return "billing";
  if (/^(PHARMACY|STOCK|PURCHASE_ORDER|SUPPLIER|REORDER)_/.test(action)) return "pharmacy";
  if (/^(PATIENT|APPOINTMENT|WALK_IN|QUEUE|VISIT|TASK|EMERGENCY|DUPLICATE)_/.test(action)) return "front desk";
  return "administration";
}

export type AuditFilters = {
  actorId?: string;
  patientMrn?: string;
  action?: string;
  outcome?: "success" | "denied" | "error";
  severity?: "info" | "warning" | "critical";
  from: string;
  to: string;
};

/** Reads filter values from URL search params, with safe defaults (last 30 days). */
export function parseFilters(params: Record<string, string | undefined>, today: string, addDays: (d: string, n: number) => string): AuditFilters {
  const date = (v: string | undefined) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
  const uuid = (v: string | undefined) => (v && /^[0-9a-f-]{36}$/i.test(v) ? v : undefined);
  const from = date(params.from) ?? addDays(today, -30);
  const to = date(params.to) ?? today;
  return {
    actorId: uuid(params.actor),
    patientMrn: params.mrn?.trim().toUpperCase().slice(0, 30) || undefined,
    action: params.action && /^[A-Z_]{2,100}$/.test(params.action) ? params.action : undefined,
    outcome: params.outcome === "success" || params.outcome === "denied" || params.outcome === "error" ? params.outcome : undefined,
    severity: params.severity === "info" || params.severity === "warning" || params.severity === "critical" ? params.severity : undefined,
    from: from <= to ? from : to,
    to,
  };
}

export function toSearchParams(filters: AuditFilters): string {
  const params = new URLSearchParams();
  if (filters.actorId) params.set("actor", filters.actorId);
  if (filters.patientMrn) params.set("mrn", filters.patientMrn);
  if (filters.action) params.set("action", filters.action);
  if (filters.outcome) params.set("outcome", filters.outcome);
  if (filters.severity) params.set("severity", filters.severity);
  params.set("from", filters.from);
  params.set("to", filters.to);
  return params.toString();
}

/** CSV cell escaping, including formula injection ("=cmd" opened in a spreadsheet). */
export function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? "" : typeof value === "string" ? value : JSON.stringify(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
