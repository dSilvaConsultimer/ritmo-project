import { describe, expect, it } from "vitest";
import { createId } from "@money-copilot/shared";
import {
  buildFinancialPositionFromAccounts,
  buildFinancialSnapshot,
  paymentSourceFromExternalAccount,
  fromReais,
  subtract,
  isPositive,
  ZERO,
  type FinancialSnapshotInput,
} from "@money-copilot/financial-engine";
import { mapPluggyAccountToExternalAccountInput } from "./mappers";
import { fixtureBankAccount, fixtureCreditCardAccount } from "./fixtures/index";
import type { Account } from "pluggy-sdk";

/**
 * DEC-130 — end-to-end regression using the EXACT real Pluggy payload
 * reported for the Founder's own connected account (not a hardcoded
 * Safe-to-Spend number): runs the full mapper -> domain -> position ->
 * snapshot pipeline exactly as `syncConnection`/`getFinancialSnapshot`
 * would, and derives every expected figure from the same raw payload
 * constants independently, so this test would fail if the pipeline ever
 * silently double-subtracts (or forgets to subtract) reservedBalance, or
 * ever lets automaticallyInvestedBalance leak into spendable cash.
 */
const RAW_CHECKING_BALANCE_REAIS = 35_995.75;
const RAW_CLOSING_BALANCE_REAIS = 35_995.75; // identical to balance in the real payload
const RAW_RESERVED_BALANCE_REAIS = 1_000.04;
const RAW_AUTO_INVESTED_REAIS = 3_599.575;
const RAW_CARD_BALANCE_REAIS = 961.95;

const realBankAccount: Account = {
  ...fixtureBankAccount,
  id: "dec130-real-bank-account",
  balance: RAW_CHECKING_BALANCE_REAIS,
  bankData: {
    ...fixtureBankAccount.bankData!,
    closingBalance: RAW_CLOSING_BALANCE_REAIS,
    automaticallyInvestedBalance: RAW_AUTO_INVESTED_REAIS,
    hasReservedBalance: true,
    reservedBalances: [
      {
        name: "Caixinha Para Férias",
        identification: "dec130-real-reserve",
        availableAmounts: [{ amount: RAW_RESERVED_BALANCE_REAIS, currencyCode: "BRL", remuneration: null }],
      },
    ],
  },
};

const realCardAccount: Account = {
  ...fixtureCreditCardAccount,
  id: "dec130-real-card-account",
  balance: RAW_CARD_BALANCE_REAIS,
};

function minimalInput(overrides: Partial<FinancialSnapshotInput> = {}): FinancialSnapshotInput {
  return {
    asOfDate: "2026-09-15",
    income: [],
    fixedExpenses: [],
    variableBudgets: [],
    transactions: [],
    reconciliationLinks: [],
    events: [],
    installmentPlans: [],
    goal: { id: createId("financial-goal"), label: "No goal set yet", monthlySavingsTarget: ZERO },
    protectedPreferences: [],
    ...overrides,
  };
}

describe("DEC-130 full pipeline regression — real Pluggy payload (mapper -> domain -> position -> snapshot)", () => {
  it("deducts reservedBalance exactly once and never lets automaticallyInvestedBalance alter spendable liquidity", () => {
    const connectionId = createId("provider-connection");
    const profileId = createId("financial-profile");

    const bankInput = mapPluggyAccountToExternalAccountInput(realBankAccount);
    const cardInput = mapPluggyAccountToExternalAccountInput(realCardAccount);

    // The mapper itself must surface closingBalance/reservedBalance/
    // automaticallyInvestedBalance distinctly from the raw balance.
    expect(bankInput.balanceCents).toBe(fromReais(RAW_CHECKING_BALANCE_REAIS).cents);
    expect(bankInput.availableBalanceCents).toBe(fromReais(RAW_CLOSING_BALANCE_REAIS).cents);
    expect(bankInput.reservedBalanceCents).toBe(fromReais(RAW_RESERVED_BALANCE_REAIS).cents);
    expect(bankInput.automaticallyInvestedBalanceCents).toBe(fromReais(RAW_AUTO_INVESTED_REAIS).cents);

    const bankPaymentSource = paymentSourceFromExternalAccount(bankInput, connectionId);
    const cardPaymentSource = paymentSourceFromExternalAccount(cardInput, connectionId);

    const position = buildFinancialPositionFromAccounts(
      [bankPaymentSource, cardPaymentSource],
      profileId,
      "2026-09-15",
      "pluggy",
    );

    // Independently derived expectation — computed from the RAW payload
    // constants above via Money arithmetic, never copied from the
    // implementation under test: closingBalance (== balance here) MINUS
    // the reservation, subtracted exactly once.
    const expectedCash = subtract(
      fromReais(RAW_CLOSING_BALANCE_REAIS),
      fromReais(RAW_RESERVED_BALANCE_REAIS),
    );
    expect(position.cashBalance.amount?.cents).toBe(expectedCash.cents);
    expect(position.reservedBalance.amount?.cents).toBe(fromReais(RAW_RESERVED_BALANCE_REAIS).cents);
    expect(position.automaticallyInvestedBalance.amount?.cents).toBe(
      fromReais(RAW_AUTO_INVESTED_REAIS).cents,
    );
    expect(position.cardOutstandingBalance.amount?.cents).toBe(fromReais(RAW_CARD_BALANCE_REAIS).cents);

    // Proof automaticallyInvestedBalance never alters spendable cash: an
    // otherwise-identical account with NO auto-invested balance at all
    // must produce the EXACT SAME cashBalance.
    const bankAccountWithoutInvested: Account = {
      ...realBankAccount,
      bankData: { ...realBankAccount.bankData!, automaticallyInvestedBalance: null },
    };
    const bankInputWithoutInvested = mapPluggyAccountToExternalAccountInput(bankAccountWithoutInvested);
    const bankPaymentSourceWithoutInvested = paymentSourceFromExternalAccount(
      bankInputWithoutInvested,
      connectionId,
    );
    const positionWithoutInvested = buildFinancialPositionFromAccounts(
      [bankPaymentSourceWithoutInvested, cardPaymentSource],
      profileId,
      "2026-09-15",
      "pluggy",
    );
    expect(positionWithoutInvested.cashBalance.amount?.cents).toBe(position.cashBalance.amount?.cents);

    // --- Full snapshot, no declared plan data at all ---
    const snapshot = buildFinancialSnapshot(minimalInput({ position }));

    expect(snapshot.liquidity.basis).toBe("LIQUIDITY_AWARE");
    const expectedRecommendedTotal = subtract(
      expectedCash,
      fromReais(RAW_CARD_BALANCE_REAIS),
    );
    expect(snapshot.liquidity.recommendedTotal.cents).toBe(expectedRecommendedTotal.cents);
    expect(snapshot.recommendedCommittedTotal.cents).toBe(fromReais(RAW_CARD_BALANCE_REAIS).cents);
    expect(isPositive(snapshot.liquidity.recommendedTotal)).toBe(true);
  });
});
