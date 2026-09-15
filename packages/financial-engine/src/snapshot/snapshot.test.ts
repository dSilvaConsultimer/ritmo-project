import { describe, expect, it } from "vitest";
import { createId, type Id } from "@money-copilot/shared";
import * as M from "../money/index";
import { buildFinancialSnapshot, type FinancialSnapshotInput } from "./snapshot";
import {
  initialUserSnapshotInput,
  motherSupport,
  fixedExpenses,
  reconciliationLinks,
  oldCreditCardDebtPlan,
} from "../fixtures/initial-user";
import { nubankCreditCard } from "../fixtures/transactions";
import { FIXTURE_PROFILE_ID } from "../fixtures/profile";
import { actual, unknownAmount } from "../domain/certainty";
import type { FinancialPosition } from "../domain/position";
import type { Income } from "../domain/income";
import type { FixedExpense } from "../domain/expense";
import type { FinancialEvent } from "../domain/event";
import type { FinancialTransaction, PaymentSource } from "../domain/transaction";

describe("buildFinancialSnapshot (initial user fixture)", () => {
  const snapshot = buildFinancialSnapshot(initialUserSnapshotInput);

  it("computes gross income, taxes and usable income", () => {
    expect(snapshot.income.gross.cents).toBe(1_500_000);
    expect(snapshot.income.taxes.cents).toBe(87_000);
    expect(snapshot.income.usable.cents).toBe(1_413_000);
  });

  it("sums fixed commitments excluding tax AND excluding the old debt installment", () => {
    // housing 160000 + mother 100000 + car 271500 + life insurance 36000
    // + gym 15000 + footvolley 15500 = 598000. The old debt (140000) now
    // lives in `debtCommitments`, sourced from the InstallmentPlan — see
    // DEC-011. This reclassification changes bucket labeling only, not the
    // total committed math (verified below).
    expect(snapshot.commitments.fixed.cents).toBe(598_000);
    expect(snapshot.commitments.debtCommitments.cents).toBe(140_000);
  });

  it("includes the protected BRL 1,000 mother support as a fixed commitment", () => {
    expect(motherSupport.protected).toBe(true);
    expect(motherSupport.amount.cents).toBe(100_000);
    expect(fixedExpenses.some((e) => e.id === motherSupport.id && e.protected)).toBe(true);
  });

  it("sums variable budgets (food target)", () => {
    expect(snapshot.commitments.variableBudgets.cents).toBe(150_000);
  });

  it("reconciles the rodeo ticket transaction with the event line item — counted exactly once", () => {
    // The rodeo ticket exists BOTH as a raw transaction (47610) and as the
    // rodeo event's ALREADY_PAID line item (47610). A CONFIRMED
    // reconciliation link excludes the transaction from the transaction-
    // level sum, so the event breakdown is the sole source for it.
    const rodeoLink = reconciliationLinks.find((l) => l.type === "TRANSACTION_EVENT_LINE_ITEM");
    expect(rodeoLink).toBeDefined();
    expect(rodeoLink?.status).toBe("CONFIRMED");

    // actualSpending = iFood(4500) + Mineiros Dog(2600) + Adega do Rai(5550)
    // + OXXO(4078) + TikTok Shop(17302) + PagSeguro(1249) [= 35279 in raw
    // transactions] + rodeo ticket via the EVENT breakdown (47610) = 82889.
    // If the ticket were double-counted, this would be 82889 + 47610 more.
    expect(snapshot.commitments.actualSpending.cents).toBe(82_889);
  });

  it("reserves the confirmed future rodeo transportation cost", () => {
    expect(snapshot.commitments.futureConfirmed.cents).toBe(10_000);
  });

  it("represents the estimated rodeo drinks cost as an estimated future expense", () => {
    expect(snapshot.commitments.futureEstimated.cents).toBe(15_000);
  });

  it("flags the unknown beach trip budget with a warning, not as zero", () => {
    expect(snapshot.commitments.unknownLabels.length).toBeGreaterThan(0);
    expect(snapshot.commitments.unknownLabels[0]).toContain("Beach trip");
    expect(snapshot.warnings.some((w) => w.toLowerCase().includes("unknown"))).toBe(true);
  });

  it("degrades confidence to LOW when any commitment is unknown", () => {
    expect(snapshot.confidence).toBe("LOW");
  });

  it("computes discretionary cash, protected savings and safe-to-spend", () => {
    expect(snapshot.discretionaryBeforeSavings.cents).toBe(417_111);
    expect(snapshot.protectedSavings.cents).toBe(200_000);
    expect(snapshot.projectedSavings.cents).toBe(200_000);
    expect(snapshot.safeToSpend.total.cents).toBe(217_111);
  });

  it("spreads safe-to-spend across the remaining days of the month", () => {
    expect(snapshot.safeToSpend.daysRemainingInMonth).toBe(26);
    expect(snapshot.safeToSpend.recommendedForToday.cents).toBe(8_350);
  });

  it("Safe-to-Spend has a deterministic, exactly-reconciling breakdown", () => {
    const breakdown = snapshot.safeToSpendBreakdown;
    const summedComponents = M.sum(breakdown.components.map((c) => c.amount));
    expect(summedComponents.cents).toBe(breakdown.total.cents);
    expect(breakdown.total.cents).toBe(snapshot.safeToSpend.total.cents);
    expect(breakdown.components.map((c) => c.type)).toEqual([
      "USABLE_INCOME",
      "FIXED_COMMITMENTS",
      "VARIABLE_BUDGETS",
      "ACTUAL_SPENDING",
      "DEBT_COMMITMENTS",
      "FUTURE_CONFIRMED",
      "FUTURE_ESTIMATED",
      "PROTECTED_SAVINGS",
    ]);
  });

  it("exposes future installment commitments without deducting them all from this month", () => {
    const future = snapshot.futureInstallmentCommitments;
    expect(future.currentPeriodAmount.cents).toBe(140_000);
    // The old debt plan has an unknown schedule — projections beyond this
    // month are an explicit, flagged estimate, not silently omitted.
    expect(future.hasIncompleteData).toBe(true);
    expect(future.incompletePlanDescriptions).toContain(oldCreditCardDebtPlan.description);
    expect(future.next30DaysCommitment.cents).toBe(140_000);
    expect(future.next90DaysCommitment.cents).toBe(420_000);
  });

  it("reports liquidity as unknown when no FinancialPosition is supplied", () => {
    expect(snapshot.liquidity.liquidityAwareSafeToSpend).toBeNull();
    expect(snapshot.liquidity.confidence).toBe("UNKNOWN");
    expect(snapshot.liquidity.planSafeToSpend.cents).toBe(217_111);
  });
});

