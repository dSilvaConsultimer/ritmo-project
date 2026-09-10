import { describe, expect, it } from "vitest";
import { createId } from "@money-copilot/shared";
import {
  buildFinancialSnapshot,
  compareLifestyles,
  currentLifestyleScenario,
  fixtureProfile,
  fromReais,
  getDailyGuidance,
  getSpendingEnvelope,
  independentLivingScenario,
  initialUserSnapshotInput,
  type Recommendation,
} from "@money-copilot/financial-engine";
import type { RecommendationsSummary } from "../queries";
import type { Alert } from "../alerts";
import { extractFinancialFacts } from "./facts";

/**
 * Permanent offline regression for a real bug the Sprint 4.5 live OpenAI
 * validation found (DEC-055): a live model correctly cited real,
 * deterministic monetary fields — `DailyGuidance.monthlySafeToSpendRemaining`,
 * `SpendingEnvelope.protectedSavingsStatus.target`, and multiple
 * `getLifestyleComparison`/`getFinancialSnapshot` fields — that had no fact
 * extractor at all, so `groundResponseText` flagged them as unsupported and
 * replaced an entirely correct answer with a generic fallback. This is
 * exactly the failure mode grounding exists to prevent for a hallucination —
 * these tests would have caught the coverage gap without any live API call.
 */
