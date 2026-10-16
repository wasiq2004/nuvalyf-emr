import { describe, expect, it } from "vitest";
import { computeAvailableSlots, generateStartTimes } from "@/features/scheduling/slots";
import { ageOn, isLikelyDuplicate, normalizeMobile, type DuplicateCandidate } from "@/features/patients/patient-rules";
import { issueDuplicateToken, verifyDuplicateToken, DUPLICATE_TOKEN_TTL_MS } from "@/features/patients/duplicate-token";
import { sortQueue, waitMinutes } from "@/features/queue/queue-rules";
import { zonedTimeToUtc } from "@/lib/time";

const TZ = "Asia/Kolkata";

describe("booking slots", () => {
  it("keeps whole bookings inside each window of a split shift", () => {
    const windows = [
      { startTime: "09:00", endTime: "10:00" },
      { startTime: "17:00", endTime: "17:45" },
    ];
    expect(generateStartTimes(windows, 15, 30)).toEqual(["09:00", "09:15", "09:30", "17:00", "17:15"]);
  });

  it("excludes slots overlapping an existing booking of any length", () => {
    const busy = [{ start: zonedTimeToUtc("2026-10-19", "09:20", TZ), end: zonedTimeToUtc("2026-10-19", "09:40", TZ) }];
    const slots = computeAvailableSlots({
      date: "2026-10-19",
      windows: [{ startTime: "09:00", endTime: "10:00" }],
      busy,
      now: new Date("2026-10-01T00:00:00Z"),
      timeZone: TZ,
      gridMinutes: 15,
      durationMinutes: 15,
    });
    expect(slots.map((s) => s.time)).toEqual(["09:00", "09:45"]);
    expect(slots[0]).toMatchObject({ startsAt: "2026-10-19T03:30:00.000Z", endsAt: "2026-10-19T03:45:00.000Z" });
  });

  it("drops slots that already started", () => {
    const slots = computeAvailableSlots({
      date: "2026-10-19",
      windows: [{ startTime: "09:00", endTime: "10:00" }],
      busy: [],
      now: zonedTimeToUtc("2026-10-19", "09:10", TZ),
      timeZone: TZ,
      gridMinutes: 15,
      durationMinutes: 15,
    });
    expect(slots.map((s) => s.time)).toEqual(["09:15", "09:30", "09:45"]);
  });
});

describe("patient rules", () => {
  it("treats +91, 0-prefixed and spaced mobiles as the same number", () => {
    expect(normalizeMobile("+91 98450 12345")).toBe("9845012345");
    expect(normalizeMobile("09845012345")).toBe("9845012345");
    expect(normalizeMobile("98450-12345")).toBe("9845012345");
    expect(normalizeMobile("123")).toBeNull();
  });

  it("ages a stated age forward from the day it was stated", () => {
    expect(ageOn({ dateOfBirth: null, statedAgeYears: 40, statedAgeOn: "2024-06-01" }, "2026-10-19")).toBe(42);
    expect(ageOn({ dateOfBirth: "2000-10-20", statedAgeYears: null, statedAgeOn: null }, "2026-10-19")).toBe(25);
    expect(ageOn({ dateOfBirth: "2000-10-19", statedAgeYears: null, statedAgeOn: null }, "2026-10-19")).toBe(26);
  });

  const candidate = (overrides: Partial<DuplicateCandidate>): DuplicateCandidate => ({
    id: "x",
    mrn: "M1",
    name: "Asha Rao",
    nameSimilarity: 0,
    sameMobile: false,
    sameDob: false,
    ageGap: null,
    ...overrides,
  });

  it("never treats a shared family mobile alone as a duplicate", () => {
    expect(isLikelyDuplicate(candidate({ sameMobile: true, nameSimilarity: 0.1 }))).toBe(false);
  });

  it("flags a similar name plus another match", () => {
    expect(isLikelyDuplicate(candidate({ nameSimilarity: 0.8, sameMobile: true }))).toBe(true);
    expect(isLikelyDuplicate(candidate({ nameSimilarity: 0.8, ageGap: 1 }))).toBe(true);
    expect(isLikelyDuplicate(candidate({ nameSimilarity: 0.8 }))).toBe(false);
  });
});

describe("duplicate-search token", () => {
  const secret = "test-secret";
  const base = { clinicId: "c1", userId: "u1", fields: { firstName: "Asha", lastName: "Rao", mobile: "+91 98450 12345" } };

  it("verifies for the same details (normalised)", () => {
    const token = issueDuplicateToken({ ...base, likelyIds: ["p1"] }, secret);
    const check = verifyDuplicateToken(token, { ...base, fields: { firstName: " asha ", lastName: "RAO", mobile: "9845012345" } }, secret);
    expect(check).toEqual({ ok: true, likelyIds: ["p1"] });
  });

  it("rejects missing, tampered, expired and mismatched tokens", () => {
    const token = issueDuplicateToken({ ...base, likelyIds: [] }, secret);
    expect(verifyDuplicateToken(undefined, base, secret)).toMatchObject({ reason: "missing" });
    expect(verifyDuplicateToken(token.replace(/.$/, "x"), base, secret)).toMatchObject({ reason: "invalid" });
    expect(verifyDuplicateToken(token, base, "other-secret")).toMatchObject({ reason: "invalid" });
    expect(verifyDuplicateToken(token, { ...base, userId: "u2" }, secret)).toMatchObject({ reason: "invalid" });
    expect(verifyDuplicateToken(token, { ...base, now: Date.now() + DUPLICATE_TOKEN_TTL_MS + 1 }, secret)).toMatchObject({
      reason: "expired",
    });
    expect(verifyDuplicateToken(token, { ...base, fields: { ...base.fields, mobile: "9999999999" } }, secret)).toMatchObject({
      reason: "mismatch",
    });
  });
});

describe("queue order", () => {
  const at = (minute: number) => new Date(Date.UTC(2026, 9, 19, 4, minute));

  it("puts emergencies first even when manually positioned last", () => {
    const sorted = sortQueue([
      { id: "routine-1", isEmergency: false, position: 0, arrivedAt: at(0) },
      { id: "emergency", isEmergency: true, position: 99, arrivedAt: at(30) },
      { id: "routine-2", isEmergency: false, position: 1, arrivedAt: at(5) },
    ]);
    expect(sorted.map((e) => e.id)).toEqual(["emergency", "routine-1", "routine-2"]);
  });

  it("orders routine patients by position, then arrival", () => {
    const sorted = sortQueue([
      { id: "b", isEmergency: false, position: 0, arrivedAt: at(10) },
      { id: "a", isEmergency: false, position: 0, arrivedAt: at(5) },
      { id: "moved-up", isEmergency: false, position: -1, arrivedAt: at(20) },
    ]);
    expect(sorted.map((e) => e.id)).toEqual(["moved-up", "a", "b"]);
  });

  it("stops the wait clock when called", () => {
    expect(waitMinutes({ arrivedAt: at(0) }, at(25))).toBe(25);
    expect(waitMinutes({ arrivedAt: at(0), calledAt: at(12) }, at(25))).toBe(12);
  });
});
