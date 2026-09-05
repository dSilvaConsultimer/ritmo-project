import { z } from "zod";
import { fromReais, replanAfterExpense } from "@money-copilot/financial-engine";
import type { Database } from "@money-copilot/persistence";
import * as queries from "../queries";
import * as mutations from "../mutations";

/**
 * The explicit, server-validated tool allowlist the AI may invoke. The
 * model NEVER queries the database or calls financial-engine internals
 * directly — every capability it has is one of these named, schema-
 * validated entries. See docs/AI-COPILOT.md, "Application tool layer."
 *
 * `kind: "READ"` tools execute unconditionally (they only read or
 * simulate — see `simulateExpense`, which never persists anything).
 * `kind: "MUTATION"` tools are additionally gated by
 * `hasExplicitMutationIntent` in the orchestrator before they run.
 */
export type ToolKind = "READ" | "MUTATION";

export interface ToolContext {
  readonly db: Database;
  readonly financialProfileId: string;
  readonly asOfDate: string;
}

export interface ToolDefinition<Args = unknown, Result = unknown> {
  readonly name: string;
  readonly description: string;
  readonly kind: ToolKind;
  readonly schema: z.ZodType<Args>;
  readonly execute: (ctx: ToolContext, args: Args) => Promise<Result>;
}

function tool<Args, Result>(def: ToolDefinition<Args, Result>): ToolDefinition<Args, Result> {
  return def;
}

const emptySchema = z.object({});

const getFinancialSnapshotTool = tool({
  name: "getFinancialSnapshot",
  description:
    "Returns the user's full current financial snapshot for this month (income, commitments, protected savings, Safe-to-Spend, warnings). Use this for broad 'how am I doing' questions.",
  kind: "READ",
  schema: emptySchema,
  execute: (ctx) => queries.getFinancialSnapshot(ctx.db, ctx.financialProfileId, ctx.asOfDate),
});

const getSafeToSpendTool = tool({
  name: "getSafeToSpend",
  description: "Returns the deterministic Safe-to-Spend total for the rest of this month and the recommended amount for today.",
  kind: "READ",
  schema: emptySchema,
  execute: (ctx) => queries.getSafeToSpend(ctx.db, ctx.financialProfileId, ctx.asOfDate),
});

const getSafeToSpendBreakdownTool = tool({
  name: "getSafeToSpendBreakdown",
  description:
    "Returns the itemized audit trail behind Safe-to-Spend (income, fixed commitments, variable budgets, actual spending, debt, event reservations, protected savings) — use this when the user asks WHY their Safe-to-Spend is a given amount.",
  kind: "READ",
  schema: emptySchema,
  execute: (ctx) => queries.getSafeToSpendBreakdown(ctx.db, ctx.financialProfileId, ctx.asOfDate),
});

const getFinancialPositionTool = tool({
  name: "getFinancialPosition",
  description: "Returns the user's real, liquidity-aware cash position (bank balance, card outstanding), when known.",
  kind: "READ",
  schema: emptySchema,
  execute: (ctx) => queries.getFinancialPosition(ctx.db, ctx.financialProfileId, ctx.asOfDate),
});

const getLifestyleComparisonTool = tool({
  name: "getLifestyleComparison",
  description:
    "Compares the user's current lifestyle (living with mother) against the independent-living simulation, including a tri-state viability read (UNSUSTAINABLE/FRAGILE/SUSTAINABLE) for each. Use this for 'am I ready to live independently' questions.",
  kind: "READ",
  schema: emptySchema,
  execute: (ctx) => queries.getLifestyleComparison(ctx.db, ctx.financialProfileId, ctx.asOfDate),
});

const getGoalStatusTool = tool({
  name: "getGoalStatus",
  description: "Returns the user's monthly savings goal, this month's projected savings, and the gap (if any) — never invents a reserve target.",
  kind: "READ",
  schema: emptySchema,
  execute: (ctx) => queries.getGoalStatusForProfile(ctx.db, ctx.financialProfileId, ctx.asOfDate),
});

const spendingEnvelopeSchema = z.object({
  category: z
    .string()
    .optional()
    .describe("An optional specific spending category to check headroom for, e.g. 'Food'."),
});

const getSpendingEnvelopeTool = tool({
  name: "getSpendingEnvelope",
  description:
    "Answers 'how much can I spend?' WITHOUT a specific amount in mind (e.g. planning a date night or an outing). Returns a recommended amount, a stretch/caution amount, and where material impact begins. Never use this to invent prices for specific items — it only returns an overall envelope.",
  kind: "READ",
  schema: spendingEnvelopeSchema,
  execute: async (ctx, args) => {
    if (!args.category) {
      return queries.getSpendingEnvelopeForProfile(ctx.db, ctx.financialProfileId, ctx.asOfDate);
    }
    const statuses = await queries.getCategoryBudgetStatusForProfile(ctx.db, ctx.financialProfileId, ctx.asOfDate);
    const match = statuses.find((s) => s.category.toLowerCase() === args.category?.toLowerCase());
    const categoryHeadroom = match
      ? { category: match.category, target: match.target, spent: match.spent, remaining: match.remaining }
      : undefined;
    return queries.getSpendingEnvelopeForProfile(ctx.db, ctx.financialProfileId, ctx.asOfDate, categoryHeadroom);
  },
});

