import { describe, expect, it } from "vitest";
import { expiresWithin, isExpired, pickBatch, stockFlags, suggestQuantity } from "@/features/pharmacy/stock-rules";
import { fingerprint } from "@/lib/idempotency";

const today = "2026-10-16";

describe("batches", () => {
  const batches = [
    { id: "late", expiryDate: "2027-12-31", quantity: 100 },
    { id: "soon", expiryDate: "2026-11-30", quantity: 5 },
    { id: "gone", expiryDate: "2026-10-15", quantity: 50 },
    { id: "empty", expiryDate: "2026-11-01", quantity: 0 },
  ];

  it("knows expired and soon-to-expire stock", () => {
    expect(isExpired("2026-10-15", today)).toBe(true);
    expect(isExpired("2026-10-16", today)).toBe(false);
    expect(expiresWithin("2026-11-30", today, 90)).toBe(true);
    expect(expiresWithin("2027-12-31", today, 90)).toBe(false);
    expect(expiresWithin("2026-10-15", today, 90)).toBe(false);
  });

  it("picks the earliest usable expiry that covers the quantity (FEFO)", () => {
    expect(pickBatch(batches, 3, today)?.id).toBe("soon");
    expect(pickBatch(batches, 10, today)?.id).toBe("late");
    expect(pickBatch(batches.filter((b) => b.id !== "late"), 10, today)?.id).toBe("soon");
    expect(pickBatch([batches[2]], 1, today)).toBeUndefined();
  });
});

describe("quantity to dispense", () => {
  it("uses the prescribed quantity, else dose x frequency x days for countable forms", () => {
    expect(suggestQuantity({ quantity: 12, form: "tablet", dose: "1 tablet", frequency: "TDS", durationDays: 5 })).toBe(12);
    expect(suggestQuantity({ quantity: null, form: "tablet", dose: "1 tablet", frequency: "TDS", durationDays: 3 })).toBe(9);
    expect(suggestQuantity({ quantity: null, form: "capsule", dose: "2 capsules", frequency: "bd", durationDays: 5 })).toBe(20);
    expect(suggestQuantity({ quantity: null, form: "tablet", dose: "0.5 tablet", frequency: "OD", durationDays: 3 })).toBe(2);
    expect(suggestQuantity({ quantity: null, form: "capsule", dose: "1 capsule", frequency: "Weekly", durationDays: 56 })).toBe(8);
    expect(suggestQuantity({ quantity: null, form: "syrup", dose: "5 ml", frequency: "TDS", durationDays: 3 })).toBeNull();
    expect(suggestQuantity({ quantity: null, form: "tablet", dose: "1 tablet", frequency: "SOS", durationDays: 3 })).toBeNull();
  });
});

describe("alerts", () => {
  const now = new Date("2026-10-16T10:00:00Z");
  const base = { reorderLevel: 10, today, now, batches: [{ id: "a", expiryDate: "2027-12-31", quantity: 20 }] };

  it("flags out, low, expiring, expired and slow stock", () => {
    expect(stockFlags({ ...base, onHand: 0, batches: [], lastMovedAt: null })).toEqual(["out"]);
    // Never stocked and no reorder level: not an alert.
    expect(stockFlags({ ...base, reorderLevel: 0, onHand: 0, batches: [], lastMovedAt: null })).toEqual([]);
    expect(stockFlags({ ...base, reorderLevel: 0, onHand: 0, batches: [{ id: "x", expiryDate: "2027-01-01", quantity: 0 }], lastMovedAt: null })).toEqual(["out"]);
    expect(stockFlags({ ...base, onHand: 8, lastMovedAt: now })).toEqual(["low"]);
    expect(stockFlags({ ...base, onHand: 20, batches: [{ id: "b", expiryDate: "2026-12-01", quantity: 20 }], lastMovedAt: now })).toEqual(["expiring"]);
    expect(stockFlags({ ...base, onHand: 20, batches: [{ id: "b", expiryDate: "2026-10-01", quantity: 20 }], lastMovedAt: now })).toEqual(["expired"]);
    expect(stockFlags({ ...base, onHand: 20, lastMovedAt: new Date("2026-06-01T00:00:00Z") })).toEqual(["slow"]);
    // Newly received stock is not "slow".
    expect(stockFlags({ ...base, onHand: 20, lastMovedAt: new Date("2026-10-10T00:00:00Z") })).toEqual([]);
  });
});

describe("idempotency fingerprints", () => {
  it("ignore key order and undefined fields, but not values", () => {
    expect(fingerprint({ a: 1, b: [1, 2], c: undefined })).toBe(fingerprint({ b: [1, 2], a: 1 }));
    expect(fingerprint({ a: 1 })).not.toBe(fingerprint({ a: 2 }));
    expect(fingerprint({ lines: [{ q: 1 }, { q: 2 }] })).not.toBe(fingerprint({ lines: [{ q: 2 }, { q: 1 }] }));
  });
});
