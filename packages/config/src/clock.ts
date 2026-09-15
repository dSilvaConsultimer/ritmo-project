/**
 * Central clock abstraction — see docs/DECISIONS.md DEC-127. Every place
 * that needs "what calendar day is it" for a financial calculation resolves
 * it through here, never by reading `new Date()` or hardcoding a literal
 * date directly. Production always uses the real clock; tests inject an
 * explicit `now` so nothing here is ever flaky or needs to be re-dated as
 * real time passes.
 */

/** The MVP's fixed default timezone. Real per-user timezone is a deliberately deferred extension — see `todayIsoDate`'s doc comment. */
export const DEFAULT_TIME_ZONE = "America/Sao_Paulo";

/**
 * Formats `date` as an ISO "YYYY-MM-DD" calendar date IN `timeZone` — never
 * the host process's own local timezone or bare UTC, either of which can
 * disagree with the user's real calendar day near midnight. Uses
 * `Intl.DateTimeFormat`'s "en-CA" locale, which happens to format as
 * YYYY-MM-DD — a standard, dependency-free technique; Node ships full ICU,
 * so no external timezone library is needed.
 */
export function isoDateInTimeZone(date: Date, timeZone: string = DEFAULT_TIME_ZONE): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/**
 * Resolves "today" as an ISO calendar date — the one place production code
 * should ever call `new Date()` for this purpose. Both `timeZone` and `now`
 * are parameters (not read from a hidden global) so:
 *  - tests can pass a fixed `now` and get a fully deterministic result,
 *    never depending on the real wall clock;
 *  - a future per-user timezone feature is a matter of threading a real
 *    value through this same parameter, not restructuring anything —
 *    nothing here assumes a single global timezone internally.
 * Defaults to the real clock and the MVP's fixed timezone.
 */
export function todayIsoDate(
  timeZone: string = DEFAULT_TIME_ZONE,
  now: Date = new Date(),
): string {
  return isoDateInTimeZone(now, timeZone);
}
