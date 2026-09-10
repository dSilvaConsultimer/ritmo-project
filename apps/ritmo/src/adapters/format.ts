/**
 * Pure, presentation-only formatting helpers shared by every adapter — no
 * I/O, no financial calculation, mirrors `mock.ts`'s own `brl` helper
 * exactly so real data renders through the identical formatting the
 * approved Lovable markup was designed around.
 */
export function brl(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
  });
}

// `timeZone: "UTC"` is required here — without it, `Intl.DateTimeFormat`
// renders in the SERVER PROCESS'S local timezone, which shifted a UTC
// midnight date back by a day for any timezone behind UTC (a real bug
// found live: asOfDate "2026-09-05" rendered as "04 de setembro"). Every
// date in this codebase is an explicit calendar string, never a real
// instant — see `packages/financial-engine`'s own `date-utils.ts` for the
// identical discipline server-side.
const WEEKDAY_MONTH_FORMATTER = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "long",
  timeZone: "UTC",
});

/** "09 de outubro" from an ISO "YYYY-MM-DD" date — display only. */
export function formatDayMonth(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  return WEEKDAY_MONTH_FORMATTER.format(new Date(Date.UTC(year!, month! - 1, day)));
}

export function daysInMonth(isoDate: string): number {
  const [year, month] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year!, month!, 0)).getUTCDate();
}

/** "30/09" — the last calendar day of `isoDate`'s month, display only. */
export function formatMonthEndShortDate(isoDate: string): string {
  const [year, month] = isoDate.split("-").map(Number);
  const lastDay = daysInMonth(isoDate);
  return `${String(lastDay).padStart(2, "0")}/${String(month).padStart(2, "0")}`;
}

/** A calm, time-of-day greeting — pure client/presentation logic, not domain data. */
export function greetingForHour(hour: number): string {
  if (hour < 5) return "Boa noite,";
  if (hour < 12) return "Bom dia,";
  if (hour < 18) return "Boa tarde,";
  return "Boa noite,";
}

/** "YYYY-MM-DD" shifted by `deltaDays` (may be negative) — UTC-safe, no timezone drift. */
export function shiftIsoDate(isoDate: string, deltaDays: number): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const shifted = new Date(Date.UTC(year!, month! - 1, day! + deltaDays));
  return shifted.toISOString().slice(0, 10);
}

/** "DD/MM" — display-only, used where a full date is the honest replacement for an unknown time-of-day. */
export function formatShortDate(isoDate: string): string {
  const [, month, day] = isoDate.split("-");
  return `${day}/${month}`;
}

/** "05" for a known due day, or a neutral placeholder — never a guessed day. See docs/RITMO.md, "Data-model gaps." */
export function dueDayBadge(dueDayOfMonth: number | null): string {
  return dueDayOfMonth !== null ? String(dueDayOfMonth).padStart(2, "0") : "–";
}

/**
 * Known-due-day commitments first (ascending by day), unknown ones last —
 * real fixture data may not have a due day recorded yet, and mock due-dates
 * are never used as a stand-in (see "Data-model gaps" #1).
 */
export function sortByDueDay<T extends { readonly dueDayOfMonth: number | null }>(
  items: readonly T[],
): T[] {
  return [...items].sort((a, b) => {
    if (a.dueDayOfMonth === null && b.dueDayOfMonth === null) return 0;
    if (a.dueDayOfMonth === null) return 1;
    if (b.dueDayOfMonth === null) return -1;
    return a.dueDayOfMonth - b.dueDayOfMonth;
  });
}
