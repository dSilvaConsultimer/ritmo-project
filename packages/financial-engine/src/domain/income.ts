import type { Id } from "@money-copilot/shared";
import type { Money } from "../money/index";
import type { Certainty } from "./certainty";

/**
 * Where this declared `Income` record's knowledge came from — never
 * silently blended, so a learned pattern can never overwrite an explicit
 * user statement without the user's own confirmation (DEC-130).
 *
 * Strict meanings (corrected DEC-130 update — do not conflate these):
 *
 * - USER_DECLARED: the user directly told Ritmo this recurring income
 *   exists (e.g. "recebo R$8.500 todo dia 5"), with no candidate/pattern
 *   involved at all.
 * - HISTORY_INFERRED: Ritmo detected a recurring pattern from real
 *   transaction history (`detectRecurringCandidates` over INCOME-effect
 *   transactions) but the user has NOT confirmed it. This is the
 *   `RecurringExpenseCandidate`'s own state most of the time — an `Income`
 *   row with this source should be rare (see below) and, wherever it does
 *   exist, must never be treated as more reliable than a genuinely
 *   unconfirmed candidate for forward-looking Safe-to-Spend purposes
 *   (`buildFinancialSnapshot` deliberately excludes `HISTORY_INFERRED`
 *   income from the liquidity-aware forward total for exactly this
 *   reason — see snapshot.ts).
 * - USER_CONFIRMED_HISTORY: the strongest state — Ritmo inferred a pattern
 *   from history AND the user explicitly confirmed Ritmo may use it as
 *   planned knowledge (e.g. confirming a `getRecurringIncomeCandidates`
 *   suggestion). `createIncomeTool`'s `fromRecurringPattern: true` maps
 *   here, never to `HISTORY_INFERRED` — by the time `createIncome` is
 *   ever called at all, the user has already explicitly confirmed
 *   something (the tool's own contract, unchanged since DEC-127); if what
 *   they confirmed was a shown pattern, the provenance IS the confirmed
 *   state, not the bare inference.
 *
 * One isolated transaction never becomes a candidate at all
 * (`detectRecurringCandidates`'s `MIN_OCCURRENCES = 2`), so it can never
 * reach any of these three states in the first place.
 */
export type IncomeSource = "USER_DECLARED" | "HISTORY_INFERRED" | "USER_CONFIRMED_HISTORY";

export interface Income {
  readonly id: Id<"income">;
  readonly label: string;
  /** Gross monthly amount, before taxes. */
  readonly grossAmount: Money;
  readonly certainty: Certainty;
  readonly recurring: boolean;
  /**
   * Where this knowledge came from — see `IncomeSource`. Defaults to
   * `USER_DECLARED` at the mutation layer for any caller that predates this
   * field (Sprint 9 DEC-127 introduced `createIncome` before provenance
   * existed) — never left ambiguous.
   */
  readonly source: IncomeSource;
  /**
   * Day of the month (1-31) this income is typically received, when known —
   * mirrors `FixedExpense.dueDayOfMonth` exactly. Used by the liquidity-aware
   * Safe-to-Spend calculation (DEC-130) to decide whether THIS month's
   * occurrence has already been received (already reflected in the current
   * account balance — must not be added again) or is still expected before
   * the period ends (a real forward-looking addition). Absent means
   * genuinely unknown — never guessed, and in that case this income never
   * contributes to the liquidity-aware forward total (only to the
   * declared-plan total, unchanged).
   */
  readonly expectedDayOfMonth?: number;
}
