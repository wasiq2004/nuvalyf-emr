import { describe, expect, it } from "vitest";
import { fromMinor, toMinor } from "@/lib/money";
import { balanceOf, invoiceTotals, lineAmount, paymentState } from "@/features/billing/billing-rules";

describe("money", () => {
  it("converts exactly, without floating point drift", () => {
    expect(toMinor("0.1")).toBe(10);
    expect(toMinor("19.99")).toBe(1999);
    expect(toMinor("400")).toBe(40000);
    expect(toMinor(0.3)).toBe(30);
    expect(toMinor("-5.50")).toBe(-550);
    expect(fromMinor(1999)).toBe("19.99");
    expect(fromMinor(5)).toBe("0.05");
    expect(fromMinor(-550)).toBe("-5.50");
    expect(() => toMinor("1.234")).toThrow();
    expect(() => toMinor("abc")).toThrow();
  });

  it("adds up lines the way an accountant would", () => {
    // 3 x 33.33 + 0.01 = 100.00 exactly (floats would give 99.99000000000001)
    expect(lineAmount("33.33", 3)).toBe("99.99");
    expect(invoiceTotals([{ amount: "99.99" }, { amount: "0.01" }], "0")).toEqual({ subtotal: "100.00", total: "100.00" });
    expect(invoiceTotals([{ amount: "100.00" }], "12.50")).toEqual({ subtotal: "100.00", total: "87.50" });
    expect(() => invoiceTotals([{ amount: "10.00" }], "10.01")).toThrow(RangeError);
  });

  it("derives payment state and balance", () => {
    expect(paymentState("100.00", "0.00")).toBe("unpaid");
    expect(paymentState("100.00", "40.00")).toBe("partial");
    expect(paymentState("100.00", "100.00")).toBe("paid");
    expect(paymentState("0.00", "0.00")).toBe("paid");
    expect(balanceOf("100.00", "40.00")).toBe("60.00");
    expect(balanceOf("100.00", "100.00")).toBe("0.00");
  });
});
