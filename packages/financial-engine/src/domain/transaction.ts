import type { Id } from "@money-copilot/shared";
import type { Money } from "../money/index";
import type { Certainty } from "./certainty";

export type PaymentSourceType =
  | "CASH"
  | "DEBIT"
  | "CREDIT_CARD"
  | "BANK_TRANSFER"
  | "PIX"
  | "OTHER";

/**
 * A payment source is the RAIL used to move money (e.g. "Nubank Credit
 * Card"). It is never itself an expense category — see RULE #4. A credit
 * card bill is not "an expense"; the underlying purchases it paid for are.
 */
export interface PaymentSource {
  readonly id: Id<"payment-source">;
  readonly label: string;
  readonly type: PaymentSourceType;
}

export type TransactionKind = "INCOME" | "EXPENSE";

/**
 * A single financial movement. `amount` is always non-negative; direction
 * is carried by `kind`. `category` describes what the money was for
 * (e.g. "Food"), and `paymentSource` describes how it was paid
 * (e.g. Nubank). These two must never be conflated.
 */
export interface FinancialTransaction {
  readonly id: Id<"transaction">;
  readonly description: string;
  readonly amount: Money;
  readonly kind: TransactionKind;
  readonly category: string;
  readonly paymentSource: PaymentSource;
  /** ISO 8601 date, e.g. "2026-09-05". */
  readonly date: string;
  readonly certainty: Certainty;
}
