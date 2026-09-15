import { describe, expect, it } from "vitest";
import { createId } from "@money-copilot/shared";
import * as M from "../money/index";
import type { InstallmentPlan } from "./installment";
import {
  matchInstallmentPlans,
  remainingInstallments,
  summarizeFutureInstallmentCommitments,
  isInstallmentCoveredByCardBalance,
} from "./installment";

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

describe("matchInstallmentPlans — old debt reconciliation (NEVER auto-replaces the manual estimate)", () => {
  const cardId = createId("payment-source");

  const manualEstimate = plan({
    description: "Existing credit card bill installment",
    installmentAmount: M.fromReais(1_400),
    certainty: "ESTIMATED",
    installmentNumber: null,
    totalInstallments: null,
  });

  it("is a HIGH-confidence CANDIDATE (never CONFIRMED) when amounts are close and the payment source matches", () => {
    const providerPlan = plan({
      description: "Provider-derived installment",
      installmentAmount: M.fromReais(1_420),
      certainty: "ACTUAL",
      installmentNumber: 3,
      totalInstallments: 10,
      paymentSourceId: cardId,
    });
    const withPaymentSource = { ...manualEstimate, paymentSourceId: cardId };

    const match = matchInstallmentPlans(withPaymentSource, providerPlan, "2026-09-05");
    expect(match?.confidence).toBe("HIGH");
    // Even a HIGH-confidence match is only ever a candidate for human review.
    expect(match?.status).toBe("CANDIDATE");
  });

  it("is only MEDIUM confidence when amounts are in the same ballpark but no shared payment source is known", () => {
    const providerPlan = plan({
      installmentAmount: M.fromReais(1_500),
      certainty: "ACTUAL",
      installmentNumber: 1,
      totalInstallments: 6,
    });

    const match = matchInstallmentPlans(manualEstimate, providerPlan, "2026-09-05");
    expect(match?.confidence).toBe("MEDIUM");
    expect(match?.status).toBe("CANDIDATE");
  });

  it("finds no match when the amounts are too far apart to be plausibly the same debt", () => {
    const unrelatedPlan = plan({
      installmentAmount: M.fromReais(50),
      certainty: "ACTUAL",
      installmentNumber: 1,
      totalInstallments: 3,
    });

    expect(matchInstallmentPlans(manualEstimate, unrelatedPlan, "2026-09-05")).toBeNull();
  });
});

describe("isInstallmentCoveredByCardBalance (DEC-130 correction)", () => {
  const cardId = createId("payment-source");
  const otherCardId = createId("payment-source");

  it("(test A) is covered when the plan's payment source is a known card and that card's balance is known", () => {
    const p = plan({ paymentSourceId: cardId });
    expect(isInstallmentCoveredByCardBalance(p, new Set([cardId]), true)).toBe(true);
  });

  it("(test B) is NOT covered when the plan has no payment source at all", () => {
    const p = plan({});
    expect(isInstallmentCoveredByCardBalance(p, new Set([cardId]), true)).toBe(false);
  });

  it("(test B, variant) is NOT covered when the plan's payment source is not among the known card ids at all", () => {
    const p = plan({ paymentSourceId: otherCardId });
    expect(isInstallmentCoveredByCardBalance(p, new Set([cardId]), true)).toBe(false);
  });

  it("(test D) is NOT covered when the card's own balance is unknown, even if tied to a known card — stays an independent obligation", () => {
    const p = plan({ paymentSourceId: cardId });
    expect(isInstallmentCoveredByCardBalance(p, new Set([cardId]), false)).toBe(false);
  });

  it("is covered even when the card balance is exactly zero (bill fully paid) — never reappears as a separate obligation", () => {
    const p = plan({ paymentSourceId: cardId });
    // cardBalanceKnown=true regardless of the amount being zero or positive —
    // the caller is responsible for passing `true` only when the balance's
    // certainty is known, irrespective of its numeric value.
    expect(isInstallmentCoveredByCardBalance(p, new Set([cardId]), true)).toBe(true);
  });
});
