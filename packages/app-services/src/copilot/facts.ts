import type { FinancialConfidence } from "@money-copilot/financial-engine";
import type {
  CategoryBudgetStatus,
  DailyGuidance,
  ExpenseSimulationResult,
  GoalStatus,
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
  | "DAILY_GUIDANCE";

export interface FinancialFact {
  readonly label: string;
  readonly amountCents: number;
  readonly certainty: FinancialConfidence;
  readonly sourceTool: string;
  readonly semanticType: FinancialFactSemanticType;
}

/**
 * Deterministically derives the structured `FinancialFact[]` for one
 * tool's result — a plain, total function per tool name. Returns an empty
 * array for tools with no salient monetary figure (or one this repo
 * hasn't wired up a fact extractor for yet) rather than guessing.
 */
export function extractFinancialFacts(toolName: string, result: unknown): FinancialFact[] {
  switch (toolName) {
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
    default:
      return [];
  }
}
