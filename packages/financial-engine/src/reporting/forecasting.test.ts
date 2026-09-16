import { describe, expect, it } from "vitest";
import { createId } from "@money-copilot/shared";
import * as M from "../money/index";
import type { FinancialTransaction, PaymentSource } from "../domain/transaction";
import { detectRecurringFixedCommitments } from "../domain/recurring-fixed";
import { computeExpectedMonthlyIncome, computeExpectedMonthlyVariableSpending } from "./forecasting";

const ASOF = "2026-09-15"; // completed months: 2026-06, 2026-07, 2026-08
const source: PaymentSource = { id: createId("payment-source"), label: "Conta", type: "DEBIT" };

function tx(overrides: Partial<FinancialTransaction> = {}): FinancialTransaction {
  return {
    id: createId("transaction"),
    financialProfileId: createId("financial-profile"),
    paymentSource: source,
    date: "2026-08-05",
    amount: M.fromReais(100),
    direction: "CREDIT",
    rawDescription: "GENERIC",
    normalizedDescription: "GENERIC",
    status: "POSTED",
    certainty: "ACTUAL",
    financialEffect: "INCOME",
    category: null,
    origin: "IMPORTED",
    createdAt: "2026-08-05",
    updatedAt: "2026-08-05",
    ...overrides,
  };
}

describe("computeExpectedMonthlyIncome (DEC-140)", () => {
  it("(test F) salaried income — 8500/8500/8500 across 3 completed months — expected monthly income is 8500", () => {
    const transactions = [
      tx({ date: "2026-06-05", amount: M.fromReais(8500) }),
      tx({ date: "2026-07-05", amount: M.fromReais(8500) }),
      tx({ date: "2026-08-05", amount: M.fromReais(8500) }),
    ];
    const result = computeExpectedMonthlyIncome(transactions, ASOF);
    expect(result.expectedMonthlyIncome.cents).toBe(M.fromReais(8500).cents);
    expect(result.confidence).toBe("HIGH");
  });

  it("(test G) split salaried/autonomous income — aggregates each month FIRST, then averages", () => {
    const transactions = [
      // June: Client A 3000 + Client B 2000 = 5000
      tx({ date: "2026-06-10", amount: M.fromReais(3000), rawDescription: "CLIENT A" }),
      tx({ date: "2026-06-20", amount: M.fromReais(2000), rawDescription: "CLIENT B" }),
      // July: Client C 4000 + Client D 2000 = 6000
      tx({ date: "2026-07-10", amount: M.fromReais(4000), rawDescription: "CLIENT C" }),
      tx({ date: "2026-07-20", amount: M.fromReais(2000), rawDescription: "CLIENT D" }),
      // August: Client A 4500 + Client E 1000 = 5500
      tx({ date: "2026-08-10", amount: M.fromReais(4500), rawDescription: "CLIENT A" }),
      tx({ date: "2026-08-20", amount: M.fromReais(1000), rawDescription: "CLIENT E" }),
    ];
    const result = computeExpectedMonthlyIncome(transactions, ASOF);
    expect(result.monthlyTotals.map((m) => m.cents)).toEqual([
      M.fromReais(5000).cents,
      M.fromReais(6000).cents,
      M.fromReais(5500).cents,
    ]);
    // (5000 + 6000 + 5500) / 3 = 5500
    expect(result.expectedMonthlyIncome.cents).toBe(M.fromReais(5500).cents);
  });

  it("(test H) a realized current-month salary still shows in the forecast — this function has no concept of Safe-to-Spend at all", () => {
    // The forecast is built ONLY from the 3 completed months before asOfDate
    // — a transaction dated in the CURRENT month never enters this
    // calculation in the first place, so "already realized this month" is
    // structurally irrelevant to what this function returns. The actual
    // no-double-counting guarantee is proven at the Home/Planning
    // consistency level (see apps/ritmo's own regression test) — this test
    // only proves the forecast doesn't fluctuate based on current-month
    // realization.
    const historical = [
      tx({ date: "2026-06-05", amount: M.fromReais(8500) }),
      tx({ date: "2026-07-05", amount: M.fromReais(8500) }),
      tx({ date: "2026-08-05", amount: M.fromReais(8500) }),
    ];
    const withRealizedCurrentMonth = [
      ...historical,
      tx({ date: "2026-09-05", amount: M.fromReais(8500) }),
    ];
    const withoutIt = computeExpectedMonthlyIncome(historical, ASOF);
    const withIt = computeExpectedMonthlyIncome(withRealizedCurrentMonth, ASOF);
    expect(withIt.expectedMonthlyIncome.cents).toBe(withoutIt.expectedMonthlyIncome.cents);
    expect(withIt.expectedMonthlyIncome.cents).toBe(M.fromReais(8500).cents);
  });

  it("(test I) transfers, refunds, and investment redemptions never inflate expected income", () => {
    const transactions = [
      tx({ date: "2026-06-05", amount: M.fromReais(8500) }),
      tx({ date: "2026-06-06", amount: M.fromReais(5000), financialEffect: "TRANSFER" }),
      tx({ date: "2026-07-05", amount: M.fromReais(8500) }),
      tx({ date: "2026-07-06", amount: M.fromReais(300), financialEffect: "REFUND" }),
      tx({ date: "2026-08-05", amount: M.fromReais(8500) }),
      tx({ date: "2026-08-06", amount: M.fromReais(2000), financialEffect: "INVESTMENT_REDEMPTION" }),
    ];
    const result = computeExpectedMonthlyIncome(transactions, ASOF);
    expect(result.expectedMonthlyIncome.cents).toBe(M.fromReais(8500).cents);
  });

  it("reports LOW confidence and a best-effort figure when no income history exists at all", () => {
    const result = computeExpectedMonthlyIncome([], ASOF);
    expect(result.confidence).toBe("LOW");
    expect(result.expectedMonthlyIncome.cents).toBe(0);
  });

  it("excludes REVERSED income transactions", () => {
    const transactions = [
      tx({ date: "2026-06-05", amount: M.fromReais(8500) }),
      tx({ date: "2026-07-05", amount: M.fromReais(8500) }),
      tx({ date: "2026-08-05", amount: M.fromReais(8500) }),
      tx({ date: "2026-08-06", amount: M.fromReais(9999), status: "REVERSED" }),
    ];
    const result = computeExpectedMonthlyIncome(transactions, ASOF);
    expect(result.expectedMonthlyIncome.cents).toBe(M.fromReais(8500).cents);
  });
});

