import { describe, expect, it } from "vitest";
import { categoryOf, csvCell, isClinicalAction, parseFilters, redactDetails, toSearchParams } from "@/features/audit/audit-rules";
import { addDaysToDateString } from "@/lib/time";

describe("redaction", () => {
  it("withholds clinical details but keeps everything else", () => {
    expect(isClinicalAction("PRESCRIPTION_ITEM_ADDED")).toBe(true);
    expect(isClinicalAction("ALLERGY_CORRECTED")).toBe(true);
    expect(isClinicalAction("PATIENT_VIEWED")).toBe(false);
    expect(redactDetails("PRESCRIPTION_ITEM_ADDED", { drug: "Warfarin 5" })).toEqual({ withheld: expect.any(String) });
    expect(redactDetails("DIAGNOSIS_ADDED", { code: "F32.9" })).toEqual({ withheld: expect.any(String) });
    expect(redactDetails("PAYMENT_RECORDED", { amount: "500" })).toEqual({ amount: "500" });
    expect(redactDetails("LOGIN", null)).toBeNull();
    // Free text is withheld by default; amounts and statuses stay.
    expect(redactDetails("PATIENT_SEARCH", { query: "Asha 98450", results: 2 })).toEqual({ results: 2, withheldFields: 1 });
    expect(redactDetails("LOGIN_FAILED", { email: "mypassword123" })).toEqual({ withheldFields: 1 });
    expect(redactDetails("EMERGENCY_ADMITTED", { label: "Chest pain, unconscious" })).toEqual({ withheldFields: 1 });
    expect(redactDetails("APPOINTMENT_CANCELLED", { reason: "Patient has HIV clinic" })).toEqual({ withheldFields: 1 });
  });

  it("puts events in the right category", () => {
    expect(categoryOf("PATIENT_VIEWED")).toBe("access");
    expect(categoryOf("ENCOUNTER_VIEWED")).toBe("access");
    expect(categoryOf("ACTION_DENIED")).toBe("security");
    expect(categoryOf("LOGIN_FAILED")).toBe("sign-in");
    expect(categoryOf("LOGIN_REFUSED")).toBe("security");
    expect(categoryOf("VITALS_RECORDED")).toBe("clinical");
    expect(categoryOf("REFUND_RECORDED")).toBe("billing");
    expect(categoryOf("STOCK_ADJUSTED")).toBe("pharmacy");
    expect(categoryOf("APPOINTMENT_BOOKED")).toBe("front desk");
    expect(categoryOf("STAFF_CREATED")).toBe("administration");
  });
});

describe("filters", () => {
  const today = "2026-10-16";
  it("defaults to the last 30 days and ignores junk", () => {
    expect(parseFilters({}, today, addDaysToDateString)).toEqual({ from: "2026-09-16", to: "2026-10-16", actorId: undefined, patientMrn: undefined, action: undefined, outcome: undefined, severity: undefined });
    const f = parseFilters({ from: "nope", to: "2026-10-01", actor: "x'; drop", mrn: " p-000123 ", action: "drop table", outcome: "denied", severity: "loud" }, today, addDaysToDateString);
    expect(f).toMatchObject({ to: "2026-10-01", patientMrn: "P-000123", outcome: "denied", actorId: undefined, action: undefined, severity: undefined });
    // A range that ends before it starts is clamped.
    expect(f.from <= f.to).toBe(true);
  });

  it("round-trips through the URL", () => {
    const f = parseFilters({ from: "2026-10-01", to: "2026-10-10", mrn: "P-000001", outcome: "denied" }, today, addDaysToDateString);
    expect(parseFilters(Object.fromEntries(new URLSearchParams(toSearchParams(f))), today, addDaysToDateString)).toEqual(f);
  });
});

describe("CSV", () => {
  it("escapes quotes, commas and spreadsheet formulas", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell('say "hi", ok')).toBe('"say ""hi"", ok"');
    expect(csvCell("=HYPERLINK(\"x\")")).toBe('"\'=HYPERLINK(""x"")"');
    expect(csvCell("-1+2")).toBe("'-1+2");
    expect(csvCell(null)).toBe("");
    expect(csvCell({ a: 1 })).toBe('"{""a"":1}"');
  });
});
