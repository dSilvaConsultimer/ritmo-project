import { describe, expect, it } from "vitest";
import { createId } from "@money-copilot/shared";
import * as M from "../money/index";
import type { InstallmentPlan } from "./installment";
import { remainingInstallments, summarizeFutureInstallmentCommitments } from "./installment";

function plan(overrides: Partial<InstallmentPlan> = {}): InstallmentPlan {
  return {
    id: createId("installment-plan"),
    financialProfileId: createId("financial-profile"),
    description: "Test plan",
    totalOriginalAmount: null,
    installmentAmount: M.fromReais(200),
    installmentNumber: null,
    totalInstallments: null,
    firstDueDate: null,
    certainty: "CONFIRMED",
    status: "ACTIVE",
    ...overrides,
  };
}

describe("remainingInstallments", () => {
  it("represents 3/10 at BRL 200 correctly: 7 remain after the current one", () => {
    const p = plan({ installmentNumber: 3, totalInstallments: 10 });
    const result = remainingInstallments(p);
    expect(result.remainingInstallments).toBe(7);
    expect(result.remainingAmount?.cents).toBe(140_000); // 7 * 20000
  });

  it("never guesses when the schedule is incomplete", () => {
    const p = plan({ installmentNumber: null, totalInstallments: null });
    const result = remainingInstallments(p);
    expect(result.remainingInstallments).toBeNull();
    expect(result.remainingAmount).toBeNull();
  });

  it("does not go negative once the plan is fully paid", () => {
    const p = plan({ installmentNumber: 10, totalInstallments: 10 });
    const result = remainingInstallments(p);
    expect(result.remainingInstallments).toBe(0);
    expect(result.remainingAmount?.cents).toBe(0);
  });
});

describe("summarizeFutureInstallmentCommitments", () => {
  it("computes current-period, 30-day and 90-day commitments for a fully-known plan", () => {
    const p = plan({ installmentNumber: 3, totalInstallments: 10, installmentAmount: M.fromReais(200) });
    const summary = summarizeFutureInstallmentCommitments([p]);
    expect(summary.currentPeriodAmount.cents).toBe(20_000);
    expect(summary.next30DaysCommitment.cents).toBe(20_000); // 1 installment
    expect(summary.next90DaysCommitment.cents).toBe(60_000); // min(3, 8 remaining-from-now) = 3
    expect(summary.hasIncompleteData).toBe(false);
  });

  it("caps the 90-day projection at what's actually left when few installments remain", () => {
    // 9/10: only 2 installments remain from now (this one + 1 more).
    const p = plan({ installmentNumber: 9, totalInstallments: 10, installmentAmount: M.fromReais(200) });
    const summary = summarizeFutureInstallmentCommitments([p]);
    expect(summary.next90DaysCommitment.cents).toBe(40_000); // 2 * 20000, not 3 * 20000
  });

  it("assumes an incomplete-schedule plan continues, but flags it as incomplete", () => {
    const p = plan({ installmentNumber: null, totalInstallments: null, installmentAmount: M.fromReais(1_400) });
    const summary = summarizeFutureInstallmentCommitments([p]);
    expect(summary.hasIncompleteData).toBe(true);
    expect(summary.incompletePlanDescriptions).toContain("Test plan");
    expect(summary.next30DaysCommitment.cents).toBe(140_000);
    expect(summary.next90DaysCommitment.cents).toBe(420_000);
  });

  it("ignores COMPLETED and CANCELLED plans entirely", () => {
    const completed = plan({ status: "COMPLETED", installmentAmount: M.fromReais(500) });
    const cancelled = plan({ status: "CANCELLED", installmentAmount: M.fromReais(500) });
    const summary = summarizeFutureInstallmentCommitments([completed, cancelled]);
    expect(summary.currentPeriodAmount.cents).toBe(0);
    expect(summary.next30DaysCommitment.cents).toBe(0);
    expect(summary.next90DaysCommitment.cents).toBe(0);
  });

  it("a BRL 2,400 purchase in 12x is not merely BRL 200 this month — future commitment is preserved", () => {
    const p = plan({
      description: "New purchase",
      totalOriginalAmount: M.fromReais(2_400),
      installmentAmount: M.fromReais(200),
      installmentNumber: 1,
      totalInstallments: 12,
    });
    const { remainingAmount } = remainingInstallments(p);
    // 11 installments still remain beyond this month = BRL 2,200 of future commitment.
    expect(remainingAmount?.cents).toBe(220_000);
  });
});
