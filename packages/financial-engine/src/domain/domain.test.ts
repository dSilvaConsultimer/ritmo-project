import { describe, expect, it } from "vitest";
import { createId } from "@money-copilot/shared";
import * as M from "../money/index";
import { transactions, motherSupport, motherSupportPreference } from "../fixtures/initial-user";
import { protectsExpense } from "./preference";
import { breakdownEvent } from "./event";
import type { FinancialEvent } from "./event";
import type { Recommendation } from "./recommendation";

describe("payment source vs. expense category", () => {
  it("models the credit card as a payment source, never as an expense category", () => {
    const dinner = transactions.find((t) => t.normalizedMerchant === "IFOOD")!;
    expect(dinner.paymentSource.label).toBe("Nubank");
    expect(dinner.paymentSource.type).toBe("CREDIT_CARD");
    expect(dinner.category).toBe("Food");
    // The category must describe what the money was for, not how it was paid.
    expect(dinner.category!.toLowerCase()).not.toContain("credit card");
    expect(dinner.category!.toLowerCase()).not.toContain("nubank");
  });
});

describe("protected preferences", () => {
  it("can represent a protected expense for future recommendation filtering", () => {
    expect(protectsExpense(motherSupportPreference, motherSupport)).toBe(true);
  });

  it("does not protect an unrelated expense", () => {
    const unrelated = { ...motherSupport, id: createId("fixed-expense"), category: "Entertainment" };
    expect(protectsExpense(motherSupportPreference, unrelated)).toBe(false);
  });
});

describe("financial events", () => {
  it("never reserves an already-paid line item as a future commitment", () => {
    const event: FinancialEvent = {
      id: createId("financial-event"),
      label: "Test Event",
      startDate: "2026-01-01",
      endDate: "2026-01-01",
      lineItems: [
        {
          id: createId("event-line-item"),
          label: "Already paid",
          amount: M.fromCents(1_000),
          certainty: "ACTUAL",
          status: "ALREADY_PAID",
        },
      ],
    };
    const breakdown = breakdownEvent(event);
    expect(breakdown.alreadyPaid.cents).toBe(1_000);
    expect(breakdown.futureConfirmed.cents).toBe(0);
    expect(breakdown.futureEstimated.cents).toBe(0);
  });

  it("surfaces unknown planned line items by label instead of treating them as zero", () => {
    const event: FinancialEvent = {
      id: createId("financial-event"),
      label: "Mystery Trip",
      startDate: "2026-01-01",
      endDate: "2026-01-02",
      lineItems: [
        {
          id: createId("event-line-item"),
          label: "Budget",
          amount: null,
          certainty: "UNKNOWN",
          status: "PLANNED",
        },
      ],
    };
    const breakdown = breakdownEvent(event);
    expect(breakdown.unknownLabels).toEqual(["Mystery Trip: Budget"]);
    expect(breakdown.futureConfirmed.cents).toBe(0);
    expect(breakdown.futureEstimated.cents).toBe(0);
  });
});

describe("recommendation model", () => {
  it("supports the full lifecycle of statuses", () => {
    const base: Recommendation = {
      id: createId("recommendation"),
      financialProfileId: createId("financial-profile"),
      type: "CANCEL_RECURRING_COST",
      identityKey: "profile-1:CANCEL_RECURRING_COST:SUBSCRIPTION X:MONTHLY:4000:any",
      title: "Cancel subscription X",
      evidence: {
        normalizedMerchant: "SUBSCRIPTION X",
        category: "Entertainment",
        cadence: "MONTHLY",
        observedAmount: M.fromReais(39.9),
        monthlyEquivalentAmount: M.fromReais(39.9),
        occurrences: 3,
        transactionIds: [],
        confidence: "HIGH",
      },
      projectedMonthlyImpact: M.fromReais(39.9),
      projectedAnnualImpact: M.fromReais(478.8),
      status: "PENDING",
      createdAt: "2026-09-01",
      updatedAt: "2026-09-01",
      decisionHistory: [],
    };

    const accepted: Recommendation = {
      ...base,
      status: "ACCEPTED",
      updatedAt: "2026-09-02",
      decisionHistory: [{ status: "ACCEPTED", at: "2026-09-02" }],
    };
    const verified: Recommendation = {
      ...accepted,
      status: "VERIFIED",
      updatedAt: "2026-10-20",
      lastVerificationAssessment: "CONFIRMED_SUCCESS",
      lastVerificationCheckedAt: "2026-10-20",
      decisionHistory: [...accepted.decisionHistory, { status: "VERIFIED", at: "2026-10-20" }],
    };
    const rejected: Recommendation = {
      ...base,
      status: "REJECTED",
      rejectionReason: "User wants to keep it",
      decisionHistory: [{ status: "REJECTED", at: "2026-09-02", note: "User wants to keep it" }],
    };

    expect(accepted.status).toBe("ACCEPTED");
    expect(verified.lastVerificationAssessment).toBe("CONFIRMED_SUCCESS");
    expect(verified.decisionHistory).toHaveLength(2);
    expect(rejected.rejectionReason).toBeDefined();
  });
});
