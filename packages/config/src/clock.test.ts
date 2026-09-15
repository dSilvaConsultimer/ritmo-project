import { describe, expect, it } from "vitest";
import { DEFAULT_TIME_ZONE, isoDateInTimeZone, todayIsoDate } from "./clock";

describe("isoDateInTimeZone", () => {
  it("resolves the correct calendar day in a timezone behind UTC, near midnight UTC", () => {
    // 2026-09-15T00:30:00Z is still 2026-09-14 21:30 in São Paulo (UTC-3) —
    // the exact class of bug a naive `new Date().toISOString().slice(0,10)`
    // (always UTC) introduces.
    const instant = new Date("2026-09-15T00:30:00Z");
    expect(isoDateInTimeZone(instant, "America/Sao_Paulo")).toBe("2026-09-14");
  });

  it("resolves a different calendar day in a timezone ahead of UTC for the same instant", () => {
    const instant = new Date("2026-09-15T00:30:00Z");
    expect(isoDateInTimeZone(instant, "Asia/Tokyo")).toBe("2026-09-15");
  });

  it("defaults to America/Sao_Paulo when no timezone is given", () => {
    const instant = new Date("2026-09-15T00:30:00Z");
    expect(isoDateInTimeZone(instant)).toBe(isoDateInTimeZone(instant, DEFAULT_TIME_ZONE));
  });
});

describe("todayIsoDate", () => {
  it("is fully deterministic when an explicit `now` is injected — no dependency on the real wall clock", () => {
    const fixedNow = new Date("2026-01-01T12:00:00Z");
    expect(todayIsoDate(DEFAULT_TIME_ZONE, fixedNow)).toBe("2026-01-01");
    expect(todayIsoDate(DEFAULT_TIME_ZONE, fixedNow)).toBe(todayIsoDate(DEFAULT_TIME_ZONE, fixedNow));
  });

  it("uses the real clock when `now` is omitted", () => {
    const realToday = isoDateInTimeZone(new Date(), DEFAULT_TIME_ZONE);
    expect(todayIsoDate()).toBe(realToday);
  });

  it("respects an explicit timezone override alongside an injected `now`", () => {
    const fixedNow = new Date("2026-09-15T00:30:00Z");
    expect(todayIsoDate("America/Sao_Paulo", fixedNow)).toBe("2026-09-14");
    expect(todayIsoDate("Asia/Tokyo", fixedNow)).toBe("2026-09-15");
  });
});