const getDailyGuidanceTool = tool({
  name: "getDailyGuidance",
  description: "Returns today's recommended discretionary spend, accounting for the rest of the month's plan.",
  kind: "READ",
  schema: emptySchema,
  execute: (ctx) => queries.getDailyGuidanceForProfile(ctx.db, ctx.financialProfileId, ctx.asOfDate),
});

const simulateExpenseSchema = z.object({
  amountReais: z.number().positive().describe("The hypothetical expense amount, in BRL reais (e.g. 500 for R$500.00)."),
  category: z.string().describe("The spending category this expense belongs to, e.g. 'Date night', 'Groceries'."),
  date: z.string().optional().describe("ISO 8601 date of the hypothetical expense. Defaults to today."),
});

const simulateExpenseTool = tool({
  name: "simulateExpense",
  description:
    "Simulates the impact of a SPECIFIC hypothetical expense amount (e.g. 'Can I spend R$500 today?') without recording anything. Returns SAFE/CAUTION/HIGH_IMPACT classification, the recommended limit, and savings impact. Never blocks the user — always returns a structured result.",
  kind: "READ",
  schema: simulateExpenseSchema,
  execute: (ctx, args) =>
    queries.simulateExpenseForProfile(ctx.db, ctx.financialProfileId, ctx.asOfDate, {
      amount: fromReais(args.amountReais),
      category: args.category,
      date: args.date ?? ctx.asOfDate,
    }),
});

const getUpcomingFinancialEventsTool = tool({
  name: "getUpcomingFinancialEvents",
  description:
    "Lists the user's upcoming planned events (e.g. trips) with their budget breakdown, including which ones still have an UNKNOWN budget. Use this before updatePlannedFinancialEvent to find the right eventId.",
  kind: "READ",
  schema: emptySchema,
  execute: (ctx) => queries.getUpcomingFinancialEventsForProfile(ctx.db, ctx.financialProfileId, ctx.asOfDate),
});

const getCategoryBudgetStatusTool = tool({
  name: "getCategoryBudgetStatus",
  description: "Returns this month's spend vs. target for every category with a configured budget (e.g. Food).",
  kind: "READ",
  schema: emptySchema,
  execute: (ctx) => queries.getCategoryBudgetStatusForProfile(ctx.db, ctx.financialProfileId, ctx.asOfDate),
});

const recentSpendingSchema = z.object({
  days: z.number().int().positive().max(90).optional().describe("How many recent days to summarize. Defaults to 7."),
});

const getRecentSpendingSummaryTool = tool({
  name: "getRecentSpendingSummary",
  description:
    "Returns a bounded recent-days spending summary (never the user's entire transaction history) — total and per-category.",
  kind: "READ",
  schema: recentSpendingSchema,
  execute: (ctx, args) =>
    queries.getRecentSpendingSummaryForProfile(ctx.db, ctx.financialProfileId, ctx.asOfDate, args.days ?? 7),
});

// ---------- MUTATION tools — gated by hasExplicitMutationIntent in the orchestrator ----------

const recordManualTransactionSchema = z.object({
  amountReais: z.number().positive().describe("The amount actually spent, in BRL reais."),
  merchantOrDescription: z.string().min(1).describe("Where or what the money was spent on, e.g. 'Restaurant X'."),
  date: z.string().optional().describe("ISO 8601 date the expense happened. Defaults to today."),
  paymentSourceLabel: z
    .string()
    .optional()
    .describe("Only set this if the user explicitly said how they paid (e.g. 'with my Nubank card'). Never guess."),
});

const recordManualTransactionTool = tool({
  name: "recordManualTransaction",
  description:
    "Records an expense the user says ALREADY HAPPENED (e.g. 'I just spent R$250 at Restaurant X'). Only call this when the user's message reports a completed action, never for a hypothetical amount.",
  kind: "MUTATION",
  schema: recordManualTransactionSchema,
  execute: (ctx, args) =>
    mutations.recordManualTransaction(ctx.db, ctx.financialProfileId, {
      amount: fromReais(args.amountReais),
      merchantOrDescription: args.merchantOrDescription,
      date: args.date ?? ctx.asOfDate,
      ...(args.paymentSourceLabel ? { paymentSourceLabel: args.paymentSourceLabel } : {}),
    }),
});

