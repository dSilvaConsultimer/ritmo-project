import type { Id } from "@money-copilot/shared";
import type { Money } from "../money/index";
import type { Certainty, CertainAmount } from "./certainty";
import type { FinancialEffect } from "./financial-effect";

export type PaymentSourceType =
  | "CASH"
  | "DEBIT"
  | "CREDIT_CARD"
  | "BANK_TRANSFER"
  | "PIX"
  | "OTHER";

/** Provider-reported credit card metadata for a `PaymentSource` of type `CREDIT_CARD`. */
export interface PaymentSourceCreditCardInfo {
  readonly creditLimit?: Money;
  readonly availableCreditLimit?: Money;
  /** ISO date of the current bill's closing date, if known. */
  readonly closingDate?: string;
  /** ISO date of the current bill's due date, if known. */
  readonly dueDate?: string;
  readonly minimumPayment?: Money;
}

/**
 * A payment source is the RAIL used to move money (e.g. "Nubank Credit
 * Card"). It is never itself an expense category — see RULE #4. A credit
 * card bill is not "an expense"; the underlying purchases it paid for are.
 * Also doubles as the "account/financial container" the transaction
 * belongs to — a separate `Account` entity was judged unnecessary
 * complexity (DEC-009); Sprint 3 extends this shape with optional
 * provider/account fields rather than introducing that parallel entity
 * (DEC-022), so a manually-entered Sprint 1/2 payment source remains a
 * valid, minimal `PaymentSource` with none of these fields set.
 */
export interface PaymentSource {
  readonly id: Id<"payment-source">;
  readonly label: string;
  readonly type: PaymentSourceType;

  /** Finer-grained institution subtype, e.g. "CHECKING_ACCOUNT", "SAVINGS_ACCOUNT". */
  readonly subtype?: string;
  /** e.g. "pluggy". Absent for manually-entered payment sources. */
  readonly provider?: string;
  readonly externalAccountId?: string;
  readonly connectionId?: Id<"provider-connection">;
  /** ISO 4217 currency code; defaults to BRL when absent. */
  readonly currency?: string;
  /** Known account balance, when synced from a provider. */
  readonly balance?: CertainAmount;
  /**
   * DEC-130: the provider's own "available/spendable" balance, when it
   * reports one distinct from `balance` (Pluggy's `bankData.closingBalance`
   * — documented as "available balance," as opposed to `balance`'s "current
   * balance"). Already excludes holds/reserves at the provider's own
   * discretion — see `reservedBalance` below for the fallback case where no
   * such field exists. Preferred over `balance` for any usable-liquidity
   * calculation; `balance` remains the one shown as "the account balance."
   */
  readonly availableBalance?: CertainAmount;
  /**
   * DEC-130: money earmarked/reserved on this account (e.g. a goal-based
   * "Caixinha" or a judicial hold — Pluggy's `bankData.reservedBalances`).
   * Only ever subtracted from usable liquidity when `availableBalance` is
   * ABSENT (i.e. we fell back to the raw `balance`, which we cannot assume
   * already excludes it) — see `computeLiquidityAwareSafeToSpend`. Never
   * subtracted when `availableBalance` is present, to avoid double-counting
   * money the provider already excluded.
   */
  readonly reservedBalance?: CertainAmount;
  /**
   * DEC-130: money automatically swept into an auto-invest product (Pluggy's
   * `bankData.automaticallyInvestedBalance`). Captured for explainability
   * only — NOT currently subtracted from usable liquidity anywhere, since
   * whether this money is same-day spendable varies by institution and
   * genuinely requires product input to resolve safely either way (see
   * docs/DECISIONS.md DEC-130, "remaining ambiguity"). Never silently
   * assumed to be unavailable.
   */
  readonly automaticallyInvestedBalance?: CertainAmount;
  readonly creditCard?: PaymentSourceCreditCardInfo;
  /** Certainty of the balance/metadata above (distinct from any transaction's own certainty). */
  readonly certainty?: Certainty;
  readonly lastSyncedAt?: string;
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

  /**
   * DEC-136: LEGACY / DENORMALIZED display text — null until categorized.
   * `categoryId` (below) is the authoritative category identity for any
   * transaction categorized from this decision forward; this string is kept
   * in sync as a resolved display copy (see `domain/category.ts`'s own
   * "CATEGORY IDENTITY = categoryId" note) and otherwise exists only so
   * transactions categorized before this decision, and never backfilled,
   * remain readable.
   */
  readonly category: string | null;
  /**
   * DEC-136: the canonical `Category` this transaction is classified under
   * — the authoritative identity. Absent for transactions categorized
   * before this decision that a conservative backfill
   * (`backfillTransactionCategoryIds`) hasn't yet linked to a real
   * `Category` id (see that function's own doc comment); absent also for a
   * transaction that is genuinely still `UNCATEGORIZED`. Never guess this —
   * only ever set from a real, resolved `Category`.
   */
  readonly categoryId?: Id<"category">;
  readonly subcategory?: string;
  /**
   * The provider's own category label, preserved for reference/future
   * evidence only. NEVER authoritative over our deterministic
   * `category`/`subcategory` above — see RULE (Sprint 3): "provider
   * categories are not authoritative."
   */
  readonly providerCategory?: string;

  /** Present when the provider reports installment details for this purchase. */
  readonly installmentMetadata?: {
    readonly installmentNumber?: number;
    readonly totalInstallments?: number;
    readonly totalAmount?: Money;
    /** The provider's own bill/invoice identifier this installment belongs to, if any. */
    readonly externalBillId?: string;
  };

  readonly origin: TransactionOrigin;
  /** Free-form provider/reconciliation metadata. Never used for calculation. */
  readonly metadata?: Readonly<Record<string, unknown>>;

  readonly createdAt: string;
  readonly updatedAt: string;
}
