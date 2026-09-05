import type { Account as PluggyAccount, Transaction as PluggyTransaction } from "pluggy-sdk";
import type { CreditCardBills as PluggyBill } from "pluggy-sdk/dist/types/creditCardBills";
import type {
  ExternalAccountInput,
  ExternalBillInput,
  ExternalTransactionInput,
  FinancialEffect,
  TransactionDirection,
} from "@money-copilot/financial-engine";

export const PLUGGY_PROVIDER_NAME = "pluggy" as const;

function toIsoDate(value: Date | string | null | undefined): string | undefined {
  if (!value) return undefined;
  const date = typeof value === "string" ? new Date(value) : value;
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString().slice(0, 10);
}

function toCents(amount: number): number {
  return Math.round(Math.abs(amount) * 100);
}

// ---------- Accounts ----------

/**
 * Maps a Pluggy `Account` into the canonical `ExternalAccountInput`.
 * `type: "CREDIT"` + `subtype: "CREDIT_CARD"` -> our `CREDIT_CARD` kind;
 * everything else (`BANK` checking/savings) -> `BANK`. Balance is always a
 * non-negative magnitude in our model — for a credit card this represents
 * the amount currently owed (Pluggy's `balance` on a CREDIT account), for a
 * bank account the cash available.
 */
export function mapPluggyAccountToExternalAccountInput(
  account: PluggyAccount,
): ExternalAccountInput {
  const isCreditCard = account.type === "CREDIT";
  const creditData = account.creditData;
  const closingDate = creditData ? toIsoDate(creditData.balanceCloseDate) : undefined;
  const dueDate = creditData ? toIsoDate(creditData.balanceDueDate) : undefined;

  return {
    provider: PLUGGY_PROVIDER_NAME,
    externalAccountId: account.id,
    connectionExternalId: account.itemId,
    kind: isCreditCard ? "CREDIT_CARD" : "BANK",
    subtype: account.subtype,
    displayName: account.marketingName ?? account.name,
    currency: account.currencyCode,
    balanceCents: toCents(account.balance),
    balanceCertainty: "ACTUAL",
    ...(isCreditCard && creditData
      ? {
          creditCard: {
            ...(creditData.creditLimit !== null
              ? { creditLimitCents: toCents(creditData.creditLimit) }
              : {}),
            ...(creditData.availableCreditLimit !== null
              ? { availableCreditLimitCents: toCents(creditData.availableCreditLimit) }
              : {}),
            ...(closingDate ? { closingDate } : {}),
            ...(dueDate ? { dueDate } : {}),
            ...(creditData.minimumPayment !== null
              ? { minimumPaymentCents: toCents(creditData.minimumPayment) }
              : {}),
          },
        }
      : {}),
    lastSyncedAt: new Date().toISOString(),
  };
}

// ---------- Transactions ----------

/**
 * Direction comes DIRECTLY from Pluggy's own `type` field (`DEBIT` = money
 * going out, `CREDIT` = money going in — the same generic meaning Pluggy
 * documents regardless of account type), never from the sign of `amount`.
 * Pluggy's documented amount-sign convention differs by account type
 * (credit card purchases are positive, bill payments negative; bank
 * account sign convention is not documented at all) — see
 * docs/OPEN-FINANCE.md, "Amount / sign mapping." Relying on `type` instead
 * of sign sidesteps that ambiguity entirely and is what NON-NEGOTIABLE
 * RULE (Sprint 3) means by "provider signs must not directly become
 * financial meaning."
 */
function mapDirection(type: PluggyTransaction["type"]): TransactionDirection {
  return type; // "DEBIT" | "CREDIT" — identical enum values, explicit passthrough.
}

const FEE_KEYWORDS = /\b(TARIFA|ANUIDADE|IOF|JUROS|MULTA)\b/i;
const REFUND_KEYWORDS = /\b(ESTORNO|REFUND|REEMBOLSO)\b/i;
const CARD_PAYMENT_KEYWORDS = /PAGAMENTO.*FATURA|PAGAMENTO DE FATURA|BILL PAYMENT/i;
const OWN_ACCOUNT_TRANSFER_KEYWORDS = /TRANSFER[ÊE]NCIA ENTRE CONTAS|TED PR[OÓ]PRIA|DOC PR[OÓ]PRIA/i;