describe("Sprint 1 -> Sprint 2 Safe-to-Spend reconciliation", () => {
  it("explains why the number changed from BRL 2,478.90 to BRL 2,171.11", () => {
    // Sprint 1 fixture only had one transaction (iFood, 4500) and lumped the
    // old debt into `fixed`. Sprint 2 adds five more real transactions
    // (Mineiros Dog, Adega do Rai, OXXO, TikTok Shop, PagSeguro) and moves
    // the old debt into its own `debtCommitments` bucket (revenue-neutral
    // reclassification: 738000 = 598000 + 140000). The ONLY numeric change
    // is the newly-added real spending — see DEC-013 for the full account.
    const snapshot = buildFinancialSnapshot(initialUserSnapshotInput);

    const sprint1SafeToSpend = 247_890;
    const newRealSpending = 2_600 + 5_550 + 4_078 + 17_302 + 1_249; // = 30,779
    expect(newRealSpending).toBe(30_779);
    expect(snapshot.safeToSpend.total.cents).toBe(sprint1SafeToSpend - newRealSpending);
    expect(snapshot.safeToSpend.total.cents).toBe(217_111);
  });
});

describe("buildFinancialSnapshot — confidence levels", () => {
  const baseline: FinancialSnapshotInput = {
    ...initialUserSnapshotInput,
    events: [],
    transactions: [],
    reconciliationLinks: [],
  };

  it("is HIGH confidence when nothing is estimated or unknown", () => {
    const allActual: FinancialSnapshotInput = {
      ...baseline,
      fixedExpenses: baseline.fixedExpenses.map((e) => ({ ...e, certainty: "ACTUAL" as const })),
      variableBudgets: baseline.variableBudgets.map((b) => ({
        ...b,
        certainty: "ACTUAL" as const,
      })),
      installmentPlans: [],
    };
    expect(buildFinancialSnapshot(allActual).confidence).toBe("HIGH");
  });

  it("is MEDIUM confidence when something is estimated but nothing is unknown", () => {
    expect(buildFinancialSnapshot(baseline).confidence).toBe("MEDIUM");
  });
});

describe("buildFinancialSnapshot — negative safe-to-spend", () => {
  it("warns when spending as committed would eat into protected savings", () => {
    const overCommitted: FinancialSnapshotInput = {
      ...initialUserSnapshotInput,
      goal: {
        ...initialUserSnapshotInput.goal,
        monthlySavingsTarget: M.fromReais(10_000),
      },
    };
    const snapshot = buildFinancialSnapshot(overCommitted);
    expect(M.isNegative(snapshot.safeToSpend.total)).toBe(true);
    expect(
      snapshot.warnings.some((w) => w.toLowerCase().includes("negative")),
    ).toBe(true);
    expect(snapshot.projectedSavings.cents).toBeLessThan(1_000_000);
  });
});

