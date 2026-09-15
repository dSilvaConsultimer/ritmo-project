import { describe, expect, it } from "vitest";
import {
  mapPluggyAccountToExternalAccountInput,
  mapPluggyBillToExternalBillInput,
  mapPluggyTransactionToExternalTransactionInput,
} from "./mappers";
import {
  fixtureBankAccount,
  fixtureBankAccountWithInvestedBalance,
  fixtureBankAccountWithReservedBalance,
  fixtureBankCardBillPaymentTransaction,
  fixtureBankCreditTransaction,
  fixtureBankDebitTransaction,
  fixtureBankFeeTransaction,
  fixtureBankTransferTransaction,
  fixtureCardFeeTransaction,
  fixtureCardPaymentTransaction,
  fixtureCardPurchaseTransaction,
  fixtureCardRefundTransaction,
  fixtureCreditCardAccount,
  fixtureCreditCardBill,
  fixtureInstallmentPurchaseTransaction,
  fixturePendingCardPurchaseTransaction,
  fixturePostedCardPurchaseTransaction,
} from "./fixtures/index";

describe("mapPluggyAccountToExternalAccountInput — bank account", () => {
  it("maps a BANK/CHECKING_ACCOUNT to kind BANK with a non-negative balance", () => {
    const result = mapPluggyAccountToExternalAccountInput(fixtureBankAccount);
    expect(result.kind).toBe("BANK");
    expect(result.subtype).toBe("CHECKING_ACCOUNT");
    expect(result.balanceCents).toBe(125_050);
    expect(result.balanceCertainty).toBe("ACTUAL");
    expect(result.creditCard).toBeUndefined();
  });
});

describe("mapPluggyAccountToExternalAccountInput — credit card", () => {
  it("maps a CREDIT/CREDIT_CARD account to kind CREDIT_CARD with credit metadata", () => {
    const result = mapPluggyAccountToExternalAccountInput(fixtureCreditCardAccount);
    expect(result.kind).toBe("CREDIT_CARD");
    expect(result.balanceCents).toBe(85_000);
    expect(result.creditCard?.creditLimitCents).toBe(500_000);
    expect(result.creditCard?.availableCreditLimitCents).toBe(415_000);
    expect(result.creditCard?.minimumPaymentCents).toBe(8_500);
    expect(result.creditCard?.dueDate).toBe("2026-10-10");
    expect(result.creditCard?.closingDate).toBe("2026-10-01");
  });
});

describe("mapPluggyAccountToExternalAccountInput — reserved / available / invested balances (DEC-130)", () => {
  it("surfaces bankData.closingBalance as availableBalanceCents — even when, as in the real observed payload, it equals the raw balance (DEC-130: never assumed to already exclude reservations just because the field is present)", () => {
    const result = mapPluggyAccountToExternalAccountInput(fixtureBankAccountWithReservedBalance);
    expect(result.balanceCents).toBe(3_599_575);
    expect(result.availableBalanceCents).toBe(3_599_575);
  });

  it("sums reservedBalances across every band into reservedBalanceCents", () => {
    const result = mapPluggyAccountToExternalAccountInput(fixtureBankAccountWithReservedBalance);
    expect(result.reservedBalanceCents).toBe(100_004);
  });

  it("never reports reservedBalanceCents when hasReservedBalance is not true", () => {
    const result = mapPluggyAccountToExternalAccountInput(fixtureBankAccount);
    expect(result.reservedBalanceCents).toBeUndefined();
  });

  it("surfaces automaticallyInvestedBalance without touching availableBalanceCents", () => {
    const result = mapPluggyAccountToExternalAccountInput(fixtureBankAccountWithInvestedBalance);
    expect(result.automaticallyInvestedBalanceCents).toBe(359_957);
    expect(result.availableBalanceCents).toBe(3_599_575);
  });

  it("never reports these fields for a CREDIT_CARD account (bankData is null there)", () => {
    const result = mapPluggyAccountToExternalAccountInput(fixtureCreditCardAccount);
    expect(result.availableBalanceCents).toBeUndefined();
    expect(result.reservedBalanceCents).toBeUndefined();
    expect(result.automaticallyInvestedBalanceCents).toBeUndefined();
  });
});

describe("mapPluggyTransactionToExternalTransactionInput — bank DEBIT", () => {
  it("maps direction from Pluggy's `type` field, not the sign of `amount`", () => {
    const result = mapPluggyTransactionToExternalTransactionInput(fixtureBankDebitTransaction, "BANK");
    expect(result.direction).toBe("DEBIT");
    expect(result.amountCents).toBe(8_990);
    expect(result.financialEffect).toBe("CONSUMPTION");
  });
});

describe("mapPluggyTransactionToExternalTransactionInput — bank CREDIT", () => {
  it("classifies an incoming bank credit as INCOME", () => {
    const result = mapPluggyTransactionToExternalTransactionInput(fixtureBankCreditTransaction, "BANK");
    expect(result.direction).toBe("CREDIT");
    expect(result.financialEffect).toBe("INCOME");
  });
});

describe("mapPluggyTransactionToExternalTransactionInput — bank transfer", () => {
  it("classifies an own-account transfer as TRANSFER, not CONSUMPTION", () => {
    const result = mapPluggyTransactionToExternalTransactionInput(fixtureBankTransferTransaction, "BANK");
    expect(result.financialEffect).toBe("TRANSFER");
  });
});

