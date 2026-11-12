import { describe, it, expect } from "vitest";
import { instantOf, localDateIn, onDate, sameInstant, wallClockToInstant, windowAround } from "../instance-time.js";

const PT = "America/Los_Angeles";

describe("wallClockToInstant", () => {
  it("converts Pacific standard time", () => {
    expect(wallClockToInstant("2026-11-12T11:00:00", PT)).toBe("2026-11-12T19:00:00.000Z");
  });
  it("converts Pacific daylight time", () => {
    expect(wallClockToInstant("2026-07-02T14:00:00", PT)).toBe("2026-07-02T21:00:00.000Z");
  });
  it("puts a 5pm Pacific meeting on the next UTC day", () => {
    expect(wallClockToInstant("2026-11-12T17:00:00", PT)).toBe("2026-11-13T01:00:00.000Z");
  });
  it("uses the offset in force after a DST change", () => {
    // 2026-11-01 01:30 happens twice; 3:00 the same day is unambiguous PST.
    expect(wallClockToInstant("2026-11-01T03:00:00", PT)).toBe("2026-11-01T11:00:00.000Z");
    expect(wallClockToInstant("2026-03-08T03:00:00", PT)).toBe("2026-03-08T10:00:00.000Z");
  });
  it("rejects garbage", () => {
    expect(() => wallClockToInstant("nope", PT)).toThrow();
  });
});

describe("instantOf", () => {
  it("reads Graph's suffix-less UTC date-time", () => {
    expect(instantOf("2026-11-12T22:00:00.0000000", "UTC")).toBe(Date.parse("2026-11-12T22:00:00Z"));
  });
  it("reads Google's offset date-time", () => {
    expect(instantOf("2026-11-12T14:00:00-08:00", PT)).toBe(Date.parse("2026-11-12T22:00:00Z"));
  });
  it("reads a suffix-less wall clock in a named zone", () => {
    expect(instantOf("2026-11-12T14:00:00", PT)).toBe(Date.parse("2026-11-12T22:00:00Z"));
  });
  it("is NaN when missing", () => {
    expect(instantOf(undefined)).toBeNaN();
  });
});

describe("localDateIn / onDate (series time-only change)", () => {
  it("reads the Pacific date of an evening instant that is the next UTC day", () => {
    expect(localDateIn(Date.parse("2026-10-09T01:00:00Z"), PT)).toBe("2026-10-08");
  });
  it("keeps the series' first date and takes the new time", () => {
    expect(onDate("2026-10-08", "2026-11-12T11:00:00", "2026-11-12T12:00:00")).toEqual({
      start: "2026-10-08T11:00:00",
      end: "2026-10-08T12:00:00",
    });
  });
  it("keeps an end that runs past midnight on the following day", () => {
    expect(onDate("2026-10-08", "2026-11-12T23:30:00", "2026-11-13T00:30:00")).toEqual({
      start: "2026-10-08T23:30:00",
      end: "2026-10-09T00:30:00",
    });
  });
});

describe("windowAround / sameInstant", () => {
  it("spans one minute either side, in UTC", () => {
    expect(windowAround("2026-11-13T01:00:00.000Z")).toEqual({
      from: "2026-11-13T00:59:00.000Z",
      to: "2026-11-13T01:01:00.000Z",
    });
  });
  it("compares instants, not strings", () => {
    expect(sameInstant(instantOf("2026-11-12T14:00:00-08:00"), Date.parse("2026-11-12T22:00:00.000Z"))).toBe(true);
    expect(sameInstant(NaN, NaN)).toBe(false);
  });
});