describe("buildFinancialSnapshot — card payment / transfer double-counting (NON-NEGOTIABLE)", () => {
  const base = initialUserSnapshotInput;

  it("does not count a credit-card bill payment as a second expense on top of its underlying purchase", () => {
    const dinner = base.transactions.find((t) => t.normalizedMerchant === "IFOOD")!;
    const cardPayment = {
      ...dinner,
      id: "transaction_test_card_payment" as typeof dinner.id,
      financialEffect: "CARD_PAYMENT" as const,
      category: null,
      amount: dinner.amount, // same BRL 45 the dinner cost, paid off on the card bill
    };

    const withoutPayment = buildFinancialSnapshot(base);
    const withPayment = buildFinancialSnapshot({
      ...base,
      transactions: [...base.transactions, cardPayment],
    });

    expect(withPayment.commitments.actualSpending.cents).toBe(
      withoutPayment.commitments.actualSpending.cents,
    );
  });

  it("does not count a transfer between the user's own accounts as consumption", () => {
    const dinner = base.transactions.find((t) => t.normalizedMerchant === "IFOOD")!;
    const transfer = {
      ...dinner,
      id: "transaction_test_transfer" as typeof dinner.id,
      financialEffect: "TRANSFER" as const,
      category: null,
      amount: M.fromReais(500),
    };

    const withoutTransfer = buildFinancialSnapshot(base);
    const withTransfer = buildFinancialSnapshot({
      ...base,
      transactions: [...base.transactions, transfer],
    });

    expect(withTransfer.commitments.actualSpending.cents).toBe(
      withoutTransfer.commitments.actualSpending.cents,
    );
  });

  it("nets a refund against consumption for the same category", () => {
    const dinner = base.transactions.find((t) => t.normalizedMerchant === "IFOOD")!;
    const refund = {
      ...dinner,
      id: "transaction_test_refund" as typeof dinner.id,
      financialEffect: "REFUND" as const,
      direction: "CREDIT" as const,
      amount: M.fromReais(20),
    };

    const withoutRefund = buildFinancialSnapshot(base);
    const withRefund = buildFinancialSnapshot({
      ...base,
      transactions: [...base.transactions, refund],
    });

    expect(withRefund.commitments.actualSpending.cents).toBe(
      withoutRefund.commitments.actualSpending.cents - 2_000,
    );
  });

  it("does not count income transactions as consumption", () => {
    const dinner = base.transactions.find((t) => t.normalizedMerchant === "IFOOD")!;
    const income = {
      ...dinner,
      id: "transaction_test_income" as typeof dinner.id,
      financialEffect: "INCOME" as const,
      direction: "CREDIT" as const,
      category: null,
      amount: M.fromReais(1_000),
    };

    const withoutIncome = buildFinancialSnapshot(base);
    const withIncome = buildFinancialSnapshot({
      ...base,
      transactions: [...base.transactions, income],
    });

    expect(withIncome.commitments.actualSpending.cents).toBe(
      withoutIncome.commitments.actualSpending.cents,
    );
  });

  it("counts a fee as consumption-like spending", () => {
    const dinner = base.transactions.find((t) => t.normalizedMerchant === "IFOOD")!;
    const fee = {
      ...dinner,
      id: "transaction_test_fee" as typeof dinner.id,
      financialEffect: "FEE" as const,
      category: "Bank Fees",
      amount: M.fromReais(10),
    };

    const withoutFee = buildFinancialSnapshot(base);
    const withFee = buildFinancialSnapshot({
      ...base,
      transactions: [...base.transactions, fee],
    });

    expect(withFee.commitments.actualSpending.cents).toBe(
      withoutFee.commitments.actualSpending.cents + 1_000,
    );
  });

  it("excludes reversed transactions entirely", () => {
    const dinner = base.transactions.find((t) => t.normalizedMerchant === "IFOOD")!;
    const reversed = {
      ...dinner,
      id: "transaction_test_reversed" as typeof dinner.id,
      status: "REVERSED" as const,
      amount: M.fromReais(999),
    };

    const withoutReversed = buildFinancialSnapshot(base);
    const withReversed = buildFinancialSnapshot({
      ...base,
      transactions: [...base.transactions, reversed],
    });

    expect(withReversed.commitments.actualSpending.cents).toBe(
      withoutReversed.commitments.actualSpending.cents,
    );
  });
});

