import { describe, expect, it } from "vitest";
import {
  brl,
  daysInMonth,
  formatDayMonth,
  formatMonthEndShortDate,
  greetingForHour,
} from "./format";

describe("brl", () => {
  it("formats cents as pt-BR currency", () => {
    expect(brl(217_111)).toBe("R$ 2.171,11");
    expect(brl(0)).toBe("R$ 0,00");
  });
});

describe("formatDayMonth", () => {
  /**
   * Live-discovered bug: without an explicit UTC timezone, the formatter
   * rendered a day earlier than the real calendar date whenever the host
   * process's local timezone was behind UTC — "2026-09-05" showed as
   * "04 de setembro". Every date in this codebase is an explicit calendar
   * string, never a real instant, so formatting must never depend on the
   * server's local timezone.
   */
  it("never shifts the day backward regardless of formatting", () => {
    expect(formatDayMonth("2026-09-05")).toBe("05 de setembro");
    expect(formatDayMonth("2026-01-01")).toBe("01 de janeiro");
    expect(formatDayMonth("2026-12-31")).toBe("31 de dezembro");
  });
});

describe("daysInMonth / formatMonthEndShortDate", () => {
  it("returns the correct last day for months of different lengths", () => {
    expect(daysInMonth("2026-09-05")).toBe(30);
    expect(daysInMonth("2026-02-01")).toBe(28); // 2026 is not a leap year
    expect(daysInMonth("2024-02-01")).toBe(29); // 2024 is a leap year
  });

  it("formats the month-end date as DD/MM", () => {
    expect(formatMonthEndShortDate("2026-09-05")).toBe("30/09");
    expect(formatMonthEndShortDate("2026-02-10")).toBe("28/02");
  });
});

describe("greetingForHour", () => {
  it("returns the calm, time-of-day-appropriate greeting", () => {
    expect(greetingForHour(3)).toBe("Boa noite,");
    expect(greetingForHour(8)).toBe("Bom dia,");
    expect(greetingForHour(15)).toBe("Boa tarde,");
    expect(greetingForHour(21)).toBe("Boa noite,");
  });
});
