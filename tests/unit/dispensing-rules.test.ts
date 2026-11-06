import { describe, expect, it } from "vitest";
import { classifyLine, daysLeft, dosageText, quantityForDays } from "@/features/pharmacy/dispensing-rules";

const written = { drugId: "para", dose: "1 tablet", frequency: "BD", durationDays: 30, instructions: "After food" };

describe("the pharmacy's copy", () => {
  it("reads as one line, leaving out what is missing", () => {
    expect(dosageText(written)).toBe("1 tablet · BD · 30 days · After food");
    expect(dosageText({ dose: "5 ml", frequency: null, durationDays: 1, instructions: null })).toBe("5 ml · 1 day");
    expect(dosageText({ dose: null, frequency: null, durationDays: null, instructions: null })).toBe("");
  });

  it("knows how a line differs from what the doctor wrote", () => {
    expect(classifyLine(written, written, "para")).toBe("as_prescribed");
    expect(classifyLine(written, { ...written, frequency: " bd " }, "para")).toBe("as_prescribed");
    expect(classifyLine(written, { ...written, durationDays: 15 }, "para")).toBe("changed");
    expect(classifyLine(written, { ...written, dose: "2 tablets" }, "para")).toBe("changed");
    expect(classifyLine(written, { ...written, instructions: null }, "para")).toBe("changed");
    expect(classifyLine(written, written, "other")).toBe("substituted");
    expect(classifyLine(null, written, "para")).toBe("added");
  });

  it("works quantity out from days, when it can", () => {
    const item = { form: "tablet", dose: "1 tablet", frequency: "BD" };
    expect(quantityForDays(item, 15)).toBe(30);
    expect(quantityForDays({ ...item, dose: "2 tablets" }, 15)).toBe(60);
    expect(quantityForDays(item, 0)).toBeNull();
    expect(quantityForDays(item, 1.5)).toBeNull();
    expect(quantityForDays({ ...item, form: "syrup" }, 15)).toBeNull();
    expect(quantityForDays({ ...item, frequency: "when needed" }, 15)).toBeNull();
  });

  it("works out the days left on a part-filled course", () => {
    expect(daysLeft(60, 30, 60)).toBe(30);
    expect(daysLeft(60, 30, 30)).toBe(15);
    expect(daysLeft(60, 30, 1)).toBe(1);
    expect(daysLeft(60, 30, 0)).toBe(0);
    expect(daysLeft(null, 30, null)).toBe(30);
    expect(daysLeft(10, null, 10)).toBeNull();
  });
});
