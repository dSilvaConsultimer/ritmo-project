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
