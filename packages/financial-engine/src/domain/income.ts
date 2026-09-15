import type { Id } from "@money-copilot/shared";
import type { Money } from "../money/index";
import type { Certainty } from "./certainty";

/**
 * Where this declared `Income` record's knowledge came from — never
 * silently blended, so a learned pattern can never overwrite an explicit
 * user statement without the user's own confirmation (DEC-130).
 *
 * - USER_DECLARED: the user stated this directly (a copilot conversation,
 *   a form) — the strongest source, with no supporting transaction history
 *   required.
 * - HISTORY_INFERRED: derived from a `RecurringExpenseCandidate` over real
 *   INCOME-effect transactions (see `detectRecurringCandidates`) that the
 *   user explicitly confirmed — never auto-created; `createIncome` is
 *   always an explicit-confirmation MUTATION regardless of source.
 * - USER_CONFIRMED_HISTORY: the strongest state — the user both stated the
 *   fact AND confirmed it matches (or now matches) the observed recurring
 *   pattern. Product-level guidance on exactly when a conversation
 *   transitions HISTORY_INFERRED -> USER_CONFIRMED_HISTORY is intentionally
 *   left to the copilot/product layer, not hardcoded here.
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
