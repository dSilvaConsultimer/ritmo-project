import type { Id } from "@money-copilot/shared";
import type { Money } from "../money/index";
import type { Certainty } from "./certainty";
import type { FinancialEffect } from "./financial-effect";

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
 * Also doubles, for Sprint 2, as the "account/financial container" the
 * transaction belongs to — a separate `Account` entity was judged
 * unnecessary complexity until a real provider needs it. See DEC-009.
 */
export interface PaymentSource {
  readonly id: Id<"payment-source">;
  readonly label: string;
  readonly type: PaymentSourceType;
}

/** Raw cash-flow direction, independent of financial interpretation. */
export type TransactionDirection = "DEBIT" | "CREDIT";

/**
 * Settlement state of the transaction as reported by its source. A pending
 * and posted record of the same real-world movement must be reconcilable
 * without double counting — see `domain/reconciliation.ts`.
 */
export type TransactionStatus = "PENDING" | "POSTED" | "REVERSED";

/** Where the record came from. */
export type TransactionOrigin = "MANUAL" | "IMPORTED";

/**
 * The canonical, provider-independent transaction representation. A future
 * Open Finance provider (Sprint 3) maps its own payload into this shape via
 * an `ExternalTransactionInput` DTO (see `domain/external-transaction.ts`) —
 * no provider-specific business logic lives here or anywhere in Sprint 2.
 *
 * `amount` is always a non-negative magnitude; `direction` carries sign.
 * `category` describes what the money was for; `paymentSource` describes
 * how it moved — these must never be conflated (RULE #4). `financialEffect`
 * is what makes budget/category math safe: only `CONSUMPTION`/`FEE` count
 * as fresh spending, `REFUND` nets against it, and `TRANSFER`/`CARD_PAYMENT`/
 * `DEBT_PAYMENT`/`INCOME` never do — see `domain/financial-effect.ts`.
 */
export interface FinancialTransaction {
  readonly id: Id<"transaction">;
  readonly financialProfileId: Id<"financial-profile">;

  /** Present only once a real provider (Sprint 3+) supplies it. */
  readonly externalProviderId?: string;
  readonly externalTransactionId?: string;

  readonly paymentSource: PaymentSource;

  /** ISO 8601 date the transaction is attributed to for monthly grouping. */
  readonly date: string;
  readonly authorizationDate?: string;
  readonly postingDate?: string;

  readonly amount: Money;
  readonly direction: TransactionDirection;

  readonly rawDescription: string;
  readonly normalizedDescription: string;
  readonly rawMerchant?: string;
  readonly normalizedMerchant?: string;

  readonly status: TransactionStatus;
  readonly certainty: Certainty;
  readonly financialEffect: FinancialEffect;

  /** Null until categorized; see `domain/category.ts`. */
  readonly category: string | null;
  readonly subcategory?: string;

  readonly origin: TransactionOrigin;
  /** Free-form provider/reconciliation metadata. Never used for calculation. */
  readonly metadata?: Readonly<Record<string, unknown>>;

  readonly createdAt: string;
  readonly updatedAt: string;
}