/**
 * Classifies a Pluggy transaction's `FinancialEffect`. This is a
 * deterministic, keyword-based heuristic over the description plus account
 * kind + Pluggy's `type`/`creditCardMetadata` — NOT an ML/LLM
 * classifier, and intentionally narrow in scope (see NON-NEGOTIABLE: "do
 * not infer consumption simply because a number is positive or
 * negative"). Ambiguous real-world transactions may need a human
 * (recategorization) — see docs/OPEN-FINANCE.md, "Known provider
 * limitations."
 */
function classifyFinancialEffect(
  transaction: PluggyTransaction,
  accountKind: "BANK" | "CREDIT_CARD",
): FinancialEffect {
  const description = transaction.description.toUpperCase();

  if (transaction.creditCardMetadata?.feeType) return "FEE";
  if (FEE_KEYWORDS.test(description)) return "FEE";

  if (accountKind === "CREDIT_CARD") {
    if (transaction.type === "CREDIT") {
      if (CARD_PAYMENT_KEYWORDS.test(description)) return "CARD_PAYMENT";
      if (REFUND_KEYWORDS.test(description)) return "REFUND";
      // Most non-payment credits on a card are refunds; a bill payment
      // without the recognized keyword falls back to CARD_PAYMENT only
      // when it's the dominant, well-known phrasing above. Otherwise this
      // defaults to REFUND, the more common real-world case.
      return "REFUND";
    }
    return "CONSUMPTION";
  }

  // BANK account
  if (transaction.type === "CREDIT") return "INCOME";
  if (OWN_ACCOUNT_TRANSFER_KEYWORDS.test(description)) return "TRANSFER";
  return "CONSUMPTION";
}

export function mapPluggyTransactionToExternalTransactionInput(
  transaction: PluggyTransaction,
  accountKind: "BANK" | "CREDIT_CARD",
): ExternalTransactionInput {
  const installmentMetadata = transaction.creditCardMetadata
    ? {
        ...(transaction.creditCardMetadata.installmentNumber !== undefined
          ? { installmentNumber: transaction.creditCardMetadata.installmentNumber }
          : {}),
        ...(transaction.creditCardMetadata.totalInstallments !== undefined
          ? { totalInstallments: transaction.creditCardMetadata.totalInstallments }
          : {}),
        ...(transaction.creditCardMetadata.totalAmount !== undefined
          ? { totalAmountCents: toCents(transaction.creditCardMetadata.totalAmount) }
          : {}),
        ...(transaction.creditCardMetadata.billId
          ? { externalBillId: transaction.creditCardMetadata.billId }
          : {}),
      }
    : undefined;

  const authorizationDate = toIsoDate(transaction.createdAt);

  return {
    provider: PLUGGY_PROVIDER_NAME,
    externalTransactionId: transaction.id,
    paymentSourceExternalRef: transaction.accountId,
    amountCents: toCents(transaction.amount),
    direction: mapDirection(transaction.type),
    financialEffect: classifyFinancialEffect(transaction, accountKind),
    certainty: "ACTUAL",
    date: toIsoDate(transaction.date) ?? new Date().toISOString().slice(0, 10),
    ...(authorizationDate ? { authorizationDate } : {}),
    rawDescription: transaction.description,
    ...(transaction.merchant?.name ? { rawMerchant: transaction.merchant.name } : {}),
    status: transaction.status === "PENDING" ? "PENDING" : "POSTED",
    ...(transaction.category ? { providerCategory: transaction.category } : {}),
    ...(installmentMetadata && Object.keys(installmentMetadata).length > 0
      ? { installmentMetadata }
      : {}),
  };
}

// ---------- Bills ----------

export function mapPluggyBillToExternalBillInput(
  bill: PluggyBill,
  externalAccountId: string,
): ExternalBillInput {
  const closingDate = toIsoDate(bill.billClosingDate);
  return {
    provider: PLUGGY_PROVIDER_NAME,
    externalBillId: bill.id,
    externalAccountId,
    dueDate: toIsoDate(bill.dueDate) ?? new Date().toISOString().slice(0, 10),
    ...(closingDate ? { closingDate } : {}),
    totalAmountCents: toCents(bill.totalAmount),
    ...(bill.minimumPaymentAmount !== null
      ? { minimumPaymentCents: toCents(bill.minimumPaymentAmount) }
      : {}),
    ...(bill.allowsInstallments !== null ? { allowsInstallments: bill.allowsInstallments } : {}),
    certainty: "ACTUAL",
  };
}
