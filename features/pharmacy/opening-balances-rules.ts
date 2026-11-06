// Pure rules for bringing dues over from the old software (unit tested). One
// row per party, or per unpaid bill: rows for one party add up.
import { parseExpiry, dateOrderOf } from "./stock-import-rules";
import { isValidDateString } from "@/lib/time";

export const MAX_BALANCE_ROWS = 2000;
export const PARTY_TYPES = ["customer", "supplier"] as const;
export type PartyType = (typeof PARTY_TYPES)[number];

const COLUMNS: Record<string, string[]> = {
  type: ["type", "party type", "account type"],
  name: ["name", "party", "party name", "customer", "supplier"],
  phone: ["phone", "mobile"],
  gstin: ["gstin", "gst no", "gst number"],
  amount: ["amount", "balance", "outstanding", "due", "closing balance"],
  asOf: ["as of", "as on", "date"],
  reference: ["reference", "bill no", "bill number", "ref"],
};

const normHeader = (h: string) => h.trim().toLowerCase().replace(/[_\-]+/g, " ").replace(/\s+/g, " ");
const AMOUNT = /^-?\d{1,8}(\.\d{1,2})?$/;

export const normalizePartyName = (name: string) => name.trim().toLowerCase().replace(/\s+/g, " ");

export type BalanceRow = { line: number; type: PartyType; name: string; normalized: string; phone: string | null; gstin: string | null; amount: string; asOf: string; reference: string | null };
export type BalanceProblem = { line: number; field: string; message: string };

export function validateBalanceRows(rows: string[][], today: string): { valid: BalanceRow[]; problems: BalanceProblem[] } {
  if (rows.length < 2) return { valid: [], problems: [{ line: 1, field: "file", message: "The file has no rows." }] };
  const map: Record<string, number> = {};
  rows[0].forEach((raw, index) => {
    const h = normHeader(raw);
    const key = Object.entries(COLUMNS).find(([k, aliases]) => normHeader(k.replace(/([A-Z])/g, " $1")) === h || aliases.includes(h))?.[0];
    if (key && map[key] === undefined) map[key] = index;
  });
  const missing = ["type", "name", "amount"].filter((k) => map[k] === undefined);
  if (missing.length) return { valid: [], problems: [{ line: 1, field: "header", message: `Missing column: ${missing.join(", ")}` }] };
  if (rows.length - 1 > MAX_BALANCE_ROWS) return { valid: [], problems: [{ line: 1, field: "file", message: `At most ${MAX_BALANCE_ROWS} rows per file. Split it.` }] };

  const cell = (row: string[], key: string) => (map[key] === undefined ? "" : (row[map[key]] ?? "").trim());
  const order = dateOrderOf(rows.slice(1).map((row) => cell(row, "asOf")));
  const problems: BalanceProblem[] = [];
  const valid: BalanceRow[] = [];
  const seen = new Map<string, number>();

  rows.slice(1).forEach((row, i) => {
    const line = i + 2;
    const before = problems.length;
    const problem = (field: string, message: string) => problems.push({ line, field, message });

    const type = cell(row, "type").toLowerCase() as PartyType;
    if (!(PARTY_TYPES as readonly string[]).includes(type)) problem("type", `"${cell(row, "type")}" is not customer or supplier`);
    const name = cell(row, "name").replace(/\s+/g, " ");
    if (!name) problem("name", "Name is empty");
    else if (name.length > 200) problem("name", "Name is longer than 200 characters");
    const amount = cell(row, "amount").replace(/,/g, "");
    if (!AMOUNT.test(amount)) problem("amount", `"${cell(row, "amount")}" is not an amount like 1500 or 1500.50`);
    else if (Number(amount) === 0) problem("amount", "The balance is zero: leave this row out");
    const raw = cell(row, "asOf");
    const asOf = raw ? parseExpiry(raw, order) : today;
    if (!isValidDateString(asOf)) problem("asOf", `"${raw}" is not a date`);
    else if (asOf > today) problem("asOf", "The date is in the future");
    const reference = cell(row, "reference").slice(0, 100) || null;

    const key = `${type}|${normalizePartyName(name)}|${reference ?? ""}`;
    const earlier = seen.get(key);
    if (earlier) problem("name", `Same party and reference as line ${earlier}`);
    else seen.set(key, line);

    if (problems.length > before) return;
    valid.push({ line, type, name, normalized: normalizePartyName(name), phone: cell(row, "phone").slice(0, 20) || null, gstin: cell(row, "gstin").toUpperCase().slice(0, 15) || null, amount, asOf, reference });
  });
  return { valid, problems };
}

export const BALANCE_TEMPLATE_CSV =
  "type,name,phone,gstin,amount,as_of,reference\r\n" +
  "customer,Sunrise Nursing Home,9876543210,,12500.00,31/03/2027,Opening\r\n" +
  "customer,Ramesh Kumar,9812345678,,480.00,31/03/2027,\r\n" +
  "supplier,Apollo Distributors,,,86400.50,31/03/2027,INV-2291\r\n" +
  "supplier,Apollo Distributors,,,12000.00,31/03/2027,INV-2307\r\n";
