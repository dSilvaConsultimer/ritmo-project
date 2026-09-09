import type { FinancialConfidence, FinancialSnapshot } from "@money-copilot/financial-engine";
import type {
  CategoryBudgetStatus,
  DailyGuidance,
  ExpenseSimulationResult,
  GoalStatus,
  LifestyleComparisonResult,
  ReplanResult,
  SafeToSpend,
  SpendingEnvelope,
} from "@money-copilot/financial-engine";
import type { UpcomingFinancialEvent } from "../queries";

/**
 * A single deterministic monetary fact, always traceable back to the tool
 * that computed it. The assistant's prose EXPLAINS these; it never
 * recomputes them — see docs/AI-COPILOT.md, "Financial fact grounding."
 */
export type FinancialFactSemanticType =
  | "SAFE_TO_SPEND"
  | "RECOMMENDED_LIMIT"
  | "CAUTION_LIMIT"
  | "PROJECTED_SAVINGS"
  | "GOAL_GAP"
  | "COMPENSATION_REQUIRED"
  | "EVENT_RESERVATION"
  | "CATEGORY_REMAINING"
  | "DAILY_GUIDANCE"
  | "INCOME"
  | "COMMITMENT"
  | "DISCRETIONARY_CASH"
  | "FUTURE_COMMITMENT";

export interface FinancialFact {
  readonly label: string;
  readonly amountCents: number;
  readonly certainty: FinancialConfidence;
  readonly sourceTool: string;
  readonly semanticType: FinancialFactSemanticType;
}

/**
 * Every salient monetary figure a `FinancialSnapshot` carries, as facts —
 * shared by `getFinancialSnapshot` and `getLifestyleComparison` (which
 * returns TWO full snapshots). Added in Sprint 4.5 (DEC-055) after live
 * validation showed a model correctly citing snapshot fields (usable
 * income, a scenario's fixed commitments, etc.) that had no fact extractor
 * yet — a real grounding-coverage gap, not a hallucination. Enumerating the
 * whole snapshot here, once, is deliberately more complete than reacting
 * field-by-field to whatever a live model happens to mention on a given
 * call, since which fields get cited is inherently non-deterministic.
 */
function financialSnapshotFacts(
  snapshot: FinancialSnapshot,
  sourceTool: string,
  labelPrefix: string,
): FinancialFact[] {
  const fields: Array<Pick<FinancialFact, "label" | "amountCents" | "semanticType">> = [
    { label: `${labelPrefix}usable income`, amountCents: snapshot.income.usable.cents, semanticType: "INCOME" },
    { label: `${labelPrefix}gross income`, amountCents: snapshot.income.gross.cents, semanticType: "INCOME" },
    { label: `${labelPrefix}taxes`, amountCents: snapshot.income.taxes.cents, semanticType: "INCOME" },
    {
      label: `${labelPrefix}fixed commitments`,
      amountCents: snapshot.commitments.fixed.cents,
      semanticType: "COMMITMENT",
    },
    {
      label: `${labelPrefix}variable budgets`,
      amountCents: snapshot.commitments.variableBudgets.cents,
      semanticType: "COMMITMENT",
    },
    {
      label: `${labelPrefix}actual spending this month`,
      amountCents: snapshot.commitments.actualSpending.cents,
      semanticType: "COMMITMENT",
    },
    {
      label: `${labelPrefix}debt/installment commitments`,
      amountCents: snapshot.commitments.debtCommitments.cents,
      semanticType: "COMMITMENT",
    },
    {
      label: `${labelPrefix}future confirmed expenses`,
      amountCents: snapshot.commitments.futureConfirmed.cents,
      semanticType: "COMMITMENT",
    },
    {
      label: `${labelPrefix}future estimated expenses`,
      amountCents: snapshot.commitments.futureEstimated.cents,
      semanticType: "COMMITMENT",
    },
    {
      label: `${labelPrefix}protected savings target`,
      amountCents: snapshot.protectedSavings.cents,
      semanticType: "PROJECTED_SAVINGS",
    },
    {
      label: `${labelPrefix}discretionary cash before savings`,
      amountCents: snapshot.discretionaryBeforeSavings.cents,
      semanticType: "DISCRETIONARY_CASH",
    },
    {
      label: `${labelPrefix}projected month-end cash`,
      amountCents: snapshot.projectedMonthEndCash.cents,
      semanticType: "DISCRETIONARY_CASH",
    },
    {
      label: `${labelPrefix}projected savings`,
      amountCents: snapshot.projectedSavings.cents,
      semanticType: "PROJECTED_SAVINGS",
    },
    {
      label: `${labelPrefix}safe-to-spend (remaining this month)`,
      amountCents: snapshot.safeToSpend.total.cents,
      semanticType: "SAFE_TO_SPEND",
    },
    {
      label: `${labelPrefix}recommended discretionary spend today`,
      amountCents: snapshot.safeToSpend.recommendedForToday.cents,
      semanticType: "DAILY_GUIDANCE",
    },
    {
      label: `${labelPrefix}current-period installment commitment`,
      amountCents: snapshot.futureInstallmentCommitments.currentPeriodAmount.cents,
      semanticType: "FUTURE_COMMITMENT",
    },
    {
      label: `${labelPrefix}next 30 days commitment`,
      amountCents: snapshot.futureInstallmentCommitments.next30DaysCommitment.cents,
      semanticType: "FUTURE_COMMITMENT",
    },
    {
      label: `${labelPrefix}next 90 days commitment`,
      amountCents: snapshot.futureInstallmentCommitments.next90DaysCommitment.cents,
      semanticType: "FUTURE_COMMITMENT",
    },
  ];
  const facts: FinancialFact[] = fields.map((f) => ({ ...f, certainty: snapshot.confidence, sourceTool }));

  if (snapshot.liquidity.liquidityAwareSafeToSpend !== null) {
    facts.push({
      label: `${labelPrefix}liquidity-aware safe-to-spend`,
      amountCents: snapshot.liquidity.liquidityAwareSafeToSpend.cents,
      certainty: snapshot.confidence,
      sourceTool,
      semanticType: "SAFE_TO_SPEND",
    });
  }

  return facts;
}

