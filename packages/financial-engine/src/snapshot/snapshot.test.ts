import { describe, expect, it } from "vitest";
import * as M from "../money/index";
import { buildFinancialSnapshot, type FinancialSnapshotInput } from "./snapshot";
import {
  initialUserSnapshotInput,
  motherSupport,
  fixedExpenses,
  reconciliationLinks,
  oldCreditCardDebtPlan,
} from "../fixtures/initial-user";

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
