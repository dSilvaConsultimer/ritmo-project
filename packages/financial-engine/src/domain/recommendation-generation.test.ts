import { describe, expect, it } from "vitest";
import { createId } from "@money-copilot/shared";
import * as M from "../money/index";
import { fixedExpenses, motherSupport, motherSupportPreference } from "../fixtures/initial-user";
import { fixtureProfile } from "../fixtures/profile";
import type { FinancialTransaction } from "./transaction";
import type { PaymentSource } from "./transaction";
import { generateRecommendationCandidates } from "./recommendation-generation";
import { DEFAULT_RECOMMENDATION_POLICY } from "./recommendation-policy";

/**
 * Sprint 5 (DEC-058/059) — permanent fixture/acceptance tests for
 * deterministic recommendation candidate generation. See
 * docs/RECOMMENDATIONS.md, "Candidate generation," for the policy these
 * assert; letters reference the Sprint 5 brief's acceptance-scenario list.
 */

const paymentSource: PaymentSource = {
  id: createId("payment-source"),
  label: "Checking",
  type: "DEBIT",
};

function tx(overrides: Partial<FinancialTransaction> & { date: string; amountCents: number }): FinancialTransaction {
  return {
    id: createId("transaction"),
    financialProfileId: fixtureProfile.id,
    paymentSource,
    date: overrides.date,
    amount: M.fromCents(overrides.amountCents),
    direction: "DEBIT",
    rawDescription: overrides.rawDescription ?? "NETFLIX.COM",
    normalizedDescription: overrides.normalizedDescription ?? "NETFLIX.COM",
    normalizedMerchant: overrides.normalizedMerchant ?? "NETFLIX",
    status: "POSTED",
    certainty: "ACTUAL",
    financialEffect: overrides.financialEffect ?? "CONSUMPTION",
    category: overrides.category === undefined ? "Entertainment" : overrides.category,
    origin: "IMPORTED",
    createdAt: `${overrides.date}T00:00:00.000Z`,
    updatedAt: `${overrides.date}T00:00:00.000Z`,
  };
}

/** Three monthly Netflix-shaped charges — HIGH confidence per `detectRecurringCandidates`. */
function netflixCharges(): FinancialTransaction[] {
  return [
    tx({ date: "2026-07-05", amountCents: 3990 }),
    tx({ date: "2026-08-05", amountCents: 3990 }),
    tx({ date: "2026-09-05", amountCents: 3990 }),
  ];
}