/**
 * Deterministically derives the structured `FinancialFact[]` for one
 * tool's result — a plain, total function per tool name. Returns an empty
 * array for tools with no salient monetary figure (or one this repo
 * hasn't wired up a fact extractor for yet) rather than guessing.
 */
export function extractFinancialFacts(toolName: string, result: unknown): FinancialFact[] {
  switch (toolName) {
    case "getFinancialSnapshot": {
      return financialSnapshotFacts(result as FinancialSnapshot, toolName, "");
    }
    case "getSafeToSpend": {
      const r = result as SafeToSpend;
      return [
        {
          label: "Safe-to-spend (remaining this month)",
          amountCents: r.total.cents,
          certainty: "HIGH",
          sourceTool: toolName,
          semanticType: "SAFE_TO_SPEND",
        },
      ];
    }
    case "getSpendingEnvelope": {
      const r = result as SpendingEnvelope;
      return [
        {
          label: "Recommended amount",
          amountCents: r.recommendedAmount.cents,
          certainty: r.confidence,
          sourceTool: toolName,
          semanticType: "RECOMMENDED_LIMIT",
        },
        {
          label: "Stretch / caution amount",
          amountCents: r.cautionAmount.cents,
          certainty: r.confidence,
          sourceTool: toolName,
          semanticType: "CAUTION_LIMIT",
        },
        // Sprint 4.5 live validation (DEC-055): a live model correctly cited the
        // protected savings target from this same tool result ("preserves your
        // protected savings of R$X") — this was a real, deterministic figure the
        // tool already returns, just not yet turned into a groundable fact.
        {
          label: "Protected savings target",
          amountCents: r.protectedSavingsStatus.target.cents,
          certainty: "HIGH",
          sourceTool: toolName,
          semanticType: "PROJECTED_SAVINGS",
        },
      ];
    }
    case "getDailyGuidance": {
      const r = result as DailyGuidance;
      return [
        {
          label: "Recommended discretionary spend today",
          amountCents: r.recommendedDiscretionarySpendToday.cents,
          certainty: r.confidence,
          sourceTool: toolName,
          semanticType: "DAILY_GUIDANCE",
        },
        // Sprint 4.5 live validation (DEC-055): a live model correctly cited the
        // remaining monthly Safe-to-Spend alongside the daily figure — both
        // fields already exist on this tool's result.
        {
          label: "Safe-to-spend (remaining this month)",
          amountCents: r.monthlySafeToSpendRemaining.cents,
          certainty: r.confidence,
          sourceTool: toolName,
          semanticType: "SAFE_TO_SPEND",
        },
      ];
    }
    case "simulateExpense": {
      const r = result as ExpenseSimulationResult;
      return [
        {
          label: "Recommended limit",
          amountCents: r.recommendedLimit.cents,
          certainty: "HIGH",
          sourceTool: toolName,
          semanticType: "RECOMMENDED_LIMIT",
        },
        {
          label: "Projected savings after this expense",
          amountCents: r.projectedSavingsAfter.cents,
          certainty: "HIGH",
          sourceTool: toolName,
          semanticType: "PROJECTED_SAVINGS",
        },
        {
          label: "Compensation required",
          amountCents: r.compensationRequired.cents,
          certainty: "HIGH",
          sourceTool: toolName,
          semanticType: "COMPENSATION_REQUIRED",
        },
      ];
    }
    case "replanAfterExpense": {
      const r = result as ReplanResult;
      return [
        {
          label: "New safe-to-spend",
          amountCents: r.newSafeToSpend.cents,
          certainty: "HIGH",
          sourceTool: toolName,
          semanticType: "SAFE_TO_SPEND",
        },
        {
          label: "New projected savings",
          amountCents: r.newProjectedSavings.cents,
          certainty: "HIGH",
          sourceTool: toolName,
          semanticType: "PROJECTED_SAVINGS",
        },
        {
          label: "Compensation required",
          amountCents: r.compensationRequired.cents,
          certainty: "HIGH",
          sourceTool: toolName,
          semanticType: "COMPENSATION_REQUIRED",
        },
      ];
    }
    case "getGoalStatus": {
      const r = result as GoalStatus;
      return [
        {
          label: "Projected savings this month",
          amountCents: r.projectedSavingsThisMonth.cents,
          certainty: "HIGH",
          sourceTool: toolName,
          semanticType: "PROJECTED_SAVINGS",
        },
        {
          label: "Monthly savings gap",
          amountCents: r.monthlyGap.cents,
          certainty: "HIGH",
          sourceTool: toolName,
          semanticType: "GOAL_GAP",
        },
      ];
    }
    case "getCategoryBudgetStatus": {
      const rows = result as readonly CategoryBudgetStatus[];
      return rows.map((row) => ({
        label: `${row.category} remaining`,
        amountCents: row.remaining.cents,
        certainty: "HIGH" as const,
        sourceTool: toolName,
        semanticType: "CATEGORY_REMAINING" as const,
      }));
    }
    case "getUpcomingFinancialEvents": {
      const rows = result as readonly UpcomingFinancialEvent[];
      return rows.flatMap((row) => {
        const facts: FinancialFact[] = [];
        if (row.breakdown.futureConfirmed.cents !== 0) {
          facts.push({
            label: `${row.event.label}: reserved`,
            amountCents: row.breakdown.futureConfirmed.cents,
            certainty: "HIGH",
            sourceTool: toolName,
            semanticType: "EVENT_RESERVATION",
          });
        }
        return facts;
      });
    }
    case "getLifestyleComparison": {
      // Sprint 4.5 live validation (DEC-055): this tool had NO fact extractor at
      // all, so a live model's entirely correct, fully deterministic comparison
      // (citing fields from either full snapshot, plus the deltas it itself
      // computed) was flagged as unsupported and replaced with a generic
      // fallback — a real grounding-coverage gap, not a hallucination. Reuses
      // `financialSnapshotFacts` for both full snapshots rather than picking
      // individual fields, since which fields a live model cites varies
      // call-to-call. Deltas are stored as their absolute magnitude: prose
      // expresses direction in words ("reduces by X"), not a minus sign.
      const r = result as LifestyleComparisonResult;
      return [
        ...financialSnapshotFacts(r.current, toolName, "Current lifestyle: "),
        ...financialSnapshotFacts(r.independent, toolName, "Independent-living: "),
        {
          label: "Safe-to-spend delta (independent-living vs. current)",
          amountCents: Math.abs(r.safeToSpendDelta.cents),
          certainty: "HIGH",
          sourceTool: toolName,
          semanticType: "SAFE_TO_SPEND",
        },
        {
          label: "Projected savings delta (independent-living vs. current)",
          amountCents: Math.abs(r.projectedSavingsDelta.cents),
          certainty: "HIGH",
          sourceTool: toolName,
          semanticType: "PROJECTED_SAVINGS",
        },
      ];
    }
    default:
      return [];
  }
}
