import { describe, expect, it } from "vitest";
import {
  addDaysToDateString,
  dayOfWeekFromDateString,
  isValidDateString,
  isValidTimeString,
  normalizeTimeString,
  todayInTimeZone,
  toZonedDateTime,
  zonedTimeToUtc,
} from "@/lib/time";

describe("zonedTimeToUtc", () => {
  it("converts clinic-local time in a fixed-offset zone", () => {
    // IST is UTC+05:30 all year
    expect(zonedTimeToUtc("2026-10-16", "10:00", "Asia/Kolkata").toISOString()).toBe(
      "2026-10-16T04:30:00.000Z",
    );
  });

  it("handles a time that crosses midnight in UTC", () => {
    expect(zonedTimeToUtc("2026-10-16", "02:00", "Asia/Kolkata").toISOString()).toBe(
      "2026-10-15T20:30:00.000Z",
    );
  });

  it("uses the correct offset on each side of a DST change", () => {
    // New York: EDT (UTC-4) in summer, EST (UTC-5) in winter
    expect(zonedTimeToUtc("2026-07-01", "09:00", "America/New_York").toISOString()).toBe(
      "2026-07-01T13:00:00.000Z",
    );
    expect(zonedTimeToUtc("2026-12-01", "09:00", "America/New_York").toISOString()).toBe(
      "2026-12-01T14:00:00.000Z",
    );
  });

  it("round-trips through toZonedDateTime", () => {
    const instant = zonedTimeToUtc("2026-03-08", "15:30", "America/New_York");
    expect(toZonedDateTime(instant, "America/New_York")).toEqual({
      date: "2026-03-08",
      time: "15:30",
    });
  });
});

describe("calendar helpers", () => {
  it("computes the weekday of a date string without timezone drift", () => {
    expect(dayOfWeekFromDateString("2026-10-16")).toBe(5); // Friday
    expect(dayOfWeekFromDateString("2026-10-18")).toBe(0); // Sunday
  });

  it("adds days across month and year boundaries", () => {
    expect(addDaysToDateString("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysToDateString("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("returns today's date in the clinic zone, not UTC", () => {
    // 20:00 UTC on Oct 15 is already Oct 16 in India
    const now = new Date("2026-10-15T20:00:00Z");
    expect(todayInTimeZone("Asia/Kolkata", now)).toBe("2026-10-16");
    expect(todayInTimeZone("UTC", now)).toBe("2026-10-15");
  });

  it("validates date and time strings", () => {
    expect(isValidDateString("2026-02-29")).toBe(false);
    expect(isValidDateString("2028-02-29")).toBe(true);
    expect(isValidDateString("2026-1-5")).toBe(false);
    expect(isValidTimeString("09:30")).toBe(true);
    expect(isValidTimeString("24:00")).toBe(false);
    expect(normalizeTimeString("9:05:00")).toBe("09:05");
  });
});

describe("timezoneOptions", async () => {
  const { timezoneOptions } = await import("@/lib/timezones");

  it("always offers Asia/Kolkata even when ICU lists only Asia/Calcutta", () => {
    expect(timezoneOptions()).toContain("Asia/Kolkata");
  });

  it("always includes the clinic's current zone so a save cannot silently change it", () => {
    expect(timezoneOptions("Etc/GMT-3")).toContain("Etc/GMT-3");
  });
});