describe("buildFinancialSnapshot — liquidity-aware Safe-to-Spend (DEC-130)", () => {
  const checkingAccount: PaymentSource = {
    id: "payment-source_test-checking" as Id<"payment-source">,
    label: "Test Checking",
    type: "DEBIT",
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
      goal: { id: createId("financial-goal"), label: "No goal set yet", monthlySavingsTarget: M.ZERO },
      protectedPreferences: [],
      ...overrides,
    };
  }

  function income(overrides: Partial<Income> & Pick<Income, "grossAmount" | "certainty" | "source">): Income {
    return {
      id: createId("income"),
      label: "Test income",
      recurring: true,
      ...overrides,
    };
  }

  function fixedExpense(
    overrides: Partial<FixedExpense> & Pick<FixedExpense, "amount" | "certainty">,
  ): FixedExpense {
    return {
      id: createId("fixed-expense"),
      label: "Test expense",
      category: "Test",
      protected: false,
      ...overrides,
    };
  }

  it("(test 1) real liquidity with zero declared income still produces a positive Safe-to-Spend — the exact DEC-130 bug", () => {
    const position: FinancialPosition = {
      id: createId("financial-position"),
      financialProfileId: FIXTURE_PROFILE_ID,
      asOf: "2026-09-15",
      cashBalance: actual(M.fromReais(35_995.75)),
      cardOutstandingBalance: actual(M.fromReais(961.95)),
      otherLiabilities: unknownAmount(),
      reservedBalance: unknownAmount(),
      automaticallyInvestedBalance: unknownAmount(),
      source: "pluggy",
      coverage: "PARTIAL",
    };
    const input = minimalInput({ position });
    const snapshot = buildFinancialSnapshot(input);

    // The declared plan is a flat zero here (nothing declared at all) — see
    // the dedicated (test 11) below for the real-world case where the plan
    // is actually negative. The point of THIS test is narrower: liquidity
    // alone, with zero declared income, must still be able to produce a
    // real positive number instead of being capped by the plan.
    expect(snapshot.safeToSpend.total.cents).toBe(0);

    expect(snapshot.liquidity.basis).toBe("LIQUIDITY_AWARE");
    expect(M.isPositive(snapshot.liquidity.liquidityAwareSafeToSpend!)).toBe(true);
    expect(snapshot.liquidity.liquidityAwareSafeToSpend?.cents).toBe(M.fromReais(35_033.8).cents);
    expect(snapshot.liquidity.recommendedTotal.cents).toBe(M.fromReais(35_033.8).cents);
  });

  it("(test 1: early income) salary received BEFORE its expectedDayOfMonth reconciles by amount and is NOT added again, despite the day not having arrived yet", () => {
    // The Founder's own failure case: expected day 20, real transaction day
    // 15. A due-day-only rule would have added it again (day 20 > day 15);
    // reconciliation-by-amount catches the real transaction regardless.
    const position: FinancialPosition = {
      id: createId("financial-position"),
      financialProfileId: FIXTURE_PROFILE_ID,
      asOf: "2026-09-15",
      cashBalance: actual(M.fromReais(10_000)), // already includes the early salary
      cardOutstandingBalance: unknownAmount(),
      otherLiabilities: unknownAmount(),
      reservedBalance: unknownAmount(),
      automaticallyInvestedBalance: unknownAmount(),
      source: "pluggy",
      coverage: "PARTIAL",
    };
    const salaryTransaction: FinancialTransaction = {
      id: createId("transaction"),
      financialProfileId: FIXTURE_PROFILE_ID,
      paymentSource: checkingAccount,
      date: "2026-09-15",
      amount: M.fromReais(8_500),
      direction: "CREDIT",
      rawDescription: "SALARIO EMPRESA XYZ LTDA",
      normalizedDescription: "SALARIO EMPRESA XYZ LTDA",
      status: "POSTED",
      certainty: "ACTUAL",
      financialEffect: "INCOME",
      category: null,
      origin: "IMPORTED",
      createdAt: "2026-09-15T00:00:00.000Z",
      updatedAt: "2026-09-15T00:00:00.000Z",
    };
    const input = minimalInput({
      asOfDate: "2026-09-15", // today; expected day (20) is still ahead
      income: [
        income({ grossAmount: M.fromReais(8_500), certainty: "CONFIRMED", source: "USER_DECLARED", expectedDayOfMonth: 20 }),
      ],
      transactions: [salaryTransaction],
      position,
    });
    const snapshot = buildFinancialSnapshot(input);

    expect(snapshot.liquidity.components.some((c) => c.type === "FUTURE_CONFIRMED_INCOME")).toBe(false);
    expect(snapshot.liquidity.liquidityAwareSafeToSpend?.cents).toBe(M.fromReais(10_000).cents);
  });

  it("(test 2: overdue income) salary NOT received after its expectedDayOfMonth is conservatively excluded, never assumed received", () => {
    const position: FinancialPosition = {
      id: createId("financial-position"),
      financialProfileId: FIXTURE_PROFILE_ID,
      asOf: "2026-09-15",
      cashBalance: actual(M.fromReais(10_000)), // does NOT actually contain the salary
      cardOutstandingBalance: unknownAmount(),
      otherLiabilities: unknownAmount(),
      reservedBalance: unknownAmount(),
      automaticallyInvestedBalance: unknownAmount(),
      source: "pluggy",
      coverage: "PARTIAL",
    };
    const input = minimalInput({
      asOfDate: "2026-09-15", // day 15 — expected day 5 has already passed
      income: [
        income({ grossAmount: M.fromReais(8_500), certainty: "CONFIRMED", source: "USER_DECLARED", expectedDayOfMonth: 5 }),
      ],
      transactions: [], // no matching transaction anywhere this month
      position,
    });
    const snapshot = buildFinancialSnapshot(input);

    // Never silently assumed received just because the day passed — it is
    // simply not added (the conservative direction: never overstate).
    expect(snapshot.liquidity.components.some((c) => c.type === "FUTURE_CONFIRMED_INCOME")).toBe(false);
    expect(snapshot.liquidity.liquidityAwareSafeToSpend?.cents).toBe(M.fromReais(10_000).cents);
    expect(snapshot.warnings.some((w) => w.toLowerCase().includes("not been confirmed as received"))).toBe(true);
  });

  it("(test 3: bill paid before due day) reconciles by amount and is NOT subtracted again, even though its due day hasn't arrived yet", () => {
    const position: FinancialPosition = {
      id: createId("financial-position"),
      financialProfileId: FIXTURE_PROFILE_ID,
      asOf: "2026-09-15",
      cashBalance: actual(M.fromReais(10_000)), // already reflects the early payment
      cardOutstandingBalance: unknownAmount(),
      otherLiabilities: unknownAmount(),
      reservedBalance: unknownAmount(),
      automaticallyInvestedBalance: unknownAmount(),
      source: "pluggy",
      coverage: "PARTIAL",
    };
    const rentPayment: FinancialTransaction = {
      id: createId("transaction"),
      financialProfileId: FIXTURE_PROFILE_ID,
      paymentSource: checkingAccount,
      date: "2026-09-15",
      amount: M.fromReais(2_000),
      direction: "DEBIT",
      rawDescription: "ALUGUEL APARTAMENTO",
      normalizedDescription: "ALUGUEL APARTAMENTO",
      status: "POSTED",
      certainty: "ACTUAL",
      financialEffect: "CONSUMPTION",
      category: "Moradia",
      origin: "IMPORTED",
      createdAt: "2026-09-15T00:00:00.000Z",
      updatedAt: "2026-09-15T00:00:00.000Z",
    };
    const input = minimalInput({
      asOfDate: "2026-09-15", // due day (20) is still ahead — paid early anyway
      fixedExpenses: [
        fixedExpense({ label: "Aluguel", amount: M.fromReais(2_000), certainty: "ACTUAL", dueDayOfMonth: 20 }),
      ],
      transactions: [rentPayment],
      position,
    });
    const snapshot = buildFinancialSnapshot(input);

    expect(snapshot.liquidity.components.some((c) => c.type === "UPCOMING_FIXED_COMMITMENTS")).toBe(false);
    expect(snapshot.liquidity.liquidityAwareSafeToSpend?.cents).toBe(M.fromReais(10_000).cents);
  });

  it("(test 4: overdue bill still unpaid) a due day already passed with NO matching transaction stays a full obligation, never silently assumed paid", () => {
    const position: FinancialPosition = {
      id: createId("financial-position"),
      financialProfileId: FIXTURE_PROFILE_ID,
      asOf: "2026-09-15",
      cashBalance: actual(M.fromReais(10_000)), // rent has NOT actually left this balance
      cardOutstandingBalance: unknownAmount(),
      otherLiabilities: unknownAmount(),
      reservedBalance: unknownAmount(),
      automaticallyInvestedBalance: unknownAmount(),
      source: "pluggy",
      coverage: "PARTIAL",
    };
    const input = minimalInput({
      asOfDate: "2026-09-15", // due day 10 has already passed
      fixedExpenses: [
        fixedExpense({ label: "Aluguel", amount: M.fromReais(2_000), certainty: "ACTUAL", dueDayOfMonth: 10 }),
      ],
      transactions: [], // no matching payment anywhere this month
      position,
    });
    const snapshot = buildFinancialSnapshot(input);

    const commitmentComponent = snapshot.liquidity.components.find(
      (c) => c.type === "UPCOMING_FIXED_COMMITMENTS",
    );
    expect(commitmentComponent?.amount.cents).toBe(M.fromReais(-2_000).cents);
    expect(snapshot.liquidity.liquidityAwareSafeToSpend?.cents).toBe(M.fromReais(8_000).cents);
    // The plan-based total is UNCHANGED — it still treats every fixed
    // expense as committed regardless of due day (existing, documented
    // behavior — see FixedExpense.dueDayOfMonth's own doc comment).
    expect(snapshot.commitments.fixed.cents).toBe(M.fromReais(2_000).cents);
  });

  it("HISTORY_INFERRED income never becomes authoritative planned money on its own, even with reliable certainty and a future day", () => {
    const position: FinancialPosition = {
      id: createId("financial-position"),
      financialProfileId: FIXTURE_PROFILE_ID,
      asOf: "2026-09-15",
      cashBalance: actual(M.fromReais(1_000)),
      cardOutstandingBalance: unknownAmount(),
      otherLiabilities: unknownAmount(),
      reservedBalance: unknownAmount(),
      automaticallyInvestedBalance: unknownAmount(),
      source: "pluggy",
      coverage: "PARTIAL",
    };
    const input = minimalInput({
      asOfDate: "2026-09-15",
      income: [
        income({
          grossAmount: M.fromReais(3_000),
          certainty: "CONFIRMED", // reliable amount...
          source: "HISTORY_INFERRED", // ...but never user-confirmed.
          expectedDayOfMonth: 20,
        }),
      ],
      position,
    });
    const snapshot = buildFinancialSnapshot(input);
    expect(snapshot.liquidity.components.some((c) => c.type === "FUTURE_CONFIRMED_INCOME")).toBe(false);
    expect(snapshot.liquidity.liquidityAwareSafeToSpend?.cents).toBe(M.fromReais(1_000).cents);
  });

  it("(test 4) a sufficiently reliable future salary increases the forward liquidity-aware total", () => {
    const position: FinancialPosition = {
      id: createId("financial-position"),
      financialProfileId: FIXTURE_PROFILE_ID,
      asOf: "2026-09-15",
      cashBalance: actual(M.fromReais(1_000)),
      cardOutstandingBalance: unknownAmount(),
      otherLiabilities: unknownAmount(),
      reservedBalance: unknownAmount(),
      automaticallyInvestedBalance: unknownAmount(),
      source: "pluggy",
      coverage: "PARTIAL",
    };
    const input = minimalInput({
      asOfDate: "2026-09-15", // today is the 15th
      income: [
        income({
          grossAmount: M.fromReais(3_000),
          certainty: "CONFIRMED",
          source: "USER_DECLARED",
          expectedDayOfMonth: 20, // still ahead of today
        }),
      ],
      position,
    });
    const snapshot = buildFinancialSnapshot(input);

    const futureIncomeComponent = snapshot.liquidity.components.find(
      (c) => c.type === "FUTURE_CONFIRMED_INCOME",
    );
    expect(futureIncomeComponent?.amount.cents).toBe(M.fromReais(3_000).cents);
    expect(snapshot.liquidity.liquidityAwareSafeToSpend?.cents).toBe(M.fromReais(4_000).cents);
  });

  it("an ESTIMATED-certainty future income does not count toward the liquidity-aware forward total (not reliable enough)", () => {
    const position: FinancialPosition = {
      id: createId("financial-position"),
      financialProfileId: FIXTURE_PROFILE_ID,
      asOf: "2026-09-15",
      cashBalance: actual(M.fromReais(1_000)),
      cardOutstandingBalance: unknownAmount(),
      otherLiabilities: unknownAmount(),
      reservedBalance: unknownAmount(),
      automaticallyInvestedBalance: unknownAmount(),
      source: "pluggy",
      coverage: "PARTIAL",
    };
    const input = minimalInput({
      asOfDate: "2026-09-15",
      income: [
        income({
          grossAmount: M.fromReais(3_000),
          certainty: "ESTIMATED",
          source: "HISTORY_INFERRED",
          expectedDayOfMonth: 20,
        }),
      ],
      position,
    });
    const snapshot = buildFinancialSnapshot(input);
    expect(snapshot.liquidity.components.some((c) => c.type === "FUTURE_CONFIRMED_INCOME")).toBe(false);
    expect(snapshot.liquidity.liquidityAwareSafeToSpend?.cents).toBe(M.fromReais(1_000).cents);
  });

  it("(test 12) a future event outside the current planning horizon does not affect the liquidity-aware total, even though it still reserves in the broader plan", () => {
    const position: FinancialPosition = {
      id: createId("financial-position"),
      financialProfileId: FIXTURE_PROFILE_ID,
      asOf: "2026-09-15",
      cashBalance: actual(M.fromReais(5_000)),
      cardOutstandingBalance: unknownAmount(),
      otherLiabilities: unknownAmount(),
      reservedBalance: unknownAmount(),
      automaticallyInvestedBalance: unknownAmount(),
      source: "pluggy",
      coverage: "PARTIAL",
    };
    const distantEvent: FinancialEvent = {
      id: createId("financial-event"),
      label: "Trip in December",
      startDate: "2026-12-10",
      endDate: "2026-12-15",
      lineItems: [
        { id: createId("event-line-item"), label: "Hotel", amount: M.fromReais(2_000), certainty: "CONFIRMED", status: "PLANNED" },
      ],
    };
    const input = minimalInput({ asOfDate: "2026-09-15", events: [distantEvent], position });
    const snapshot = buildFinancialSnapshot(input);

    // The broader monthly PLAN still reserves for every known future event
    // regardless of timing — unchanged, existing behavior.
    expect(snapshot.commitments.futureConfirmed.cents).toBe(M.fromReais(2_000).cents);
    // But the liquidity-aware forward total (scoped to THIS month only)
    // must not be reduced by a December trip while asOfDate is September.
    expect(snapshot.liquidity.components.some((c) => c.type === "UPCOMING_EVENT_RESERVATIONS")).toBe(false);
    expect(snapshot.liquidity.liquidityAwareSafeToSpend?.cents).toBe(M.fromReais(5_000).cents);
  });

  it("an event WITHIN the current planning horizon does reduce the liquidity-aware total", () => {
    const position: FinancialPosition = {
      id: createId("financial-position"),
      financialProfileId: FIXTURE_PROFILE_ID,
      asOf: "2026-09-15",
      cashBalance: actual(M.fromReais(5_000)),
      cardOutstandingBalance: unknownAmount(),
      otherLiabilities: unknownAmount(),
      reservedBalance: unknownAmount(),
      automaticallyInvestedBalance: unknownAmount(),
      source: "pluggy",
      coverage: "PARTIAL",
    };
    const thisMonthEvent: FinancialEvent = {
      id: createId("financial-event"),
      label: "Weekend trip",
      startDate: "2026-09-25",
      endDate: "2026-09-27",
      lineItems: [
        { id: createId("event-line-item"), label: "Hotel", amount: M.fromReais(500), certainty: "CONFIRMED", status: "PLANNED" },
      ],
    };
    const input = minimalInput({ asOfDate: "2026-09-15", events: [thisMonthEvent], position });
    const snapshot = buildFinancialSnapshot(input);
    expect(snapshot.liquidity.liquidityAwareSafeToSpend?.cents).toBe(M.fromReais(4_500).cents);
  });

  it("(test 5: planned + realized event reconciles once) an ALREADY_PAID event line item is excluded from the liquidity-aware forward total too, never reserved on top of the money already spent", () => {
    const position: FinancialPosition = {
      id: createId("financial-position"),
      financialProfileId: FIXTURE_PROFILE_ID,
      asOf: "2026-09-15",
      cashBalance: actual(M.fromReais(5_000)), // already reflects the paid ticket
      cardOutstandingBalance: unknownAmount(),
      otherLiabilities: unknownAmount(),
      reservedBalance: unknownAmount(),
      automaticallyInvestedBalance: unknownAmount(),
      source: "pluggy",
      coverage: "PARTIAL",
    };
    const tripEvent: FinancialEvent = {
      id: createId("financial-event"),
      label: "Rodeo weekend",
      startDate: "2026-09-10",
      endDate: "2026-09-12",
      lineItems: [
        // Already happened — must count once, as realized, never reserved again.
        { id: createId("event-line-item"), label: "Ticket", amount: M.fromReais(400), certainty: "ACTUAL", status: "ALREADY_PAID" },
        // Still ahead — genuinely a forward reservation.
        { id: createId("event-line-item"), label: "Transport", amount: M.fromReais(100), certainty: "CONFIRMED", status: "PLANNED" },
      ],
    };
    const input = minimalInput({ asOfDate: "2026-09-15", events: [tripEvent], position });
    const snapshot = buildFinancialSnapshot(input);

    const eventComponent = snapshot.liquidity.components.find(
      (c) => c.type === "UPCOMING_EVENT_RESERVATIONS",
    );
    // Only the still-forward R$100 transport line reduces liquidity — the
    // already-paid R$400 ticket is not reserved a second time.
    expect(eventComponent?.amount.cents).toBe(M.fromReais(-100).cents);
    expect(snapshot.liquidity.liquidityAwareSafeToSpend?.cents).toBe(M.fromReais(4_900).cents);
  });

  it("(test 9) a card purchase plus its own bill payment on checking never double the actual-spending total, once the CARD_PAYMENT effect is applied", () => {
    const purchase: FinancialTransaction = {
      id: createId("transaction"),
      financialProfileId: FIXTURE_PROFILE_ID,
      paymentSource: nubankCreditCard,
      date: "2026-09-10",
      amount: M.fromReais(300),
      direction: "DEBIT",
      rawDescription: "LOJA TESTE",
      normalizedDescription: "LOJA TESTE",
      status: "POSTED",
      certainty: "ACTUAL",
      financialEffect: "CONSUMPTION",
      category: "Compras",
      origin: "IMPORTED",
      createdAt: "2026-09-10T00:00:00.000Z",
      updatedAt: "2026-09-10T00:00:00.000Z",
    };
    const billPayment: FinancialTransaction = {
      ...purchase,
      id: createId("transaction"),
      paymentSource: checkingAccount,
      date: "2026-09-12",
      direction: "CREDIT",
      rawDescription: "PAGAMENTO FATURA CARTAO VISA",
      normalizedDescription: "PAGAMENTO FATURA CARTAO VISA",
      financialEffect: "CARD_PAYMENT",
      category: null,
    };
    const input = minimalInput({ asOfDate: "2026-09-15", transactions: [purchase, billPayment] });
    const snapshot = buildFinancialSnapshot(input);
    // Only the original purchase counts — the bill payment contributes nothing.
    expect(snapshot.commitments.actualSpending.cents).toBe(M.fromReais(300).cents);
  });

  it("(test 10) reports PLAN_BASED and a null liquidity total when no FinancialPosition is supplied at all", () => {
    const snapshot = buildFinancialSnapshot(initialUserSnapshotInput);
    expect(snapshot.liquidity.basis).toBe("PLAN_BASED");
    expect(snapshot.liquidity.liquidityAwareSafeToSpend).toBeNull();
    expect(snapshot.liquidity.confidence).toBe("UNKNOWN");
    expect(snapshot.liquidity.planSafeToSpend.cents).toBe(217_111);
    expect(snapshot.liquidity.recommendedTotal.cents).toBe(217_111);
  });

  it("(test 11) financial-profile_9_mu1xbipy regression — empty declared Income no longer forces a nonsensical negative Home value when real liquidity exists", () => {
    // Recreates the exact real-world scenario found in staging: a checking
    // account with a real salary already received, a credit card with a
    // real outstanding balance, and NO declared Income/FixedExpense/
    // VariableBudget/Event at all — which previously produced -R$788.20
    // purely because the declared-income table was empty.
    const salary: FinancialTransaction = {
      id: createId("transaction"),
      financialProfileId: FIXTURE_PROFILE_ID,
      paymentSource: checkingAccount,
      date: "2026-09-05",
      amount: M.fromReais(8_500),
      direction: "CREDIT",
      rawDescription: "SALARIO EMPRESA XYZ LTDA",
      normalizedDescription: "SALARIO EMPRESA XYZ LTDA",
      status: "POSTED",
      certainty: "ACTUAL",
      financialEffect: "INCOME",
      category: null,
      origin: "IMPORTED",
      createdAt: "2026-09-05T00:00:00.000Z",
      updatedAt: "2026-09-05T00:00:00.000Z",
    };
    const condo: FinancialTransaction = {
      ...salary,
      id: createId("transaction"),
      date: "2026-09-05",
      amount: M.fromReais(800),
      direction: "DEBIT",
      rawDescription: "CONDOMINIO EDIFICIO SOLAR",
      normalizedDescription: "CONDOMINIO EDIFICIO SOLAR",
      financialEffect: "CONSUMPTION",
      category: "Moradia",
    };
    const position: FinancialPosition = {
      id: createId("financial-position"),
      financialProfileId: FIXTURE_PROFILE_ID,
      asOf: "2026-09-15",
      cashBalance: actual(M.fromReais(35_995.75)),
      cardOutstandingBalance: actual(M.fromReais(961.95)),
      otherLiabilities: unknownAmount(),
      reservedBalance: unknownAmount(),
      automaticallyInvestedBalance: unknownAmount(),
      source: "pluggy",
      coverage: "PARTIAL",
    };
    const input = minimalInput({
      asOfDate: "2026-09-15",
      transactions: [salary, condo],
      position,
    });
    const snapshot = buildFinancialSnapshot(input);

    // The old bug, still reproducible in the untouched plan-based figure:
    expect(snapshot.safeToSpend.total.cents).toBeLessThan(0);
    // The fix: Home's recommended figure is the healthy liquidity-aware one.
    expect(snapshot.liquidity.basis).toBe("LIQUIDITY_AWARE");
    expect(snapshot.liquidity.recommendedTotal.cents).toBe(M.fromReais(35_033.8).cents);
    expect(M.isPositive(snapshot.liquidity.recommendedTotal)).toBe(true);
    // "Já comprometido" is exactly the card's outstanding balance — no
    // declared fixed expenses/events exist for this profile.
    expect(snapshot.recommendedCommittedTotal.cents).toBe(M.fromReais(961.95).cents);
  });
});

