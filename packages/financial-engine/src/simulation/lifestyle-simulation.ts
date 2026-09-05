import { createId } from "@money-copilot/shared";
import * as M from "../money/index";
import type { Money } from "../money/index";
import type { FixedExpense } from "../domain/expense";
import { classifyLifestyleViability, type LifestyleScenario, type LifestyleViability } from "../domain/scenario";
import { buildFinancialSnapshot, type FinancialSnapshot, type FinancialSnapshotInput } from "../snapshot/snapshot";

const LIFESTYLE_SIMULATION_CATEGORY = "Lifestyle Simulation" as const;

/**
 * Applies a lifestyle scenario's incremental expenses to a snapshot input
 * and builds the resulting snapshot. Never mutates the original input —
 * a new input object (and new arrays) is constructed. See RULE #13, #14.
 */
export function simulateLifestyle(
  baseInput: FinancialSnapshotInput,
  scenario: LifestyleScenario,
): FinancialSnapshot {
  const deltaExpenses: FixedExpense[] = scenario.additionalMonthlyExpenses.map((delta) => ({
    id: createId("fixed-expense"),
    label: `${scenario.label}: ${delta.label}`,
    category: LIFESTYLE_SIMULATION_CATEGORY,
    amount: delta.amount,
    certainty: delta.certainty,
    protected: false,
  }));

  const scenarioInput: FinancialSnapshotInput = {
    ...baseInput,
    fixedExpenses: [...baseInput.fixedExpenses, ...deltaExpenses],
  };

  return buildFinancialSnapshot(scenarioInput);
}

export interface LifestyleComparisonResult {
  readonly current: FinancialSnapshot;
  readonly independent: FinancialSnapshot;
  readonly projectedSavingsDelta: Money;
  readonly safeToSpendDelta: Money;
  /**
   * Tri-state viability read — see `docs/DECISIONS.md` DEC-010. Replaces
   * the Sprint 1 boolean `isIndependentLivingViable`
   * ("projected savings >= 0"), which did not distinguish "barely
   * surviving" from "goal fully preserved."
   */
  readonly currentViability: LifestyleViability;
  readonly independentViability: LifestyleViability;
}

export function compareLifestyles(
  baseInput: FinancialSnapshotInput,
  currentScenario: LifestyleScenario,
  independentScenario: LifestyleScenario,
): LifestyleComparisonResult {
  const current = simulateLifestyle(baseInput, currentScenario);
  const independent = simulateLifestyle(baseInput, independentScenario);

  return {
    current,
    independent,
    projectedSavingsDelta: M.subtract(independent.projectedSavings, current.projectedSavings),
    safeToSpendDelta: M.subtract(independent.safeToSpend.total, current.safeToSpend.total),
    currentViability: classifyLifestyleViability(current.projectedSavings, current.protectedSavings),
    independentViability: classifyLifestyleViability(
      independent.projectedSavings,
      independent.protectedSavings,
    ),
  };
}
