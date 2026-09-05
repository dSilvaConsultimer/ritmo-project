import { describe, expect, it } from "vitest";
import { buildFinancialSnapshot } from "../snapshot/snapshot";
import {
  initialUserSnapshotInput,
  variableBudgets,
  independentLivingGoal,
} from "../fixtures/initial-user";
import { getCategoryBudgetStatus, getGoalStatus } from "./status";

const snapshot = buildFinancialSnapshot(initialUserSnapshotInput);

describe("getCategoryBudgetStatus", () => {
  it("returns one status entry per configured variable budget", () => {
    const statuses = getCategoryBudgetStatus(
      variableBudgets,
      initialUserSnapshotInput.transactions,
      initialUserSnapshotInput.reconciliationLinks,
      initialUserSnapshotInput.asOfDate,
    );
    expect(statuses).toHaveLength(variableBudgets.length);
    expect(statuses[0]!.category).toBe("Food");
    expect(statuses[0]!.target.cents).toBe(variableBudgets[0]!.targetAmount.cents);
  });

  it("computes remaining as target - spent and flags overBudget when negative", () => {
    const [foodStatus] = getCategoryBudgetStatus(
      variableBudgets,
      initialUserSnapshotInput.transactions,
      initialUserSnapshotInput.reconciliationLinks,
      initialUserSnapshotInput.asOfDate,
    );
    expect(foodStatus!.remaining.cents).toBe(foodStatus!.target.cents - foodStatus!.spent.cents);
    expect(foodStatus!.overBudget).toBe(foodStatus!.remaining.cents < 0);
  });
});

describe("getGoalStatus", () => {
  it("reports the monthly savings target and current projected savings", () => {
    const status = getGoalStatus(independentLivingGoal, snapshot);
    expect(status.monthlySavingsTarget.cents).toBe(independentLivingGoal.monthlySavingsTarget.cents);
    expect(status.projectedSavingsThisMonth.cents).toBe(snapshot.projectedSavings.cents);
  });

  it("reports monthlyTargetMet true when projected savings meet the target", () => {
    const status = getGoalStatus(independentLivingGoal, snapshot);
    expect(status.monthlyTargetMet).toBe(status.monthlyGap.cents === 0);
  });

  it("omits targetReserveAmount when the goal has none set — never invents a reserve target", () => {
    const status = getGoalStatus(independentLivingGoal, snapshot);
    expect(status.targetReserveAmount).toBeUndefined();
  });

  it("passes through a real targetReserveAmount when the goal has one", () => {
    const goalWithReserve = {
      ...independentLivingGoal,
      targetReserveAmount: snapshot.protectedSavings,
    };
    const status = getGoalStatus(goalWithReserve, snapshot);
    expect(status.targetReserveAmount?.cents).toBe(snapshot.protectedSavings.cents);
  });
});
