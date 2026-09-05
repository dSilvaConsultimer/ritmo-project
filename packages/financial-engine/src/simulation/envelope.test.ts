import { describe, expect, it } from "vitest";
import * as M from "../money/index";
import { buildFinancialSnapshot } from "../snapshot/snapshot";
import { initialUserSnapshotInput } from "../fixtures/initial-user";
import { simulateExpense } from "./expense-simulation";
import { getDailyGuidance, getSpendingEnvelope } from "./envelope";

const snapshot = buildFinancialSnapshot(initialUserSnapshotInput);
// safeToSpend.total = 217_111 cents; protectedSavings = 200_000 cents (see expense-simulation.test.ts).

describe("getSpendingEnvelope", () => {
  it("computes the SAFE boundary as the plan's Safe-to-Spend, floored at zero", () => {
    const envelope = getSpendingEnvelope(snapshot);
    expect(envelope.recommendedAmount.cents).toBe(217_111);
    expect(envelope.monthlySafeToSpendRemaining.cents).toBe(217_111);
  });

  it("computes the CAUTION boundary using the same 15% policy ratio as simulateExpense", () => {
    const envelope = getSpendingEnvelope(snapshot);
    // protectedSavings(200_000) * 0.15 = 30_000 -> 217_111 + 30_000 = 247_111
    expect(envelope.cautionAmount.cents).toBe(247_111);
    expect(envelope.highImpactThreshold.cents).toBe(247_111);
  });

  it("cross-validates its boundaries against simulateExpense's own classification", () => {
    const envelope = getSpendingEnvelope(snapshot);

    const atCautionBoundary = simulateExpense(snapshot, {
      amount: envelope.cautionAmount,
      category: "Date night",
      date: "2026-09-05",
    });
    expect(atCautionBoundary.status).toBe("CAUTION");

    const oneCentOverCautionBoundary = simulateExpense(snapshot, {
      amount: M.add(envelope.cautionAmount, M.fromCents(1)),
      category: "Date night",
      date: "2026-09-05",
    });
    expect(oneCentOverCautionBoundary.status).toBe("HIGH_IMPACT");

    const withinRecommended = simulateExpense(snapshot, {
      amount: envelope.recommendedAmount,
      category: "Date night",
      date: "2026-09-05",
    });
    expect(withinRecommended.status).toBe("SAFE");
  });

  it("never lets the LLM invent this math — every field traces to the deterministic snapshot", () => {
    const envelope = getSpendingEnvelope(snapshot);
    expect(envelope.protectedSavingsStatus.target.cents).toBe(snapshot.protectedSavings.cents);
    expect(envelope.protectedSavingsStatus.projected.cents).toBe(snapshot.projectedSavings.cents);
    expect(envelope.confidence).toBe(snapshot.confidence);
    expect(envelope.warnings).toEqual(snapshot.warnings);
  });

  it("surfaces unknown-budget event labels rather than silently treating them as zero", () => {
    const envelope = getSpendingEnvelope(snapshot);
    expect(envelope.relevantEventReservations).toEqual(snapshot.commitments.unknownLabels);
  });

  it("includes optional category headroom only when supplied", () => {
    const withoutHeadroom = getSpendingEnvelope(snapshot);
    expect(withoutHeadroom.relevantCategoryHeadroom).toBeUndefined();

    const withHeadroom = getSpendingEnvelope(snapshot, undefined, {
      category: "Food",
      target: M.fromCents(150_000),
      spent: M.fromCents(50_000),
      remaining: M.fromCents(100_000),
    });
    expect(withHeadroom.relevantCategoryHeadroom?.category).toBe("Food");
  });

  it("respects a custom, more conservative SpendPolicy", () => {
    const strictPolicy = { cautionCompensationRatio: 0.05 };
    const envelope = getSpendingEnvelope(snapshot, strictPolicy);
    // 200_000 * 0.05 = 10_000 -> 217_111 + 10_000 = 227_111
    expect(envelope.cautionAmount.cents).toBe(227_111);
  });
});

describe("getDailyGuidance", () => {
  it("packages the snapshot's already-computed daily figure without new arithmetic", () => {
    const guidance = getDailyGuidance(snapshot);
    expect(guidance.recommendedDiscretionarySpendToday.cents).toBe(
      snapshot.safeToSpend.recommendedForToday.cents,
    );
    expect(guidance.daysRemainingInMonth).toBe(snapshot.safeToSpend.daysRemainingInMonth);
    expect(guidance.confidence).toBe(snapshot.confidence);
  });
});
