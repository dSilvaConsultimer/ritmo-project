import type { Id } from "@money-copilot/shared";
import type { Money } from "../money/index";
import type { Certainty } from "./certainty";

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
   * showing due-date badges/timelines — never used in any Safe-to-Spend or
   * snapshot calculation, which already treats every fixed expense as
   * committed for the current month regardless of its due day. Absent
   * (`undefined`) means genuinely unknown — never guessed, and never
   * defaulted to a specific day. See docs/RITMO.md, "Data-model gaps."
   */
  readonly dueDayOfMonth?: number;
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
