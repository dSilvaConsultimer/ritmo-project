import { describe, expect, it } from "vitest";
import { createId } from "@money-copilot/shared";
import * as M from "../money/index";
import {
  initialUserSnapshotInput,
  currentLifestyleScenario,
  independentLivingScenario,
} from "../fixtures/initial-user";
import { compareLifestyles, simulateLifestyle } from "./lifestyle-simulation";

describe("lifestyle simulation", () => {
  it("current lifestyle matches the real snapshot (no incremental expenses)", () => {
    const current = simulateLifestyle(initialUserSnapshotInput, currentLifestyleScenario);
    expect(current.commitments.fixed.cents).toBe(598_000);
    expect(current.safeToSpend.total.cents).toBe(217_111);
  });

  it("independent living adds the estimated household delta without altering real data", () => {
    const originalFixedCount = initialUserSnapshotInput.fixedExpenses.length;

    const independent = simulateLifestyle(initialUserSnapshotInput, independentLivingScenario);

    // 598,000 fixed + 92,500 (500 + 300 + 125 reais) estimated delta
    expect(independent.commitments.fixed.cents).toBe(690_500);
    expect(independent.safeToSpend.total.cents).toBe(124_611);

    // The real input must never be mutated by the simulation.
    expect(initialUserSnapshotInput.fixedExpenses.length).toBe(originalFixedCount);
  });

  it("compares current vs. independent living and reports both remaining SUSTAINABLE", () => {
    const comparison = compareLifestyles(
      initialUserSnapshotInput,
      currentLifestyleScenario,
      independentLivingScenario,
    );

    expect(comparison.safeToSpendDelta.cents).toBe(-92_500);
    // Both scenarios still fully fund the protected savings target this month.
    expect(comparison.projectedSavingsDelta.cents).toBe(0);
    expect(comparison.currentViability).toBe("SUSTAINABLE");
    expect(comparison.independentViability).toBe("SUSTAINABLE");
  });

  it("classifies FRAGILE when the plan stays non-negative but misses the savings target", () => {
    const fragileScenario = {
      ...independentLivingScenario,
      additionalMonthlyExpenses: [
        {
          id: createId("lifestyle-delta"),
          label: "Larger household delta",
          amount: M.fromCents(300_000),
          certainty: "ESTIMATED" as const,
        },
      ],
    };

    const comparison = compareLifestyles(
      initialUserSnapshotInput,
      currentLifestyleScenario,
      fragileScenario,
    );

    expect(comparison.independent.projectedSavings.cents).toBe(117_111);
    expect(comparison.independent.projectedSavings.cents).toBeGreaterThanOrEqual(0);
    expect(comparison.independent.projectedSavings.cents).toBeLessThan(
      comparison.independent.protectedSavings.cents,
    );
    expect(comparison.independentViability).toBe("FRAGILE");
  });

  it("classifies UNSUSTAINABLE when the plan would go negative", () => {
    const unsustainableScenario = {
      ...independentLivingScenario,
      additionalMonthlyExpenses: [
        {
          id: createId("lifestyle-delta"),
          label: "Very large household delta",
          amount: M.fromCents(500_000),
          certainty: "ESTIMATED" as const,
        },
      ],
    };

    const comparison = compareLifestyles(
      initialUserSnapshotInput,
      currentLifestyleScenario,
      unsustainableScenario,
    );

    expect(M.isNegative(comparison.independent.projectedSavings)).toBe(true);
    expect(comparison.independentViability).toBe("UNSUSTAINABLE");
  });
});
