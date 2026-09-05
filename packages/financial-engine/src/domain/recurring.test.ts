import { describe, expect, it } from "vitest";
import { createId } from "@money-copilot/shared";
import * as M from "../money/index";
import type { FinancialTransaction, PaymentSource } from "./transaction";
import { detectRecurringCandidates, type RecurringDecision } from "./recurring";

const nubank: PaymentSource = { id: createId("payment-source"), label: "Nubank", type: "CREDIT_CARD" };

function tx(merchant: string, amountReais: number, date: string): FinancialTransaction {
  return {
    id: createId("transaction"),
    financialProfileId: createId("financial-profile"),
    paymentSource: nubank,
    date,
    amount: M.fromReais(amountReais),
    direction: "DEBIT",
    rawDescription: merchant,
    normalizedDescription: merchant,
    rawMerchant: merchant,
    normalizedMerchant: merchant,
    status: "POSTED",
    certainty: "ACTUAL",
    financialEffect: "CONSUMPTION",
    category: "Subscriptions",
    origin: "MANUAL",
    createdAt: date,
    updatedAt: date,
  };
}

describe("detectRecurringCandidates", () => {
  it("flags a HIGH-confidence candidate for a merchant billed similarly ~monthly, 3+ times", () => {
    const transactions = [
      tx("NETFLIX", 39.9, "2026-07-05"),
      tx("NETFLIX", 39.9, "2026-08-04"),
      tx("NETFLIX", 39.9, "2026-09-05"),
    ];
    const candidates = detectRecurringCandidates(transactions);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.normalizedMerchant).toBe("NETFLIX");
    expect(candidates[0]?.confidence).toBe("HIGH");
    expect(candidates[0]?.status).toBe("CANDIDATE");
    expect(candidates[0]?.evidence.occurrences).toBe(3);
  });

  it("does not flag a single occurrence", () => {
    const transactions = [tx("NETFLIX", 39.9, "2026-09-05")];
    expect(detectRecurringCandidates(transactions)).toHaveLength(0);
  });

  it("does not flag inconsistent amounts as a confident pattern", () => {
    const transactions = [
      tx("RANDOM SHOP", 10, "2026-07-01"),
      tx("RANDOM SHOP", 400, "2026-08-15"),
    ];
    expect(detectRecurringCandidates(transactions)).toHaveLength(0);
  });

  it("suppresses a candidate previously REJECTED for the same evidence", () => {
    const transactions = [
      tx("NETFLIX", 39.9, "2026-07-05"),
      tx("NETFLIX", 39.9, "2026-08-04"),
      tx("NETFLIX", 39.9, "2026-09-05"),
    ];
    const first = detectRecurringCandidates(transactions);
    const decisions: RecurringDecision[] = [
      { evidenceKey: first[0]!.evidenceKey, status: "REJECTED" },
    ];
    const second = detectRecurringCandidates(transactions, decisions);
    expect(second).toHaveLength(0);
  });

  it("may resurface once the evidence materially changes (e.g. a price change)", () => {
    const original = [
      tx("NETFLIX", 39.9, "2026-07-05"),
      tx("NETFLIX", 39.9, "2026-08-04"),
      tx("NETFLIX", 39.9, "2026-09-05"),
    ];
    const rejectedKey = detectRecurringCandidates(original)[0]!.evidenceKey;
    const decisions: RecurringDecision[] = [{ evidenceKey: rejectedKey, status: "REJECTED" }];

    // Same merchant, but the OLD price's evidence is rejected — it must stay suppressed.
    expect(detectRecurringCandidates(original, decisions)).toHaveLength(0);

    // A price change (39.90 -> 55.90) is a materially different evidence
    // group (different amount bucket) and is free to resurface even though
    // the old price's candidate was rejected.
    const withPriceChange = [
      ...original,
      tx("NETFLIX", 55.9, "2026-10-05"),
      tx("NETFLIX", 55.9, "2026-11-09"),
    ];
    const afterPriceChange = detectRecurringCandidates(withPriceChange, decisions);
    expect(afterPriceChange.some((c) => c.evidenceKey !== rejectedKey)).toBe(true);
  });
});