describe("buildFinancialSnapshot — 'Já comprometido' canonical figure (DEC-130)", () => {
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
      goal: { id: createId("financial-goal"), label: "No goal set yet", monthlySavingsTarget: M.ZERO },
      protectedPreferences: [],
      ...overrides,
    };
  }

  it("(test 9) an outstanding credit-card balance alone makes 'Já comprometido' non-zero", () => {
    const position: FinancialPosition = {
      id: createId("financial-position"),
      financialProfileId: FIXTURE_PROFILE_ID,
      asOf: "2026-09-15",
      cashBalance: actual(M.fromReais(35_995.75)),
      cardOutstandingBalance: actual(M.fromReais(961.95)),
      otherLiabilities: unknownAmount(),
      reservedBalance: unknownAmount(),
      automaticallyInvestedBalance: unknownAmount(),
      source: "pluggy",
      coverage: "PARTIAL",
    };
    const snapshot = buildFinancialSnapshot(minimalInput({ position }));
    expect(snapshot.recommendedCommittedTotal.cents).toBe(M.fromReais(961.95).cents);
  });

  it("(test 10) once a card bill is fully paid (provider-reported balance drops to zero), it no longer contributes to 'Já comprometido'", () => {
    const stillOwing: FinancialPosition = {
      id: createId("financial-position"),
      financialProfileId: FIXTURE_PROFILE_ID,
      asOf: "2026-09-15",
      cashBalance: actual(M.fromReais(10_000)),
      cardOutstandingBalance: actual(M.fromReais(961.95)),
      otherLiabilities: unknownAmount(),
      reservedBalance: unknownAmount(),
      automaticallyInvestedBalance: unknownAmount(),
      source: "pluggy",
      coverage: "PARTIAL",
    };
    const before = buildFinancialSnapshot(minimalInput({ position: stillOwing }));
    expect(before.recommendedCommittedTotal.cents).toBe(M.fromReais(961.95).cents);

    // The bill gets paid — the PROVIDER's own real-time balance simply
    // drops to zero (never a separately-tracked "card bill" commitment to
    // manually clear).
    const paidOff: FinancialPosition = { ...stillOwing, cardOutstandingBalance: actual(M.ZERO) };
    const after = buildFinancialSnapshot(minimalInput({ position: paidOff }));
    expect(after.recommendedCommittedTotal.cents).toBe(0);
  });

  it("excludes variable budgets, protected savings target, and future income from 'Já comprometido', while still reducing overall Safe-to-Spend", () => {
    const position: FinancialPosition = {
      id: createId("financial-position"),
      financialProfileId: FIXTURE_PROFILE_ID,
      asOf: "2026-09-15",
      cashBalance: actual(M.fromReais(10_000)),
      cardOutstandingBalance: actual(M.fromReais(500)),
      otherLiabilities: unknownAmount(),
      reservedBalance: unknownAmount(),
      automaticallyInvestedBalance: unknownAmount(),
      source: "pluggy",
      coverage: "PARTIAL",
    };
    const snapshot = buildFinancialSnapshot(
      minimalInput({
        variableBudgets: [
          {
            id: createId("variable-budget"),
            label: "Food",
            category: "Food",
            targetAmount: M.fromReais(300),
            certainty: "ACTUAL",
          },
        ],
        goal: { id: createId("financial-goal"), label: "Savings", monthlySavingsTarget: M.fromReais(200) },
        position,
      }),
    );
    // "Já comprometido" is only the card (500) — neither the variable
    // budget target (300) nor the protected savings goal (200) count as a
    // "commitment" by the Founder's own definition.
    expect(snapshot.recommendedCommittedTotal.cents).toBe(M.fromReais(500).cents);
    // But the overall Safe-to-Spend total still correctly reflects both.
    expect(snapshot.liquidity.recommendedTotal.cents).toBe(M.fromReais(9_000).cents); // 10000-500-300-200
  });

  it("falls back to the unchanged plan-based fixed commitments when there is no reliable liquidity", () => {
    const snapshot = buildFinancialSnapshot(initialUserSnapshotInput);
    expect(snapshot.liquidity.basis).toBe("PLAN_BASED");
    expect(snapshot.recommendedCommittedTotal.cents).toBe(snapshot.commitments.fixed.cents);
    expect(snapshot.recommendedCommittedTotal.cents).toBe(598_000);
  });
});
