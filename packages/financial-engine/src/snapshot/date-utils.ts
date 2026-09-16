/** Parses an ISO "YYYY-MM-DD" date as a UTC calendar date (no timezone drift). */
function parseIsoDate(iso: string): Date {
  const [year, month, day] = iso.split("-").map(Number);
  if (year === undefined || month === undefined || day === undefined) {
    throw new RangeError(`Invalid ISO date: ${iso}`);
  }
  return new Date(Date.UTC(year, month - 1, day));
}

/** Number of days remaining in the month of `isoDate`, including `isoDate` itself. */
export function daysRemainingInMonth(isoDate: string): number {
  const date = parseIsoDate(isoDate);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const lastDayOfMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return lastDayOfMonth - date.getUTCDate() + 1;
}

/** True when `isoDate` falls within the same calendar month as `referenceIsoDate`. */
export function isSameMonth(isoDate: string, referenceIsoDate: string): boolean {
  return isoDate.slice(0, 7) === referenceIsoDate.slice(0, 7);
}

/** The calendar day-of-month (1-31) of `isoDate` — display/comparison only, never a full date. */
export function dayOfMonth(isoDate: string): number {
  return parseIsoDate(isoDate).getUTCDate();
}

/** The "YYYY-MM" calendar-month key of `isoDate` — the same slice `isSameMonth` compares internally, exposed for callers that need to group/compare months directly (DEC-140 forecasting). */
export function monthKey(isoDate: string): string {
  return isoDate.slice(0, 7);
}

/**
 * DEC-140: the `count` calendar months immediately preceding `asOfDate`'s
 * month, oldest first — e.g. `asOfDate` "2026-09-15", `count` 3 returns
 * `["2026-06", "2026-07", "2026-08"]`. NEVER includes `asOfDate`'s own
 * (possibly incomplete) month — every forecast built from this (expected
 * monthly income, recurring-fixed-commitment detection) must use only
 * FULLY COMPLETED months, so a partial current month never artificially
 * drags an average down or breaks a recurrence streak.
 */
export function lastNCompletedMonthKeys(asOfDate: string, count: number): readonly string[] {
  const [year, month] = asOfDate.split("-").map(Number) as [number, number];
  const keys: string[] = [];
  for (let i = count; i >= 1; i -= 1) {
    const d = new Date(Date.UTC(year, month - 1 - i, 1));
    keys.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return keys;
}
