import { createId } from "@money-copilot/shared";
import { describe, expect, it } from "vitest";
import * as M from "../money/index";
import type { FinancialTransaction, PaymentSource } from "../domain/transaction";
import { buildFinancialSnapshot } from "../snapshot/snapshot";
import { initialUserSnapshotInput } from "../fixtures/initial-user";
import { replanAfterExpense } from "./replan";

// safeToSpend.total = 217_111 cents; protectedSavings = 200_000 cents.

const manualPaymentSource: PaymentSource = {
  id: createId("payment-source"),
  label: "Cash",
  type: "CASH",
};

function snapshotAfterSpending(amountCents: number) {
  const manualTransaction: FinancialTransaction = {
    id: createId("transaction"),
    financialProfileId: initialUserSnapshotInput.transactions[0]!.financialProfileId,
    paymentSource: manualPaymentSource,
    date: "2026-09-05",
    amount: M.fromCents(amountCents),
    direction: "DEBIT",
    rawDescription: "Restaurant X",
    normalizedDescription: "Restaurant X",
    status: "POSTED",
    certainty: "ACTUAL",
    financialEffect: "CONSUMPTION",
    category: "Date night",
    origin: "MANUAL",
    createdAt: "2026-09-05T00:00:00.000Z",
    updatedAt: "2026-09-05T00:00:00.000Z",
  };

  return buildFinancialSnapshot({
    ...initialUserSnapshotInput,
    transactions: [...initialUserSnapshotInput.transactions, manualTransaction],
  });
}

describe("replanAfterExpense", () => {
  it("recalculates Safe-to-Spend and projected savings from the rebuilt snapshot, not from prose", () => {
    const snapshotAfter = snapshotAfterSpending(500_000);
    const result = replanAfterExpense({
      previousTarget: M.fromCents(400_00),
      actualExpenseAmount: M.fromCents(500_000),
      snapshotAfter,
    });

    expect(result.newSafeToSpend.cents).toBe(snapshotAfter.safeToSpend.total.cents);
    expect(result.newProjectedSavings.cents).toBe(snapshotAfter.projectedSavings.cents);
  });

  it("exposes compensationRequired when projected savings fall below the target", () => {
    const snapshotAfter = snapshotAfterSpending(500_000);
    const result = replanAfterExpense({
      previousTarget: M.fromCents(400_00),
      actualExpenseAmount: M.fromCents(500_000),
      snapshotAfter,
    });

    const expectedGap = M.floorAtZero(
      M.subtract(snapshotAfter.protectedSavings, snapshotAfter.projectedSavings),
    ).cents;
    expect(result.goalGap.cents).toBe(expectedGap);
    expect(result.compensationRequired.cents).toBe(expectedGap);
    expect(expectedGap).toBeGreaterThan(0);
  });

  it("warns when the actual expense exceeded the previous recommendation, without judging the user", () => {
    const snapshotAfter = snapshotAfterSpending(500_000);
    const result = replanAfterExpense({
      previousTarget: M.fromCents(400_00),
      actualExpenseAmount: M.fromCents(500_000),
      snapshotAfter,
    });

    expect(result.warnings.some((w) => w.includes("exceeded the previous recommendation"))).toBe(true);
  });

  it("does not warn about exceeding the recommendation when the actual expense stayed within it", () => {
    const snapshotAfter = snapshotAfterSpending(50_00);
    const result = replanAfterExpense({
      previousTarget: M.fromCents(400_00),
      actualExpenseAmount: M.fromCents(50_00),
      snapshotAfter,
    });

    expect(result.warnings.some((w) => w.includes("exceeded the previous recommendation"))).toBe(false);
    expect(result.compensationRequired.cents).toBe(0);
  });

  it("never invents cost-cutting suggestions — only exposes deterministic facts", () => {
    const snapshotAfter = snapshotAfterSpending(500_000);
    const result = replanAfterExpense({
      previousTarget: M.fromCents(400_00),
      actualExpenseAmount: M.fromCents(500_000),
      snapshotAfter,
    });

    const forbidden = ["cancel", "netflix", "sell your car", "stop going"];
    const allText = result.warnings.join(" ").toLowerCase();
    for (const phrase of forbidden) {
      expect(allText).not.toContain(phrase);
    }
  });
});