describe("mapPluggyTransactionToExternalTransactionInput — bank fee", () => {
  it("classifies a bank maintenance fee as FEE", () => {
    const result = mapPluggyTransactionToExternalTransactionInput(fixtureBankFeeTransaction, "BANK");
    expect(result.financialEffect).toBe("FEE");
  });
});

describe("mapPluggyTransactionToExternalTransactionInput — bank-side card bill payment (DEC-130 regression)", () => {
  it("classifies a checking-account DEBIT paying a card bill as CARD_PAYMENT, never CONSUMPTION", () => {
    const result = mapPluggyTransactionToExternalTransactionInput(
      fixtureBankCardBillPaymentTransaction,
      "BANK",
    );
    expect(result.direction).toBe("DEBIT");
    expect(result.financialEffect).toBe("CARD_PAYMENT");
  });

  it("still classifies an ordinary checking DEBIT with no bill-payment wording as CONSUMPTION", () => {
    const result = mapPluggyTransactionToExternalTransactionInput(fixtureBankDebitTransaction, "BANK");
    expect(result.financialEffect).toBe("CONSUMPTION");
  });
});

describe("mapPluggyTransactionToExternalTransactionInput — credit card purchase", () => {
  it("classifies a card DEBIT (a purchase) as CONSUMPTION, regardless of the documented positive amount sign", () => {
    const result = mapPluggyTransactionToExternalTransactionInput(
      fixtureCardPurchaseTransaction,
      "CREDIT_CARD",
    );
    expect(result.direction).toBe("DEBIT");
    expect(result.amountCents).toBe(15_000);
    expect(result.financialEffect).toBe("CONSUMPTION");
  });
});

describe("mapPluggyTransactionToExternalTransactionInput — credit card payment", () => {
  it("classifies a card bill payment (CREDIT, negative in Pluggy's own convention) as CARD_PAYMENT, never CONSUMPTION", () => {
    const result = mapPluggyTransactionToExternalTransactionInput(
      fixtureCardPaymentTransaction,
      "CREDIT_CARD",
    );
    expect(result.direction).toBe("CREDIT");
    expect(result.financialEffect).toBe("CARD_PAYMENT");
  });
});

describe("mapPluggyTransactionToExternalTransactionInput — credit card refund", () => {
  it("classifies a refunded purchase as REFUND", () => {
    const result = mapPluggyTransactionToExternalTransactionInput(
      fixtureCardRefundTransaction,
      "CREDIT_CARD",
    );
    expect(result.financialEffect).toBe("REFUND");
  });
});

describe("mapPluggyTransactionToExternalTransactionInput — credit card fee", () => {
  it("classifies an annual fee as FEE even though it's a card DEBIT", () => {
    const result = mapPluggyTransactionToExternalTransactionInput(fixtureCardFeeTransaction, "CREDIT_CARD");
    expect(result.financialEffect).toBe("FEE");
  });
});

describe("mapPluggyTransactionToExternalTransactionInput — pending vs posted", () => {
  it("preserves PENDING status for an unsettled card transaction", () => {
    const result = mapPluggyTransactionToExternalTransactionInput(
      fixturePendingCardPurchaseTransaction,
      "CREDIT_CARD",
    );
    expect(result.status).toBe("PENDING");
  });

  it("maps the same transaction id's later POSTED report with status POSTED", () => {
    const result = mapPluggyTransactionToExternalTransactionInput(
      fixturePostedCardPurchaseTransaction,
      "CREDIT_CARD",
    );
    expect(result.status).toBe("POSTED");
    expect(result.externalTransactionId).toBe(fixturePendingCardPurchaseTransaction.id);
  });
});

describe("mapPluggyTransactionToExternalTransactionInput — installment metadata", () => {
  it("maps installmentNumber/totalInstallments/totalAmount and the origin bill id", () => {
    const result = mapPluggyTransactionToExternalTransactionInput(
      fixtureInstallmentPurchaseTransaction,
      "CREDIT_CARD",
    );
    expect(result.installmentMetadata?.installmentNumber).toBe(3);
    expect(result.installmentMetadata?.totalInstallments).toBe(10);
    expect(result.installmentMetadata?.totalAmountCents).toBe(200_000);
    expect(result.installmentMetadata?.externalBillId).toBe("fixture-bill-1");
  });
});

describe("mapPluggyTransactionToExternalTransactionInput — provider category is preserved but not authoritative", () => {
  it("carries providerCategory separately from our own category field (which starts null)", () => {
    const result = mapPluggyTransactionToExternalTransactionInput(fixtureCardPurchaseTransaction, "CREDIT_CARD");
    expect(result.providerCategory).toBe("Food");
    // ExternalTransactionInput has no `category` field at all — our
    // deterministic categorization pipeline assigns it later.
    expect("category" in result).toBe(false);
  });
});

describe("mapPluggyBillToExternalBillInput", () => {
  it("maps due date, closing date, total and minimum payment", () => {
    const result = mapPluggyBillToExternalBillInput(fixtureCreditCardBill, fixtureCreditCardAccount.id);
    expect(result.dueDate).toBe("2026-10-10");
    expect(result.closingDate).toBe("2026-10-01");
    expect(result.totalAmountCents).toBe(85_000);
    expect(result.minimumPaymentCents).toBe(8_500);
    expect(result.allowsInstallments).toBe(true);
  });
});
