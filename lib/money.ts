// Money is stored as NUMERIC(…, 2) and travels as a string; never as a float.
import { DEFAULT_LOCALE } from "@/lib/format";

export function formatMoney(amount: string | number | null | undefined, currency: string): string {
  const value = typeof amount === "string" ? Number(amount) : (amount ?? 0);
  try {
    return new Intl.NumberFormat(DEFAULT_LOCALE, { style: "currency", currency, maximumFractionDigits: 2 }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

/**
 * Exact arithmetic for amounts: work in integer minor units (paise, cents),
 * convert back to a 2-decimal string for the database.
 */
export function toMinor(amount: string | number | null | undefined): number {
  if (amount === null || amount === undefined || amount === "") return 0;
  const text = typeof amount === "number" ? amount.toFixed(2) : amount.trim();
  const match = /^(-)?(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) throw new Error(`Not an amount: ${text}`);
  const minor = Number(match[2]) * 100 + Number((match[3] ?? "").padEnd(2, "0"));
  return match[1] ? -minor : minor;
}

export function fromMinor(minor: number): string {
  if (!Number.isSafeInteger(minor)) throw new Error("Amount out of range");
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(minor);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}