describe("generateRecommendationCandidates", () => {
  it("(A) a high-confidence recurring discretionary subscription generates exactly one candidate", () => {
    const candidates = generateRecommendationCandidates({
      financialProfileId: fixtureProfile.id,
      transactions: netflixCharges(),
      protectedPreferences: [],
      fixedExpenses: [],
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.type).toBe("CANCEL_RECURRING_COST");
    expect(candidates[0]!.evidence.normalizedMerchant).toBe("NETFLIX");
    expect(candidates[0]!.projectedMonthlyImpact.cents).toBe(3990);
    expect(candidates[0]!.projectedAnnualImpact.cents).toBe(3990 * 12);
  });

  it("(B) repeated generation over unchanged data produces the identical identityKey (idempotent by construction)", () => {
    const transactions = netflixCharges();
    const first = generateRecommendationCandidates({
      financialProfileId: fixtureProfile.id,
      transactions,
      protectedPreferences: [],
      fixedExpenses: [],
    });
    const second = generateRecommendationCandidates({
      financialProfileId: fixtureProfile.id,
      transactions,
      protectedPreferences: [],
      fixedExpenses: [],
    });

    expect(second[0]!.identityKey).toBe(first[0]!.identityKey);
  });

  it("(C) a protected preference (the family-support fixture) generates zero cost-cutting recommendations", () => {
    // A recurring transfer to the mother that WOULD otherwise pass the
    // financial-effect filter (CONSUMPTION) and look exactly like a
    // recurring discretionary cost, categorized under the same category as
    // the protected `motherSupport` FixedExpense.
    const transactions = [
      tx({ date: "2026-07-01", amountCents: 100_000, normalizedMerchant: "PIX MAE", category: motherSupport.category }),
      tx({ date: "2026-08-01", amountCents: 100_000, normalizedMerchant: "PIX MAE", category: motherSupport.category }),
      tx({ date: "2026-09-01", amountCents: 100_000, normalizedMerchant: "PIX MAE", category: motherSupport.category }),
    ];

    const candidates = generateRecommendationCandidates({
      financialProfileId: fixtureProfile.id,
      transactions,
      protectedPreferences: [motherSupportPreference],
      fixedExpenses,
    });

    expect(candidates).toHaveLength(0);
  });

  it("(D) TRANSFER does not create a recommendation", () => {
    const transactions = netflixCharges().map((t) => ({ ...t, financialEffect: "TRANSFER" as const }));
    expect(
      generateRecommendationCandidates({
        financialProfileId: fixtureProfile.id,
        transactions,
        protectedPreferences: [],
        fixedExpenses: [],
      }),
    ).toHaveLength(0);
  });

  it("(E) CARD_PAYMENT does not create a recommendation", () => {
    const transactions = netflixCharges().map((t) => ({ ...t, financialEffect: "CARD_PAYMENT" as const }));
    expect(
      generateRecommendationCandidates({
        financialProfileId: fixtureProfile.id,
        transactions,
        protectedPreferences: [],
        fixedExpenses: [],
      }),
    ).toHaveLength(0);
  });

  it("(F) DEBT_PAYMENT does not create a recommendation", () => {
    const transactions = netflixCharges().map((t) => ({ ...t, financialEffect: "DEBT_PAYMENT" as const }));
    expect(
      generateRecommendationCandidates({
        financialProfileId: fixtureProfile.id,
        transactions,
        protectedPreferences: [],
        fixedExpenses: [],
      }),
    ).toHaveLength(0);
  });

  it("REFUND does not create a recommendation", () => {
    const transactions = netflixCharges().map((t) => ({ ...t, financialEffect: "REFUND" as const }));
    expect(
      generateRecommendationCandidates({
        financialProfileId: fixtureProfile.id,
        transactions,
        protectedPreferences: [],
        fixedExpenses: [],
      }),
    ).toHaveLength(0);
  });

  it("an uncategorized (ambiguous) recurring transaction does not create a recommendation", () => {
    const transactions = netflixCharges().map((t) => ({ ...t, category: null }));
    expect(
      generateRecommendationCandidates({
        financialProfileId: fixtureProfile.id,
        transactions,
        protectedPreferences: [],
        fixedExpenses: [],
      }),
    ).toHaveLength(0);
  });

  it("a default-excluded category (e.g. Utilities) does not create a recommendation even without an explicit ProtectedPreference", () => {
    expect(DEFAULT_RECOMMENDATION_POLICY.excludedCategories).toContain("Utilities");
    const transactions = netflixCharges().map((t) => ({ ...t, category: "Utilities" }));
    expect(
      generateRecommendationCandidates({
        financialProfileId: fixtureProfile.id,
        transactions,
        protectedPreferences: [],
        fixedExpenses: [],
      }),
    ).toHaveLength(0);
  });

  it("a LOW/MEDIUM-confidence recurring pattern becomes REVIEW_RECURRING_COST, never CANCEL", () => {
    // Only 2 occurrences with a monthly-shaped interval — MEDIUM confidence
    // per `detectRecurringCandidates` (3+ occurrences are required for HIGH).
    const transactions = [
      tx({ date: "2026-08-01", amountCents: 5000, normalizedMerchant: "SOME SERVICE" }),
      tx({ date: "2026-09-01", amountCents: 5000, normalizedMerchant: "SOME SERVICE" }),
    ];

    const candidates = generateRecommendationCandidates({
      financialProfileId: fixtureProfile.id,
      transactions,
      protectedPreferences: [],
      fixedExpenses: [],
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.type).toBe("REVIEW_RECURRING_COST");
  });

  it("handles a weekly cadence without multiplying it as if it were monthly", () => {
    const transactions = [
      tx({ date: "2026-08-01", amountCents: 1500, normalizedMerchant: "WEEKLY SNACK BOX" }),
      tx({ date: "2026-08-08", amountCents: 1500, normalizedMerchant: "WEEKLY SNACK BOX" }),
      tx({ date: "2026-08-15", amountCents: 1500, normalizedMerchant: "WEEKLY SNACK BOX" }),
      tx({ date: "2026-08-22", amountCents: 1500, normalizedMerchant: "WEEKLY SNACK BOX" }),
    ];

    const candidates = generateRecommendationCandidates({
      financialProfileId: fixtureProfile.id,
      transactions,
      protectedPreferences: [],
      fixedExpenses: [],
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.evidence.cadence).toBe("WEEKLY");
    // 15,00 * 52/12 = 65,00 — never 15,00 (raw) nor 15,00*30 (wrongly treated as daily/monthly).
    expect(candidates[0]!.projectedMonthlyImpact.cents).toBe(6500);
  });
});
