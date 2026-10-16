import { describe, expect, it } from "vitest";
import { findOverlap } from "@/features/scheduling/schedule-rules";

describe("findOverlap", () => {
  it("accepts split shifts on the same day", () => {
    expect(
      findOverlap([
        { weekday: 1, startTime: "09:00", endTime: "13:00" },
        { weekday: 1, startTime: "17:00", endTime: "20:00" },
      ]),
    ).toBeNull();
  });

  it("accepts back-to-back windows", () => {
    expect(
      findOverlap([
        { weekday: 2, startTime: "09:00", endTime: "12:00" },
        { weekday: 2, startTime: "12:00", endTime: "14:00" },
      ]),
    ).toBeNull();
  });

  it("rejects overlapping windows on one day, regardless of order", () => {
    expect(
      findOverlap([
        { weekday: 3, startTime: "12:00", endTime: "16:00" },
        { weekday: 3, startTime: "09:00", endTime: "13:00" },
      ]),
    ).toMatch(/Wednesday: 09:00–13:00 overlaps 12:00–16:00/);
  });

  it("ignores identical windows on different days", () => {
    expect(
      findOverlap([
        { weekday: 1, startTime: "09:00", endTime: "13:00" },
        { weekday: 2, startTime: "09:00", endTime: "13:00" },
      ]),
    ).toBeNull();
  });

  it("rejects a window that ends before it starts", () => {
    expect(findOverlap([{ weekday: 5, startTime: "18:00", endTime: "09:00" }])).toMatch(/Friday: the end time/);
  });
});
