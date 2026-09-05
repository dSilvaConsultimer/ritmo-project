import { describe, expect, it } from "vitest";
import * as M from "../money/index";
import { buildFinancialSnapshot, type FinancialSnapshotInput } from "./snapshot";
import {
  initialUserSnapshotInput,
  motherSupport,
  fixedExpenses,
} from "../fixtures/initial-user";

describe("buildFinancialSnapshot (initial user fixture)", () => {
  const snapshot = buildFinancialSnapshot(initialUserSnapshotInput);

  it("computes gross income, taxes and usable income", () => {
    expect(snapshot.income.gross.cents).toBe(1_500_000);
    expect(snapshot.income.taxes.cents).toBe(87_000);
    expect(snapshot.income.usable.cents).toBe(1_413_000);
  });

  it("sums fixed commitments excluding tax", () => {
    // housing 160000 + mother 100000 + car 271500 + credit card 140000
    // + life insurance 36000 + gym 15000 + footvolley 15500
    expect(snapshot.commitments.fixed.cents).toBe(738_000);
  });

  it("includes the protected BRL 1,000 mother support as a fixed commitment", () => {
    expect(motherSupport.protected).toBe(true);
    expect(motherSupport.amount.cents).toBe(100_000);
    expect(fixedExpenses.some((e) => e.id === motherSupport.id && e.protected)).toBe(true);
  });

  it("sums variable budgets (food target)", () => {
    expect(snapshot.commitments.variableBudgets.cents).toBe(150_000);
  });

  it("counts the already-paid rodeo ticket once, as actual spending, never as a future reserve", () => {
    // iFood transaction (4500) + rodeo ticket already paid (47610)
    expect(snapshot.commitments.actualSpending.cents).toBe(52_110);
    // futureConfirmed must be ONLY the van (10000) — the ticket must not appear here too.
    expect(snapshot.commitments.futureConfirmed.cents).toBe(10_000);
  });

  it("reserves the confirmed future rodeo transportation cost", () => {
    expect(snapshot.commitments.futureConfirmed.cents).toBe(10_000);
  });

  it("represents the estimated rodeo drinks cost as an estimated future expense", () => {
    expect(snapshot.commitments.futureEstimated.cents).toBe(15_000);
  });

  it("flags the unknown beach trip budget with a warning, not as zero", () => {
    expect(snapshot.commitments.unknownLabels.length).toBeGreaterThan(0);
    expect(snapshot.commitments.unknownLabels[0]).toContain("Beach trip");
    expect(snapshot.warnings.some((w) => w.toLowerCase().includes("unknown"))).toBe(true);
  });

  it("degrades confidence to LOW when any commitment is unknown", () => {
    expect(snapshot.confidence).toBe("LOW");
  });

  it("computes discretionary cash, protected savings and safe-to-spend", () => {
    expect(snapshot.discretionaryBeforeSavings.cents).toBe(447_890);
    expect(snapshot.protectedSavings.cents).toBe(200_000);
    expect(snapshot.projectedSavings.cents).toBe(200_000);
    expect(snapshot.safeToSpend.total.cents).toBe(247_890);
  });

  it("spreads safe-to-spend across the remaining days of the month", () => {
    expect(snapshot.safeToSpend.daysRemainingInMonth).toBe(26);
    expect(snapshot.safeToSpend.recommendedForToday.cents).toBe(9_534);
  });
});

describe("buildFinancialSnapshot — confidence levels", () => {
  const baseline: FinancialSnapshotInput = {
    ...initialUserSnapshotInput,
    events: [],
  };

  it("is HIGH confidence when nothing is estimated or unknown", () => {
    const allActual: FinancialSnapshotInput = {
      ...baseline,
      fixedExpenses: baseline.fixedExpenses.map((e) => ({ ...e, certainty: "ACTUAL" as const })),
      variableBudgets: baseline.variableBudgets.map((b) => ({
        ...b,
        certainty: "ACTUAL" as const,
      })),
    };
    expect(buildFinancialSnapshot(allActual).confidence).toBe("HIGH");
  });

  it("is MEDIUM confidence when something is estimated but nothing is unknown", () => {
    expect(buildFinancialSnapshot(baseline).confidence).toBe("MEDIUM");
  });
});

describe("buildFinancialSnapshot — negative safe-to-spend", () => {
  it("warns when spending as committed would eat into protected savings", () => {
    const overCommitted: FinancialSnapshotInput = {
      ...initialUserSnapshotInput,
      goal: {
        ...initialUserSnapshotInput.goal,
        monthlySavingsTarget: M.fromReais(10_000),
      },
    };
    const snapshot = buildFinancialSnapshot(overCommitted);
    expect(M.isNegative(snapshot.safeToSpend.total)).toBe(true);
    expect(
      snapshot.warnings.some((w) => w.toLowerCase().includes("negative")),
    ).toBe(true);
    expect(snapshot.projectedSavings.cents).toBeLessThan(1_000_000);
  });
});
