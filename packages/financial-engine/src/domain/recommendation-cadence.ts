import * as M from "../money/index";
import type { Money } from "../money/index";
import type { RecurrenceCadence } from "./recommendation";

/**
 * Cadence classification bounds, in days. Deliberately mirrors
 * `recurring.ts`'s own MONTHLY bounds (20-40 days) rather than introducing a
 * second, inconsistent definition of "roughly monthly." An interval outside
 * every recognized bucket is `UNKNOWN` — the engine never guesses a cadence
 * for an irregular pattern (see docs/RECOMMENDATIONS.md, "Cadence
 * normalization").
 */
const WEEKLY_MIN_DAYS = 5;
const WEEKLY_MAX_DAYS = 9;
const MONTHLY_MIN_DAYS = 20;
const MONTHLY_MAX_DAYS = 40;
const YEARLY_MIN_DAYS = 340;
const YEARLY_MAX_DAYS = 390;

/** Weeks per month, used only to convert a WEEKLY charge to its monthly equivalent — never re-entered as a raw float into a stored Money value (rounded once by `M.scale`). */
const WEEKS_PER_MONTH = 52 / 12;
const MONTHS_PER_YEAR = 12;

export function classifyCadence(averageIntervalDays: number | null): RecurrenceCadence {
  if (averageIntervalDays === null) return "UNKNOWN";
  if (averageIntervalDays >= WEEKLY_MIN_DAYS && averageIntervalDays <= WEEKLY_MAX_DAYS) return "WEEKLY";
  if (averageIntervalDays >= MONTHLY_MIN_DAYS && averageIntervalDays <= MONTHLY_MAX_DAYS) return "MONTHLY";
  if (averageIntervalDays >= YEARLY_MIN_DAYS && averageIntervalDays <= YEARLY_MAX_DAYS) return "YEARLY";
  return "UNKNOWN";
}

/**
 * Normalizes a per-charge amount to its monthly equivalent for the given
 * cadence. Returns `null` for `UNKNOWN` — there is no deterministic way to
 * project a monthly figure from an unrecognized interval, so the caller
 * must not present a CANCEL/REDUCE monthly-impact figure in that case (see
 * `recommendation-generation.ts`, which falls back to `REVIEW_RECURRING_COST`
 * whenever this returns `null`).
 */
export function monthlyEquivalentAmount(amount: Money, cadence: RecurrenceCadence): Money | null {
  switch (cadence) {
    case "WEEKLY":
      return M.scale(amount, WEEKS_PER_MONTH);
    case "MONTHLY":
      return amount;
    case "YEARLY":
      return M.scale(amount, 1 / MONTHS_PER_YEAR);
    case "UNKNOWN":
      return null;
  }
}

/** Annual impact is always monthly impact * 12 once normalized — regardless of the original cadence. Exact: monthly impact is already an integer cents amount. */
export function annualImpactFromMonthly(monthlyImpact: Money): Money {
  return M.scale(monthlyImpact, MONTHS_PER_YEAR);
}