describe("computeExpectedMonthlyVariableSpending (DEC-140)", () => {
  function consumption(overrides: Partial<FinancialTransaction> = {}): FinancialTransaction {
    return tx({ direction: "DEBIT", financialEffect: "CONSUMPTION", ...overrides });
  }

  it("subtracts recognized recurring-fixed evidence transactions from eligible consumption before averaging", () => {
    const rentJune = consumption({ normalizedMerchant: "ALUGUEL", date: "2026-06-01", amount: M.fromReais(1500) });
    const rentJuly = consumption({ normalizedMerchant: "ALUGUEL", date: "2026-07-01", amount: M.fromReais(1500) });
    const rentAugust = consumption({ normalizedMerchant: "ALUGUEL", date: "2026-08-01", amount: M.fromReais(1500) });
    // Deliberately DIFFERENT identities each month — genuinely one-off
    // variable spending, never itself forming a 3-consecutive-month
    // recurring pattern (which would make it recognized as fixed too,
    // exactly like ALUGUEL — that's the correct behavior for a REAL
    // recurring identity, just not what this test is isolating).
    const juneShopping = consumption({ normalizedMerchant: "MERCADO A", date: "2026-06-10", amount: M.fromReais(600) });
    const julyShopping = consumption({ normalizedMerchant: "PADARIA", date: "2026-07-10", amount: M.fromReais(700) });
    const augustShopping = consumption({ normalizedMerchant: "FARMACIA", date: "2026-08-10", amount: M.fromReais(500) });
    const transactions = [rentJune, rentJuly, rentAugust, juneShopping, julyShopping, augustShopping];

    const recurring = detectRecurringFixedCommitments(transactions, [], ASOF);
    const recurringIds = new Set(recurring.flatMap((c) => c.transactionIds));
    expect(recurringIds.size).toBe(3); // just the 3 ALUGUEL evidence transactions

    const variable = computeExpectedMonthlyVariableSpending(transactions, [], ASOF, recurringIds);
    // (600 + 700 + 500) / 3 = 600 — rent is excluded entirely.
    expect(variable.cents).toBe(M.fromReais(600).cents);
  });

  it("excludes finite installment transactions from the variable-spending residual too", () => {
    const installment = consumption({
      normalizedMerchant: "LOJA X",
      rawDescription: "LOJA X 3/12",
      normalizedDescription: "LOJA X 3/12",
      date: "2026-08-20",
      amount: M.fromReais(200),
    });
    const groceries = consumption({ normalizedMerchant: "MERCADO", date: "2026-08-10", amount: M.fromReais(500) });
    const transactions = [installment, groceries];

    const variable = computeExpectedMonthlyVariableSpending(transactions, [], ASOF, new Set());
    // Only June/July/August are considered; only August has data here, so
    // the average is (500)/3 (July/June contribute 0) = 166.67ish — the
    // key assertion is that the 200 installment never contributes at all.
    const expectedCents = Math.round(M.fromReais(500).cents / 3);
    expect(variable.cents).toBe(expectedCents);
  });
});
