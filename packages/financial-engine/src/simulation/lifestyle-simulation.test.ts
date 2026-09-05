import { describe, expect, it } from "vitest";
import {
  initialUserSnapshotInput,
  currentLifestyleScenario,
  independentLivingScenario,
} from "../fixtures/initial-user";
import { compareLifestyles, simulateLifestyle } from "./lifestyle-simulation";

describe("lifestyle simulation", () => {
  it("current lifestyle matches the real snapshot (no incremental expenses)", () => {
    const current = simulateLifestyle(initialUserSnapshotInput, currentLifestyleScenario);
    expect(current.commitments.fixed.cents).toBe(738_000);
    expect(current.safeToSpend.total.cents).toBe(247_890);
  });

  it("independent living adds the estimated household delta without altering real data", () => {
    const originalFixedCount = initialUserSnapshotInput.fixedExpenses.length;

    const independent = simulateLifestyle(initialUserSnapshotInput, independentLivingScenario);

    // 738,000 fixed + 92,500 (500 + 300 + 125 reais) estimated delta
    expect(independent.commitments.fixed.cents).toBe(830_500);
    expect(independent.safeToSpend.total.cents).toBe(155_390);

    // The real input must never be mutated by the simulation.
    expect(initialUserSnapshotInput.fixedExpenses.length).toBe(originalFixedCount);
  });

  it("compares current vs. independent living and reports viability", () => {
    const comparison = compareLifestyles(
      initialUserSnapshotInput,
      currentLifestyleScenario,
      independentLivingScenario,
    );

    expect(comparison.safeToSpendDelta.cents).toBe(-92_500);
    // Both scenarios still fully fund the protected savings target this month.
    expect(comparison.projectedSavingsDelta.cents).toBe(0);
    expect(comparison.isIndependentLivingViable).toBe(true);
  });

  it("independent living can become non-viable if the household delta is large enough", () => {
    const expensiveIndependence = {
      ...independentLivingScenario,
      additionalMonthlyExpenses: independentLivingScenario.additionalMonthlyExpenses.map((d) => ({
        ...d,
        amount: { ...d.amount, cents: d.amount.cents * 20 },
      })),
    };

    const comparison = compareLifestyles(
      initialUserSnapshotInput,
      currentLifestyleScenario,
      expensiveIndependence,
    );

    expect(comparison.isIndependentLivingViable).toBe(false);
  });
});
