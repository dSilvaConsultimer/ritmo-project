import { describe, expect, it } from "vitest";
import {
  buildFinancialSnapshot,
  compareLifestyles,
  currentLifestyleScenario,
  getDailyGuidance,
  getSpendingEnvelope,
  independentLivingScenario,
  initialUserSnapshotInput,
} from "@money-copilot/financial-engine";
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
});
