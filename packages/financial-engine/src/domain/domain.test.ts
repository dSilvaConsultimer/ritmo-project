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
    const dinner = transactions[0]!;
    expect(dinner.paymentSource.label).toBe("Nubank");
    expect(dinner.paymentSource.type).toBe("CREDIT_CARD");
    expect(dinner.category).toBe("Food");
    // The category must describe what the money was for, not how it was paid.
    expect(dinner.category.toLowerCase()).not.toContain("credit card");
    expect(dinner.category.toLowerCase()).not.toContain("nubank");
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
      title: "Cancel subscription X",
      estimatedMonthlySavings: M.fromReais(39.9),
      status: "PENDING",
      createdAt: "2026-09-01",
    };

    const accepted: Recommendation = { ...base, status: "ACCEPTED", decidedAt: "2026-09-02" };
    const verified: Recommendation = {
      ...accepted,
      status: "VERIFIED",
      verification: { verifiedAt: "2026-10-01", actualMonthlySavings: M.fromReais(39.9) },
    };
    const rejected: Recommendation = {
      ...base,
      status: "REJECTED",
      rejectionReason: "User wants to keep it",
    };

    expect(accepted.status).toBe("ACCEPTED");
    expect(verified.verification?.actualMonthlySavings.cents).toBe(3_990);
    expect(rejected.rejectionReason).toBeDefined();
  });
});
