import { describe, expect, it } from "vitest";
import { reminderDue, toWhatsAppNumber } from "@/features/messaging/messaging-rules";
import { mapHeaders, normalizeDate, parseCsv, validateRows } from "@/features/import/import-rules";
import { decryptSecret, encryptSecret, isEncryptionConfigured } from "@/lib/crypto";

describe("WhatsApp numbers", () => {
  it("builds full international numbers from local or international input", () => {
    expect(toWhatsAppNumber("98450 12345", "91")).toBe("919845012345");
    expect(toWhatsAppNumber("+91 98450-12345", "91")).toBe("919845012345");
    expect(toWhatsAppNumber("09845012345", "91")).toBe("919845012345");
    expect(toWhatsAppNumber("+44 7700 900123", "91")).toBe("447700900123");
    expect(toWhatsAppNumber("12345", "91")).toBeNull();
    expect(toWhatsAppNumber(null)).toBeNull();
  });
});

describe("reminder window", () => {
  const start = new Date("2026-10-20T10:00:00Z");
  it("is due from N hours before until the appointment", () => {
    expect(reminderDue(start, new Date("2026-10-19T09:59:00Z"), 24)).toBe(false);
    expect(reminderDue(start, new Date("2026-10-19T10:00:00Z"), 24)).toBe(true);
    expect(reminderDue(start, new Date("2026-10-20T09:59:00Z"), 24)).toBe(true);
    expect(reminderDue(start, new Date("2026-10-20T10:00:00Z"), 24)).toBe(false);
  });
});

describe("CSV parsing", () => {
  it("handles quotes, embedded commas and newlines, CRLF and a BOM", () => {
    const rows = parseCsv('\uFEFFfirst_name,address\r\n"Asha","12, MG Road"\r\n"Ravi ""RK""","line 1\nline 2"\n\n');
    expect(rows).toEqual([
      ["first_name", "address"],
      ["Asha", "12, MG Road"],
      ['Ravi "RK"', "line 1\nline 2"],
    ]);
  });

  it("maps headers with aliases, any case and separators", () => {
    const { map, unknown, missing } = mapHeaders(["First Name", "Surname", "GENDER", "DOB", "Phone", "favourite colour"]);
    expect(map).toMatchObject({ firstName: 0, lastName: 1, sex: 2, dateOfBirth: 3, mobile: 4 });
    expect(unknown).toEqual(["favourite colour"]);
    expect(missing).toEqual([]);
    expect(mapHeaders(["name", "mobile"]).missing).toEqual(["sex"]);
  });

  it("normalises day-first dates", () => {
    expect(normalizeDate("7/3/1990")).toBe("1990-03-07");
    expect(normalizeDate("1990-03-07")).toBe("1990-03-07");
  });
});

describe("row validation", () => {
  const today = "2026-10-16";
  const header = ["first_name", "last_name", "sex", "date_of_birth", "age", "mobile", "consent_reminders"];

  it("accepts good rows and reports every problem with its line", () => {
    const { valid, problems } = validateRows(
      [
        header,
        ["Asha", "Rao", "F", "12/04/1988", "", "9845012345", "yes"],
        ["", "NoFirst", "male", "", "30", "", ""],
        ["Ravi", "Kumar", "robot", "", "54", "9845098765", "maybe"],
        ["Old", "Timer", "male", "", "", "", ""],
        ["Mina", "Das", "female", "", "40", "", "yes"],
        ["Asha", "Rao", "female", "1988-04-12", "", "+91 98450 12345", "no"],
      ],
      today,
    );
    expect(valid.map((v) => v.patient.firstName)).toEqual(["Asha"]);
    expect(valid[0].patient.dateOfBirth).toBe("1988-04-12");
    expect(valid[0].consentReminders).toBe(true);
    const byLine = (line: number) => problems.filter((p) => p.line === line).map((p) => p.field);
    expect(byLine(3)).toContain("firstName");
    expect(byLine(4)).toEqual(expect.arrayContaining(["sex", "consentReminders"]));
    expect(byLine(5)).toContain("dateOfBirth"); // neither DOB nor age
    expect(byLine(6)).toContain("mobile"); // consent without a mobile
    expect(problems.find((p) => p.line === 7)?.message).toBe("Same patient as line 2");
  });

  it("refuses files without the required columns, or too many rows", () => {
    expect(validateRows([["last_name"], ["x"]], today).problems[0].message).toMatch(/Missing column/);
    expect(validateRows([header], today).problems[0].message).toMatch(/no patient rows/);
    const big = [header, ...Array.from({ length: 2001 }, (_, i) => [`P${i}`, "", "male", "", "30", "", ""])];
    expect(validateRows(big, today).problems[0].message).toMatch(/At most 2000/);
  });
});

describe("secrets at rest", () => {
  it("round-trips, never stores the plain text, and detects tampering", () => {
    process.env.DATA_ENCRYPTION_KEY = Buffer.alloc(32, 3).toString("base64");
    expect(isEncryptionConfigured()).toBe(true);
    const stored = encryptSecret("EAAG-secret-token");
    expect(stored).not.toContain("secret");
    expect(stored.startsWith("v1:")).toBe(true);
    expect(encryptSecret("EAAG-secret-token")).not.toBe(stored); // fresh IV each time
    expect(decryptSecret(stored)).toBe("EAAG-secret-token");
    const parts = stored.split(":");
    parts[3] = Buffer.from("tampered").toString("base64");
    expect(() => decryptSecret(parts.join(":"))).toThrow();
  });
});