describe("extractFinancialFacts", () => {
  const snapshot = buildFinancialSnapshot(initialUserSnapshotInput);

  it("getFinancialSnapshot exposes the canonical Safe-to-Spend and usable income as facts", () => {
    const facts = extractFinancialFacts("getFinancialSnapshot", snapshot);
    expect(facts.map((f) => f.amountCents)).toContain(217_111);
    expect(facts.map((f) => f.amountCents)).toContain(snapshot.income.usable.cents);
    expect(facts.map((f) => f.amountCents)).toContain(snapshot.commitments.fixed.cents);
  });

  it("getDailyGuidance exposes the monthly Safe-to-Spend remaining, not just the daily figure", () => {
    const guidance = getDailyGuidance(snapshot);
    const facts = extractFinancialFacts("getDailyGuidance", guidance);
    expect(facts.map((f) => f.amountCents)).toContain(guidance.recommendedDiscretionarySpendToday.cents);
    expect(facts.map((f) => f.amountCents)).toContain(guidance.monthlySafeToSpendRemaining.cents);
  });

  it("getSpendingEnvelope exposes the protected savings target alongside the recommended/caution amounts", () => {
    const envelope = getSpendingEnvelope(snapshot);
    const facts = extractFinancialFacts("getSpendingEnvelope", envelope);
    expect(facts.map((f) => f.amountCents)).toContain(envelope.recommendedAmount.cents);
    expect(facts.map((f) => f.amountCents)).toContain(envelope.cautionAmount.cents);
    expect(facts.map((f) => f.amountCents)).toContain(envelope.protectedSavingsStatus.target.cents);
  });

  it("getLifestyleComparison exposes both scenarios' full snapshot figures plus both deltas", () => {
    const comparison = compareLifestyles(initialUserSnapshotInput, currentLifestyleScenario, independentLivingScenario);
    const facts = extractFinancialFacts("getLifestyleComparison", comparison);
    const amounts = facts.map((f) => f.amountCents);

    expect(amounts).toContain(comparison.current.safeToSpend.total.cents);
    expect(amounts).toContain(comparison.independent.safeToSpend.total.cents);
    expect(amounts).toContain(comparison.current.projectedSavings.cents);
    expect(amounts).toContain(comparison.independent.projectedSavings.cents);
    // Deltas are stored as absolute magnitude — prose expresses direction in words, not a sign.
    expect(amounts).toContain(Math.abs(comparison.safeToSpendDelta.cents));
    expect(amounts).toContain(Math.abs(comparison.projectedSavingsDelta.cents));
  });

  it("returns an empty array for a tool with no wired-up extractor, rather than guessing", () => {
    expect(extractFinancialFacts("someUnknownTool", {})).toEqual([]);
  });

  function buildRecommendation(overrides: Partial<Recommendation> = {}): Recommendation {
    return {
      id: createId("recommendation"),
      financialProfileId: fixtureProfile.id,
      type: "CANCEL_RECURRING_COST",
      identityKey: `${fixtureProfile.id}:CANCEL_RECURRING_COST:NETFLIX:MONTHLY:3990:any`,
      title: "Recurring subscription: NETFLIX",
      evidence: {
        normalizedMerchant: "NETFLIX",
        category: "Entertainment",
        cadence: "MONTHLY",
        observedAmount: fromReais(39.9),
        monthlyEquivalentAmount: fromReais(39.9),
        occurrences: 3,
        transactionIds: [],
        confidence: "HIGH",
      },
      projectedMonthlyImpact: fromReais(39.9),
      projectedAnnualImpact: fromReais(478.8),
      status: "PENDING",
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
      decisionHistory: [],
      ...overrides,
    };
  }

  it("(Sprint 5, DEC-062) getRecommendationDetails/acceptRecommendation/modifyRecommendation/rejectRecommendation all expose observed amount + monthly/annual impact", () => {
    const recommendation = buildRecommendation();
    for (const toolName of [
      "getRecommendationDetails",
      "acceptRecommendation",
      "modifyRecommendation",
      "rejectRecommendation",
    ]) {
      const facts = extractFinancialFacts(toolName, recommendation);
      const amounts = facts.map((f) => f.amountCents);
      expect(amounts).toContain(recommendation.evidence.observedAmount.cents);
      expect(amounts).toContain(recommendation.projectedMonthlyImpact.cents);
      expect(amounts).toContain(recommendation.projectedAnnualImpact.cents);
    }
  });

  it("(Sprint 5) a MODIFIED recommendation's user target amount is exposed as a fact", () => {
    const recommendation = buildRecommendation({
      type: "REDUCE_RECURRING_COST",
      status: "MODIFIED",
      userTargetAmount: fromReais(20),
      projectedMonthlyImpact: fromReais(19.9),
      projectedAnnualImpact: fromReais(238.8),
    });
    const facts = extractFinancialFacts("modifyRecommendation", recommendation);
    expect(facts.map((f) => f.amountCents)).toContain(2000);
  });

  it("(Sprint 5) getRecommendations exposes every recommendation plus the three aggregate figures", () => {
    const pendingRec = buildRecommendation();
    const verifiedRec = buildRecommendation({
      id: createId("recommendation"),
      status: "VERIFIED",
      title: "Recurring subscription: SPOTIFY",
      evidence: { ...pendingRec.evidence, normalizedMerchant: "SPOTIFY" },
      projectedMonthlyImpact: fromReais(19.9),
      projectedAnnualImpact: fromReais(238.8),
    });
    const summary: RecommendationsSummary = {
      pending: [pendingRec],
      awaitingVerification: [],
      verified: [verifiedRec],
      failed: [],
      rejected: [],
      potentialMonthlySavingsCents: pendingRec.projectedMonthlyImpact.cents,
      acceptedExpectedMonthlySavingsCents: 0,
      verifiedMonthlySavingsCents: verifiedRec.projectedMonthlyImpact.cents,
    };

    const facts = extractFinancialFacts("getRecommendations", summary);
    const amounts = facts.map((f) => f.amountCents);
    expect(amounts).toContain(pendingRec.projectedMonthlyImpact.cents);
    expect(amounts).toContain(verifiedRec.projectedMonthlyImpact.cents);
    expect(amounts).toContain(summary.potentialMonthlySavingsCents);
    expect(amounts).toContain(summary.verifiedMonthlySavingsCents);
  });

  /**
   * Sprint 6 (DEC-074): a real live bug found via the exact acceptance
   * scenario ("Vou sair com uma garota..."). The model correctly called
   * getConciergeBudget and correctly cited its recommended/caution amounts
   * — financial-envelope-first working exactly as designed — but grounding
   * rejected them because no extractor existed for this tool at all. The
   * model's answer was correct the whole time.
   */
  it("(Sprint 6, DEC-074) getConciergeBudget exposes recommended/caution/search-ceiling amounts", () => {
    const budget = { recommendedAmountCents: 129301, cautionAmountCents: 159301, searchCeilingCents: 159301, asOfDate: "2026-09-09" };
    const amounts = extractFinancialFacts("getConciergeBudget", budget).map((f) => f.amountCents);
    expect(amounts).toContain(budget.recommendedAmountCents);
    expect(amounts).toContain(budget.cautionAmountCents);
    expect(amounts).toContain(budget.searchCeilingCents);
  });

  it("(Sprint 6, DEC-074) buildConciergePlans/evaluateConciergePlan expose their nested budget's amounts too", () => {
    const budget = { recommendedAmountCents: 129301, cautionAmountCents: 159301, searchCeilingCents: 159301, asOfDate: "2026-09-09" };
    const buildAmounts = extractFinancialFacts("buildConciergePlans", { budget, plans: [], sessionId: "s1", discoveryFacts: [] }).map(
      (f) => f.amountCents,
    );
    expect(buildAmounts).toContain(budget.recommendedAmountCents);

    const evalAmounts = extractFinancialFacts("evaluateConciergePlan", {
      plan: {},
      stale: false,
      currentBudget: budget,
    }).map((f) => f.amountCents);
    expect(evalAmounts).toContain(budget.cautionAmountCents);
  });

  /**
   * Sprint 7 (declarative grounding): getAlerts/getAlertDetails/
   * markAlertSeen/dismissAlert/reevaluateAlertContext all declare
   * `extractFacts` INLINE, alongside their own tool definition (see
   * `ToolDefinition.extractFacts`'s doc comment) — this proves the
   * dispatcher actually reaches that declared function rather than falling
   * through to the legacy switch (which has no case for these tool names at
   * all), so a new tool's grounding coverage can never be a separately-
   * forgettable step.
   */
  function buildAlert(overrides: Partial<Alert> = {}): Alert {
    return {
      id: createId("alert"),
      financialProfileId: fixtureProfile.id,
      type: "SAFE_TO_SPEND_MATERIAL_DROP",
      status: "ACTIVE_UNSEEN",
      severity: "ATTENTION",
      identityKey: `${fixtureProfile.id}:SAFE_TO_SPEND_MATERIAL_DROP`,
      title: "Seu Safe-to-Spend caiu de forma relevante desde a última atualização.",
      reasonCode: "RELATIVE_DROP",
      createdAt: "2026-09-09T00:00:00.000Z",
      firstTriggeredAt: "2026-09-09T00:00:00.000Z",
      lastTriggeredAt: "2026-09-09T00:00:00.000Z",
      evidence: { kind: "SAFE_TO_SPEND_MATERIAL_DROP", previousCents: 100_000, currentCents: 80_000, deltaCents: 20_000, relativeDropRatio: 0.2 },
      policyVersion: 1,
      transitions: [{ status: "ACTIVE_UNSEEN", at: "2026-09-09T00:00:00.000Z" }],
      ...overrides,
    };
  }

  it("(Sprint 7) getAlerts exposes every returned alert's evidence amounts", () => {
    const alert = buildAlert();
    const amounts = extractFinancialFacts("getAlerts", { active: [alert], unreadCount: 1 }).map((f) => f.amountCents);
    expect(amounts).toContain(100_000);
    expect(amounts).toContain(80_000);
    expect(amounts).toContain(20_000);
  });

  it("(Sprint 7) getAlertDetails/markAlertSeen/dismissAlert/reevaluateAlertContext each expose one alert's amounts", () => {
    const alert = buildAlert();
    for (const toolName of ["getAlertDetails", "markAlertSeen", "dismissAlert", "reevaluateAlertContext"]) {
      const amounts = extractFinancialFacts(toolName, alert).map((f) => f.amountCents);
      expect(amounts).toContain(80_000);
    }
  });

  it("(Sprint 7) a RECOMMENDATION_DECISION alert exposes its observed/impact amounts", () => {
    const alert = buildAlert({
      type: "RECOMMENDATION_FAILED",
      evidence: {
        kind: "RECOMMENDATION_DECISION",
        recommendationId: "rec-1",
        recommendationTitle: "Recurring subscription: SPOTIFY",
        observedAmountCents: 5990,
        projectedMonthlyImpactCents: 5990,
      },
    });
    const amounts = extractFinancialFacts("getAlertDetails", alert).map((f) => f.amountCents);
    expect(amounts).toContain(5990);
  });

  it("(Sprint 7) an alert type with no monetary evidence exposes zero facts, never a guessed amount", () => {
    const alert = buildAlert({
      type: "CONNECTION_NEEDS_ATTENTION",
      evidence: { kind: "CONNECTION_NEEDS_ATTENTION", connectionId: "conn-1", connectorName: "Pluggy Bank", status: "LOGIN_ERROR", reasonCode: "REPEATED_SYNC_FAILURE" },
    });
    expect(extractFinancialFacts("getAlertDetails", alert)).toEqual([]);
  });
});