const createPlannedFinancialEventSchema = z.object({
  label: z.string().min(1).describe("A short label for the event, e.g. 'Beach trip'."),
  startDate: z.string().describe("ISO 8601 start date."),
  endDate: z.string().describe("ISO 8601 end date."),
  budgetAmountReais: z
    .number()
    .positive()
    .optional()
    .describe("Only set this if the user stated a specific budget. Never invent one — omit it instead."),
});

const createPlannedFinancialEventTool = tool({
  name: "createPlannedFinancialEvent",
  description:
    "Creates a new planned event (e.g. a trip) the user has decided on. Only call this for a decided plan, never a hypothetical one being weighed.",
  kind: "MUTATION",
  schema: createPlannedFinancialEventSchema,
  execute: (ctx, args) =>
    mutations.createPlannedFinancialEvent(ctx.db, ctx.financialProfileId, {
      label: args.label,
      startDate: args.startDate,
      endDate: args.endDate,
      ...(args.budgetAmountReais !== undefined ? { budgetAmount: fromReais(args.budgetAmountReais) } : {}),
    }),
});

const updatePlannedFinancialEventSchema = z.object({
  eventId: z.string().describe("The event's id, obtained from a prior getUpcomingFinancialEvents call."),
  lineItemId: z
    .string()
    .optional()
    .describe("Required only if the event has more than one planned line item — obtained from getUpcomingFinancialEvents."),
  budgetAmountReais: z.number().positive().optional(),
  label: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

const updatePlannedFinancialEventTool = tool({
  name: "updatePlannedFinancialEvent",
  description:
    "Updates an existing planned event, most commonly to set a previously-unknown budget (e.g. 'Reserve R$1,200 for the beach'). Requires an eventId from getUpcomingFinancialEvents.",
  kind: "MUTATION",
  schema: updatePlannedFinancialEventSchema,
  execute: (ctx, args) =>
    mutations.updatePlannedFinancialEvent(ctx.db, ctx.financialProfileId, ctx.asOfDate, {
      eventId: args.eventId,
      ...(args.lineItemId ? { lineItemId: args.lineItemId } : {}),
      ...(args.budgetAmountReais !== undefined ? { budgetAmount: fromReais(args.budgetAmountReais) } : {}),
      ...(args.label ? { label: args.label } : {}),
      ...(args.startDate ? { startDate: args.startDate } : {}),
      ...(args.endDate ? { endDate: args.endDate } : {}),
    }),
});

const replanAfterExpenseSchema = z.object({
  previousTargetReais: z.number().nonnegative().describe("What was previously recommended, in BRL reais."),
  actualExpenseReais: z.number().positive().describe("What the user says they actually spent, in BRL reais."),
  merchantOrDescription: z.string().min(1).describe("Where or what the money was spent on."),
  category: z.string().describe("The spending category, e.g. 'Date night'."),
  date: z.string().optional().describe("ISO 8601 date the expense happened. Defaults to today."),
});

const replanAfterExpenseTool = tool({
  name: "replanAfterExpense",
  description:
    "Use when the user reports they spent MORE (or less) than a previous recommendation (e.g. 'You said R$400 but I spent R$650'). Records the actual expense and returns the recalculated Safe-to-Spend, projected savings, and any compensation required. Never judges the user — spending above a recommendation is allowed.",
  kind: "MUTATION",
  schema: replanAfterExpenseSchema,
  execute: async (ctx, args) => {
    await mutations.recordManualTransaction(ctx.db, ctx.financialProfileId, {
      amount: fromReais(args.actualExpenseReais),
      merchantOrDescription: args.merchantOrDescription,
      date: args.date ?? ctx.asOfDate,
    });
    const snapshotAfter = await queries.getFinancialSnapshot(ctx.db, ctx.financialProfileId, ctx.asOfDate);
    return replanAfterExpense({
      previousTarget: fromReais(args.previousTargetReais),
      actualExpenseAmount: fromReais(args.actualExpenseReais),
      snapshotAfter,
    });
  },
});

export const TOOL_REGISTRY: readonly ToolDefinition<never, unknown>[] = [
  getFinancialSnapshotTool,
  getSafeToSpendTool,
  getSafeToSpendBreakdownTool,
  getFinancialPositionTool,
  getLifestyleComparisonTool,
  getGoalStatusTool,
  getSpendingEnvelopeTool,
  getDailyGuidanceTool,
  simulateExpenseTool,
  getUpcomingFinancialEventsTool,
  getCategoryBudgetStatusTool,
  getRecentSpendingSummaryTool,
  recordManualTransactionTool,
  createPlannedFinancialEventTool,
  updatePlannedFinancialEventTool,
  replanAfterExpenseTool,
] as unknown as readonly ToolDefinition<never, unknown>[];

export function findTool(name: string): ToolDefinition<unknown, unknown> | undefined {
  return TOOL_REGISTRY.find((t) => t.name === name) as ToolDefinition<unknown, unknown> | undefined;
}
