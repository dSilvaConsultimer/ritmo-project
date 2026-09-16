import type { Id } from "@money-copilot/shared";
import type { Money } from "../money/index";
import type { Certainty } from "./certainty";
import type { IncomeSource } from "./income";

/**
 * Reserved category used to identify tax commitments so the snapshot can
 * break "usable income" out from "fixed commitments". Any other string is a
 * free-form category label.
 */
export const TAX_CATEGORY = "Tax" as const;

/**
 * A recurring monthly commitment with a known (or estimated) amount.
 *
 * IMPORTANT: `category` must describe what the money is for (e.g. "Food",
 * "Housing"), never the payment rail used to pay it (e.g. "Credit Card").
 * Payment rails are modeled by `PaymentSource` on `FinancialTransaction`.
 * See NON-NEGOTIABLE RULE #4.
 */
export interface FixedExpense {
  readonly id: Id<"fixed-expense">;
  readonly label: string;
  readonly category: string;
  readonly amount: Money;
  readonly certainty: Certainty;
  /**
   * Protected expenses must never automatically be recommended for
   * reduction by a future recommendation engine. See RULE #5, #6.
   */
  readonly protected: boolean;
  /**
   * Day of the month (1-31) this commitment is typically due, when known.
   * Sprint 8 (Ritmo UI integration): purely a DISPLAY convenience for
   * due-date badges/timelines in the DECLARED-PLAN Safe-to-Spend
   * (`snapshot.safeToSpend`), which still treats every fixed expense as
   * committed for the current month regardless of its due day — unchanged.
   * DEC-130: the LIQUIDITY-AWARE Safe-to-Spend (`snapshot.liquidity`) DOES
   * use this field — a due day already passed this month is presumed
   * already reflected in the current account balance and excluded from
   * that calculation's "upcoming commitments," to avoid double-subtracting
   * money the balance already paid out. Absent (`undefined`) means
   * genuinely unknown — never guessed, and treated conservatively as
   * still-upcoming in the liquidity-aware path. See docs/RITMO.md,
   * "Data-model gaps," and docs/DECISIONS.md DEC-130.
   */
  readonly dueDayOfMonth?: number;
  /**
   * DEC-132: reuses the SAME three-state provenance concept `Income.source`
   * established in DEC-130 (`USER_DECLARED`/`HISTORY_INFERRED`/
   * `USER_CONFIRMED_HISTORY`) — not income-specific in meaning, just named
   * after where it was first introduced. Optional (unlike `Income.source`)
   * since this field is new and most existing `FixedExpense` rows/fixtures
   * predate it; absent means genuinely unknown provenance, never guessed.
   * `HISTORY_INFERRED` must never be treated as authoritative/confirmed —
   * same rule as for Income.
   */
  readonly source?: IncomeSource;
}

/**
 * A monthly spending target for a variable/discretionary category
 * (e.g. "Food"), as opposed to actual posted transactions.
 */
export interface VariableBudget {
  readonly id: Id<"variable-budget">;
  readonly label: string;
  readonly category: string;
  readonly targetAmount: Money;
  readonly certainty: Certainty;
}
