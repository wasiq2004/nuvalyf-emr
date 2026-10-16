// Pure CSV import rules (unit tested): parse, map columns, validate rows.
// The service adds the database checks (likely duplicates of existing
// patients) and commits all rows in one transaction - or none.
import { patientSchema } from "@/features/patients/patient.schema";
import { normalizeMobile, normalizeName } from "@/features/patients/patient-rules";
import type { PatientInput } from "@/features/patients/patients.service";

export const MAX_IMPORT_ROWS = 2000;
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

/** RFC 4180-ish: quoted fields, doubled quotes, CRLF or LF, BOM. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"' && field === "") quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

/** Accepted headers (case, spaces and underscores do not matter) and their aliases. */
const COLUMNS: Record<string, string[]> = {
  firstName: ["first name", "firstname", "given name", "name"],
  lastName: ["last name", "lastname", "surname", "family name"],
  sex: ["sex", "gender"],
  dateOfBirth: ["date of birth", "dob", "birth date"],
  statedAgeYears: ["age", "age years"],
  mobile: ["mobile", "phone", "mobile number", "contact"],
  altPhone: ["alt phone", "alternate phone", "phone 2"],
  email: ["email", "e-mail"],
  addressLine: ["address", "address line"],
  city: ["city", "town"],
  consentReminders: ["consent reminders", "whatsapp reminders"],
  consentBroadcasts: ["consent broadcasts", "whatsapp updates", "consent updates"],
};

const normHeader = (h: string) => h.trim().toLowerCase().replace(/[_\-]+/g, " ").replace(/\s+/g, " ");

export function mapHeaders(header: string[]): { map: Record<string, number>; unknown: string[]; missing: string[] } {
  const map: Record<string, number> = {};
  const unknown: string[] = [];
  header.forEach((raw, index) => {
    const h = normHeader(raw);
    const key = Object.entries(COLUMNS).find(([k, aliases]) => normHeader(k.replace(/([A-Z])/g, " $1")) === h || aliases.includes(h))?.[0];
    if (key && map[key] === undefined) map[key] = index;
    else if (h) unknown.push(raw.trim());
  });
  const missing = ["firstName", "sex"].filter((k) => map[k] === undefined);
  return { map, unknown, missing };
}

const SEX: Record<string, PatientInput["sex"]> = { m: "male", male: "male", f: "female", female: "female", o: "other", other: "other", u: "unknown", unknown: "unknown", "": "unknown" };
const YES = new Set(["yes", "y", "true", "1"]);
const NO = new Set(["no", "n", "false", "0", ""]);

/** dd/mm/yyyy, dd-mm-yyyy or yyyy-mm-dd -> yyyy-mm-dd (or the original if unparseable). */
export function normalizeDate(value: string): string {
  const v = value.trim();
  const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(v);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  return v;
}

export type ImportRow = { line: number; patient: PatientInput; consentReminders: boolean; consentBroadcasts: boolean };
export type ImportProblem = { line: number; field: string; message: string };

export function validateRows(rows: string[][], today: string): { valid: ImportRow[]; problems: ImportProblem[] } {
  const problems: ImportProblem[] = [];
  if (rows.length < 2) return { valid: [], problems: [{ line: 1, field: "file", message: "The file has no patient rows." }] };
  const { map, missing } = mapHeaders(rows[0]);
  if (missing.length) {
    return { valid: [], problems: [{ line: 1, field: "header", message: `Missing column(s): ${missing.map((m) => (m === "firstName" ? "first_name" : m)).join(", ")}` }] };
  }
  if (rows.length - 1 > MAX_IMPORT_ROWS) {
    return { valid: [], problems: [{ line: 1, field: "file", message: `At most ${MAX_IMPORT_ROWS} patients per file; this one has ${rows.length - 1}. Split it.` }] };
  }

  const cell = (row: string[], key: string) => (map[key] === undefined ? "" : (row[map[key]] ?? "").trim());
  const valid: ImportRow[] = [];
  const seen = new Map<string, number>();

  rows.slice(1).forEach((row, i) => {
    const line = i + 2;
    const sexRaw = cell(row, "sex").toLowerCase();
    const sex = SEX[sexRaw];
    if (!sex) problems.push({ line, field: "sex", message: `"${cell(row, "sex")}" is not male, female, other or unknown` });

    const consent = (key: string) => {
      const v = cell(row, key).toLowerCase();
      if (YES.has(v)) return true;
      if (!NO.has(v)) problems.push({ line, field: key, message: `"${cell(row, key)}" should be yes or no` });
      return false;
    };
    const consentReminders = consent("consentReminders");
    const consentBroadcasts = consent("consentBroadcasts");

    const dob = cell(row, "dateOfBirth");
    const parsed = patientSchema.safeParse({
      firstName: cell(row, "firstName"),
      lastName: cell(row, "lastName"),
      sex: sex ?? "unknown",
      dateOfBirth: dob ? normalizeDate(dob) : "",
      statedAgeYears: cell(row, "statedAgeYears"),
      mobile: cell(row, "mobile"),
      altPhone: cell(row, "altPhone"),
      email: cell(row, "email"),
      addressLine: cell(row, "addressLine"),
      city: cell(row, "city"),
    });
    if (!parsed.success) {
      for (const issue of parsed.error.issues) problems.push({ line, field: String(issue.path[0] ?? "row"), message: issue.message });
      return;
    }
    if ((consentReminders || consentBroadcasts) && !parsed.data.mobile) {
      problems.push({ line, field: "mobile", message: "WhatsApp consent needs a mobile number" });
    }
    if (parsed.data.dateOfBirth && parsed.data.dateOfBirth > today) {
      problems.push({ line, field: "dateOfBirth", message: "Date of birth is in the future" });
    }

    // The same person twice in one file.
    const key = `${normalizeName(`${parsed.data.firstName} ${parsed.data.lastName ?? ""}`)}|${normalizeMobile(parsed.data.mobile) ?? ""}|${parsed.data.dateOfBirth ?? parsed.data.statedAgeYears ?? ""}`;
    const earlier = seen.get(key);
    if (earlier) problems.push({ line, field: "row", message: `Same patient as line ${earlier}` });
    else seen.set(key, line);

    valid.push({ line, patient: parsed.data as PatientInput, consentReminders, consentBroadcasts });
  });

  const badLines = new Set(problems.map((p) => p.line));
  return { valid: valid.filter((r) => !badLines.has(r.line)), problems };
}

export const TEMPLATE_CSV =
  "first_name,last_name,sex,date_of_birth,age,mobile,email,address,city,consent_reminders,consent_broadcasts\r\n" +
  "Asha,Rao,female,1988-04-12,,9845012345,asha@example.com,12 MG Road,Bengaluru,yes,no\r\n" +
  "Ravi,Kumar,male,,54,9845098765,,,Mysuru,yes,yes\r\n";
