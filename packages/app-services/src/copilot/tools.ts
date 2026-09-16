import { z } from "zod";
import { fromReais, replanAfterExpense } from "@money-copilot/financial-engine";
import type { Database } from "@money-copilot/persistence";
import * as queries from "../queries";
import * as mutations from "../mutations";
import * as recommendationService from "../recommendation-service";
import * as conciergeService from "../concierge";
import * as alertService from "../alerts";
import { updateNotificationPreferences } from "../notifications";
import type { FinancialFact } from "./facts";

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
  /**
   * Sprint 7 (declarative grounding, see DEC "shared fact-registration
   * mechanism"): a tool that can return a monetary figure the model might
   * cite should define this RIGHT HERE, alongside its own definition — the
   * same recurring bug (DEC-055, DEC-062, DEC-074: a correct tool result
   * with no fact extractor gets rejected by grounding) happened three times
   * because the extractor lived in a SEPARATE file (`facts.ts`) a reviewer
   * could forget to touch when adding a tool. `extractFinancialFacts` in
   * `facts.ts` checks here FIRST, before its own legacy per-tool switch —
   * new tools should use this; existing tools keep working via the switch
   * unless/until migrated. See docs/AI-COPILOT.md, "Financial fact
   * grounding."
   */
  readonly extractFacts?: (result: Result) => FinancialFact[];
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

// NOTE on `.nullable().default(null)` throughout this file: OpenAI's strict
// function-calling mode requires EVERY property to appear in the schema's
// `required` array (verified against a live call — plain Zod `.optional()`
// omits the key from `required` and OpenAI rejects the tool definition
// outright with "'required' is required to be supplied and to be an array
// including every key in properties"). Making a field `.nullable()` keeps
// it in `required` while still letting the model omit it in practice (it
// sends `null`); `.default(null)` keeps `schema.parse({})` working for our
// own tests/call sites that don't set it.
const spendingEnvelopeSchema = z.object({
  category: z
    .string()
    .describe("An optional specific spending category to check headroom for, e.g. 'Food'. Null if not applicable.")
    .nullable()
    .default(null),
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
  date: z
    .string()
    .describe("ISO 8601 date of the hypothetical expense. Null defaults to today.")
    .nullable()
    .default(null),
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

// ---------- Recurring income/commitment evidence (Sprint 9, DEC-127) ----------
//
// NON-NEGOTIABLE: these are READ-only pattern detectors over real
// transactions — evidence, never a declaration. Proactively mentioning a
// candidate to the user (e.g. "detectei um recebimento recorrente de
// R$8.500 — é seu salário?") is encouraged; silently treating a candidate
// as confirmed is not. Only createIncome/createFixedExpense persist
// anything, and both are MUTATION tools gated by hasExplicitMutationIntent
// exactly like every other mutation in this file.

const getRecurringIncomeCandidatesTool = tool({
  name: "getRecurringIncomeCandidates",
  description:
    "Detects patterns of repeated REAL income deposits (e.g. a recurring salary) from the user's imported transactions. This is evidence only — never treat a candidate as confirmed income yourself. If a plausible pattern exists, ask the user to confirm (e.g. 'Detectei um recebimento recorrente de R$X. Este é seu salário/renda mensal?'); only call createIncome after they explicitly agree.",
  kind: "READ",
  schema: emptySchema,
  execute: (ctx) => queries.getRecurringIncomeCandidates(ctx.db, ctx.financialProfileId, ctx.asOfDate),
});

const getRecurringFixedExpenseCandidatesTool = tool({
  name: "getRecurringFixedExpenseCandidates",
  description:
    "Detects patterns of repeated REAL debits (e.g. rent, a condo fee) from the user's imported transactions that might be a fixed monthly commitment. This is evidence only — never treat a candidate as a confirmed commitment yourself. If a plausible pattern exists, ask the user to confirm (e.g. 'Esse condomínio de R$X parece recorrente. Deseja considerá-lo como compromisso mensal?'); only call createFixedExpense after they explicitly agree.",
  kind: "READ",
  schema: emptySchema,
  execute: (ctx) => queries.getRecurringFixedExpenseCandidates(ctx.db, ctx.financialProfileId, ctx.asOfDate),
});

const getCategoryBudgetStatusTool = tool({
  name: "getCategoryBudgetStatus",
  description: "Returns this month's spend vs. target for every category with a configured budget (e.g. Food).",
  kind: "READ",
  schema: emptySchema,
  execute: (ctx) => queries.getCategoryBudgetStatusForProfile(ctx.db, ctx.financialProfileId, ctx.asOfDate),
});

const recentSpendingSchema = z.object({
  days: z
    .number()
    .int()
    .positive()
    .max(90)
    .describe("How many recent days to summarize. Null defaults to 7.")
    .nullable()
    .default(null),
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

const manualEntryFinancialEffectEnum = z.enum([
  "CONSUMPTION",
  "TRANSFER",
  "REFUND",
  "INVESTMENT",
  "INVESTMENT_REDEMPTION",
]);

const recordManualTransactionSchema = z.object({
  amountReais: z.number().positive().describe("The amount actually spent, in BRL reais."),
  merchantOrDescription: z.string().min(1).describe("Where or what the money was spent on, e.g. 'Restaurant X'."),
  date: z
    .string()
    .describe("ISO 8601 date the expense happened. Null defaults to today.")
    .nullable()
    .default(null),
  paymentSourceLabel: z
    .string()
    .describe(
      "Only set this if the user explicitly said how they paid (e.g. 'with my Nubank card'). Null if not stated — never guess.",
    )
    .nullable()
    .default(null),
  financialEffect: manualEntryFinancialEffectEnum
    .describe(
      "DEC-132: classify what kind of money movement this is, from the user's own words — this is YOUR classification job, never a keyword guess in code. " +
        "CONSUMPTION: an ordinary purchase (default). " +
        "TRANSFER: money moved between the user's OWN accounts (e.g. 'Transferi 2 mil do Itaú para o Nubank') — never consumption, even though money left an account. " +
        "REFUND: money returned to the user for a prior purchase. " +
        "INVESTMENT: money moved INTO an investment/application product (e.g. 'Apliquei 500 no CDB') — never ordinary spending. " +
        "INVESTMENT_REDEMPTION: money moved back OUT of an investment product — never ordinary income. " +
        "Null defaults to CONSUMPTION.",
    )
    .nullable()
    .default(null),
});

const recordManualTransactionTool = tool({
  name: "recordManualTransaction",
  description:
    "Records a transaction the user says ALREADY HAPPENED (e.g. 'I just spent R$250 at Restaurant X', 'Transferi 2 mil do Itaú para o Nubank', 'Apliquei 500 no CDB'). Only call this when the user's message reports a completed action, never for a hypothetical amount. Classify `financialEffect` yourself from their words — never let a transfer or investment become a consumption expense.",
  kind: "MUTATION",
  schema: recordManualTransactionSchema,
  execute: (ctx, args) =>
    mutations.recordManualTransaction(ctx.db, ctx.financialProfileId, {
      amount: fromReais(args.amountReais),
      merchantOrDescription: args.merchantOrDescription,
      date: args.date ?? ctx.asOfDate,
      ...(args.paymentSourceLabel ? { paymentSourceLabel: args.paymentSourceLabel } : {}),
      ...(args.financialEffect ? { financialEffect: args.financialEffect } : {}),
    }),
});

const createPlannedFinancialEventSchema = z.object({
  label: z.string().min(1).describe("A short label for the event, e.g. 'Beach trip'."),
  startDate: z.string().describe("ISO 8601 start date."),
  endDate: z.string().describe("ISO 8601 end date."),
  budgetAmountReais: z
    .number()
    .positive()
    .describe("Only set this if the user stated a specific budget. Never invent one — pass null instead.")
    .nullable()
    .default(null),
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
      ...(args.budgetAmountReais !== null ? { budgetAmount: fromReais(args.budgetAmountReais) } : {}),
    }),
});

const updatePlannedFinancialEventSchema = z.object({
  eventId: z.string().describe("The event's id, obtained from a prior getUpcomingFinancialEvents call."),
  lineItemId: z
    .string()
    .describe(
      "Required only if the event has more than one planned line item — obtained from getUpcomingFinancialEvents. Null otherwise.",
    )
    .nullable()
    .default(null),
  budgetAmountReais: z.number().positive().nullable().default(null),
  label: z.string().nullable().default(null),
  startDate: z.string().nullable().default(null),
  endDate: z.string().nullable().default(null),
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
      ...(args.budgetAmountReais !== null ? { budgetAmount: fromReais(args.budgetAmountReais) } : {}),
      ...(args.label ? { label: args.label } : {}),
      ...(args.startDate ? { startDate: args.startDate } : {}),
      ...(args.endDate ? { endDate: args.endDate } : {}),
    }),
});

const createIncomeSchema = z.object({
  label: z.string().min(1).describe("A short label for this income, e.g. 'Salário'."),
  grossAmountReais: z
    .number()
    .positive()
    .describe(
      "The gross monthly amount the user explicitly confirmed, in BRL reais. Never invent this — it must come from the user's own words or their explicit agreement to a getRecurringIncomeCandidates result.",
    ),
  recurring: z
    .boolean()
    .describe("Whether this recurs monthly. True unless the user says otherwise.")
    .nullable()
    .default(null),
  expectedDayOfMonth: z
    .number()
    .int()
    .min(1)
    .max(31)
    .describe(
      "Day of month this income is typically received, only if the user stated one. Null otherwise — never guess. Used to tell an already-received month's occurrence apart from one still expected (DEC-130).",
    )
    .nullable()
    .default(null),
  fromRecurringPattern: z
    .boolean()
    .describe(
      "True when the user is confirming a getRecurringIncomeCandidates pattern Ritmo showed them (sets provenance to USER_CONFIRMED_HISTORY — by the time this tool is ever called, confirmation has already happened, per this tool's own contract); false/null for a plain statement with no candidate involved (USER_DECLARED).",
    )
    .nullable()
    .default(null),
});

const createIncomeTool = tool({
  name: "createIncome",
  description:
    "Declares a confirmed recurring/expected income (e.g. 'sim, esse é meu salário mensal'). Only call this after the user EXPLICITLY confirms — never automatically from an imported transaction, and never merely because getRecurringIncomeCandidates returned a pattern.",
  kind: "MUTATION",
  schema: createIncomeSchema,
  execute: (ctx, args) =>
    mutations.createIncome(ctx.db, ctx.financialProfileId, {
      label: args.label,
      grossAmount: fromReais(args.grossAmountReais),
      ...(args.recurring !== null ? { recurring: args.recurring } : {}),
      ...(args.expectedDayOfMonth !== null ? { expectedDayOfMonth: args.expectedDayOfMonth } : {}),
      // DEC-130 (corrected): this tool only ever executes after explicit
      // user confirmation (its own contract, unchanged since DEC-127) — a
      // confirmed pattern is USER_CONFIRMED_HISTORY, never the bare,
      // unconfirmed HISTORY_INFERRED state.
      source: args.fromRecurringPattern ? "USER_CONFIRMED_HISTORY" : "USER_DECLARED",
    }),
});

const createFixedExpenseSchema = z.object({
  label: z.string().min(1).describe("A short label for this commitment, e.g. 'Condomínio'."),
  category: z.string().min(1).describe("A short spending category, e.g. 'Moradia'."),
  amountReais: z
    .number()
    .positive()
    .describe(
      "The confirmed monthly amount, in BRL reais. Never invent this — it must come from the user's own words or their explicit agreement to a getRecurringFixedExpenseCandidates result.",
    ),
  dueDayOfMonth: z
    .number()
    .int()
    .min(1)
    .max(31)
    .describe("Day of month it's typically due, only if the user stated one. Null otherwise — never guess.")
    .nullable()
    .default(null),
});

const createFixedExpenseTool = tool({
  name: "createFixedExpense",
  description:
    "Declares a confirmed recurring monthly commitment (e.g. rent, a condo fee) the user explicitly agreed to treat as a fixed expense. Only call this after explicit confirmation — never automatically from an imported transaction, and never merely because getRecurringFixedExpenseCandidates returned a pattern.",
  kind: "MUTATION",
  schema: createFixedExpenseSchema,
  execute: (ctx, args) =>
    mutations.createFixedExpense(ctx.db, ctx.financialProfileId, {
      label: args.label,
      category: args.category,
      amount: fromReais(args.amountReais),
      ...(args.dueDayOfMonth !== null ? { dueDayOfMonth: args.dueDayOfMonth } : {}),
    }),
});

// ---------- Categorization / learning (DEC-132) ----------

const categoryMatchTypeEnum = z.enum([
  "EXACT_MERCHANT",
  "CONTAINS_MERCHANT",
  "CONTAINS_DESCRIPTION",
  "REGEX_DESCRIPTION",
]);

const categorizeTransactionSchema = z.object({
  transactionId: z.string().min(1).describe("Obtained from a prior getPendingConfirmations/getRecentSpendingSummary read — never guessed."),
  category: z.string().min(1).describe("The spending category the user chose, e.g. 'Combustível'."),
  subcategory: z.string().describe("Optional finer-grained subcategory.").nullable().default(null),
  alwaysForMerchant: z
    .boolean()
    .describe(
      "True ONLY when the user explicitly agreed this should apply automatically next time (e.g. answering 'sim' to 'Quer que eu classifique X como Y da próxima vez?'). False/null for a one-time correction that changes only this transaction.",
    )
    .nullable()
    .default(null),
});

const categorizeTransactionTool = tool({
  name: "categorizeTransaction",
  description:
    "Answers a pending 'what was this transaction?' question, or corrects a transaction's category. Never changes what kind of money movement it was (a transfer/card payment/investment stays that way) — only its spending category.",
  kind: "MUTATION",
  schema: categorizeTransactionSchema,
  execute: (ctx, args) =>
    mutations.categorizeTransaction(ctx.db, ctx.financialProfileId, {
      transactionId: args.transactionId,
      category: args.category,
      ...(args.subcategory ? { subcategory: args.subcategory } : {}),
      ...(args.alwaysForMerchant !== null ? { alwaysForMerchant: args.alwaysForMerchant } : {}),
    }),
});

const createCategoryRuleSchema = z.object({
  matchType: categoryMatchTypeEnum.describe(
    "How to match: CONTAINS_MERCHANT is the usual choice for a merchant name (e.g. 'UBER'). Use CONTAINS_DESCRIPTION when there's no clean merchant name.",
  ),
  pattern: z.string().min(1).describe("The merchant name or description fragment to match, e.g. 'UBER'."),
  category: z.string().min(1).describe("The spending category to assign, e.g. 'Transporte'."),
  subcategory: z.string().describe("Optional finer-grained subcategory.").nullable().default(null),
});

const createCategoryRuleTool = tool({
  name: "createCategoryRule",
  description:
    "Creates a standing categorization rule directly (e.g. 'sempre que aparecer UBER, classifique como Transporte'), without it being tied to correcting one specific transaction. Only call this on the user's explicit instruction.",
  kind: "MUTATION",
  schema: createCategoryRuleSchema,
  execute: (ctx, args) =>
    mutations.createCategoryRule(ctx.db, {
      matchType: args.matchType,
      pattern: args.pattern,
      category: args.category,
      ...(args.subcategory ? { subcategory: args.subcategory } : {}),
      origin: "USER_DECLARED",
    }),
});

const confirmRecurringIncomeCandidateSchema = z.object({
  candidateId: z.string().min(1).describe("Obtained from a prior getRecurringIncomeCandidates/getPendingConfirmations read — never guessed."),
  label: z.string().min(1).describe("A short label for this income, e.g. 'Salário'."),
  expectedDayOfMonth: z
    .number()
    .int()
    .min(1)
    .max(31)
    .describe("Day of month this income is typically received, only if known/observable. Null otherwise.")
    .nullable()
    .default(null),
});

const confirmRecurringIncomeCandidateTool = tool({
  name: "confirmRecurringIncomeCandidate",
  description:
    "Confirms a pattern Ritmo detected (e.g. 'SMART FIT parece ser um gasto mensal — confirmar?' for income) as real recurring income, creating it with USER_CONFIRMED_HISTORY provenance. Only call this after the user explicitly agrees.",
  kind: "MUTATION",
  schema: confirmRecurringIncomeCandidateSchema,
  execute: (ctx, args) =>
    mutations.confirmRecurringIncomeCandidate(ctx.db, ctx.financialProfileId, {
      candidateId: args.candidateId,
      label: args.label,
      ...(args.expectedDayOfMonth !== null ? { expectedDayOfMonth: args.expectedDayOfMonth } : {}),
    }),
});

const confirmRecurringFixedExpenseCandidateSchema = z.object({
  candidateId: z.string().min(1).describe("Obtained from a prior getRecurringFixedExpenseCandidates/getPendingConfirmations read — never guessed."),
  label: z.string().min(1).describe("A short label for this commitment, e.g. 'Academia'."),
  category: z.string().min(1).describe("The spending category, e.g. 'Saúde'."),
  dueDayOfMonth: z
    .number()
    .int()
    .min(1)
    .max(31)
    .describe("Day of month it's typically due, only if known/observable. Null otherwise.")
    .nullable()
    .default(null),
});

const confirmRecurringFixedExpenseCandidateTool = tool({
  name: "confirmRecurringFixedExpenseCandidate",
  description:
    "Confirms a pattern Ritmo detected (e.g. 'SMART FIT parece ser um gasto mensal de R$119,90. Confirmar?') as a real recurring fixed expense, creating it with USER_CONFIRMED_HISTORY provenance. Only call this after the user explicitly agrees.",
  kind: "MUTATION",
  schema: confirmRecurringFixedExpenseCandidateSchema,
  execute: (ctx, args) =>
    mutations.confirmRecurringFixedExpenseCandidate(ctx.db, ctx.financialProfileId, {
      candidateId: args.candidateId,
      label: args.label,
      category: args.category,
      ...(args.dueDayOfMonth !== null ? { dueDayOfMonth: args.dueDayOfMonth } : {}),
    }),
});

const rejectRecurringCandidateSchema = z.object({
  candidateId: z.string().min(1).describe("Obtained from a prior getRecurringIncomeCandidates/getRecurringFixedExpenseCandidates/getPendingConfirmations read."),
  kind: z.enum(["INCOME", "FIXED_EXPENSE"]).describe("Which pool this candidate belongs to."),
});

const rejectRecurringCandidateTool = tool({
  name: "rejectRecurringCandidate",
  description:
    "Dismisses a recurring pattern Ritmo detected — the user said it's NOT a real recurring commitment/income. Never creates any planning knowledge; the same evidence won't be asked about again unless it materially changes.",
  kind: "MUTATION",
  schema: rejectRecurringCandidateSchema,
  execute: (ctx, args) =>
    mutations.rejectRecurringCandidate(ctx.db, ctx.financialProfileId, args.candidateId, args.kind),
});

const getPendingConfirmationsTool = tool({
  name: "getPendingConfirmations",
  description:
    "Everything Ritmo needs a human answer for: uncategorized transactions, detected recurring income/expense patterns awaiting confirmation, and pending recommendations.",
  kind: "READ",
  schema: z.object({}),
  execute: (ctx) => queries.getPendingConfirmations(ctx.db, ctx.financialProfileId, ctx.asOfDate),
});

const replanAfterExpenseSchema = z.object({
  previousTargetReais: z.number().nonnegative().describe("What was previously recommended, in BRL reais."),
  actualExpenseReais: z.number().positive().describe("What the user says they actually spent, in BRL reais."),
  merchantOrDescription: z.string().min(1).describe("Where or what the money was spent on."),
  category: z.string().describe("The spending category, e.g. 'Date night'."),
  date: z
    .string()
    .describe("ISO 8601 date the expense happened. Null defaults to today.")
    .nullable()
    .default(null),
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

// ---------- Recommendations (Sprint 5) ----------

const getRecommendationsTool = tool({
  name: "getRecommendations",
  description:
    "Returns the user's financial recommendations grouped by status (pending, awaiting verification, verified, failed, rejected) plus aggregate potential/accepted/verified monthly savings. Use this for questions like 'is there anything I could cut?' or 'do I have a subscription that's weighing on me?'. Read-only — never mutates anything.",
  kind: "READ",
  schema: emptySchema,
  execute: (ctx) => queries.getRecommendationsSummary(ctx.db, ctx.financialProfileId),
});

const getRecommendationDetailsSchema = z.object({
  recommendationId: z.string().min(1).describe("The recommendation's id, obtained from a prior getRecommendations call."),
});

const getRecommendationDetailsTool = tool({
  name: "getRecommendationDetails",
  description:
    "Returns one recommendation's full deterministic evidence (merchant, cadence, observed amount, occurrences, confidence) and impact — use this to answer 'why are you recommending this?' or 'how much would I save?'. Read-only.",
  kind: "READ",
  schema: getRecommendationDetailsSchema,
  execute: (ctx, args) =>
    queries.getRecommendationDetails(ctx.db, ctx.financialProfileId, args.recommendationId),
});

const acceptRecommendationSchema = z.object({
  recommendationId: z.string().min(1).describe("The recommendation's id, obtained from a prior getRecommendations call."),
  effectiveDate: z
    .string()
    .describe("Only set this if the user explicitly stated a future start date (e.g. 'starting next month'). Null defaults to today — never guess a date the user didn't state.")
    .nullable()
    .default(null),
});

const acceptRecommendationTool = tool({
  name: "acceptRecommendation",
  description:
    "Records that the user AGREES with a recommendation exactly as proposed (e.g. 'yes, cancel it' / 'pode aceitar'). This does NOT contact any merchant or perform an external cancellation — it only records the user's intent and schedules deterministic verification against future imported transactions. It also does NOT change current Safe-to-Spend. Only call this for a PENDING recommendation the user has just explicitly agreed to.",
  kind: "MUTATION",
  schema: acceptRecommendationSchema,
  execute: (ctx, args) =>
    recommendationService.acceptRecommendation(ctx.db, {
      financialProfileId: ctx.financialProfileId,
      recommendationId: args.recommendationId,
      ...(args.effectiveDate ? { effectiveDate: args.effectiveDate } : {}),
    }),
});

const modifyRecommendationSchema = z.object({
  recommendationId: z.string().min(1).describe("The recommendation's id, obtained from a prior getRecommendations call."),
  targetAmountReais: z
    .number()
    .positive()
    .describe("Only set this if the user stated a specific new target amount to reduce to (e.g. 'reduce it to R$30'). Never invent a lower price yourself — null if not stated.")
    .nullable()
    .default(null),
  effectiveDate: z
    .string()
    .describe("Only set this if the user explicitly stated a different start date (e.g. 'only starting next month'). Null if not stated.")
    .nullable()
    .default(null),
  note: z.string().nullable().default(null),
});

const modifyRecommendationTool = tool({
  name: "modifyRecommendation",
  description:
    "Records that the user accepted the CONCEPT of a recommendation but changed an actionable detail — a reduction target amount and/or a delayed start date (e.g. 'I don't want to cancel it, but reduce it to R$30' or 'cancel it, but only next month'). Never invents a target amount or date the user didn't state. Does NOT change current Safe-to-Spend.",
  kind: "MUTATION",
  schema: modifyRecommendationSchema,
  execute: (ctx, args) =>
    recommendationService.modifyRecommendation(ctx.db, {
      financialProfileId: ctx.financialProfileId,
      recommendationId: args.recommendationId,
      ...(args.targetAmountReais !== null ? { targetAmount: fromReais(args.targetAmountReais) } : {}),
      ...(args.effectiveDate ? { effectiveDate: args.effectiveDate } : {}),
      ...(args.note ? { note: args.note } : {}),
    }),
});

const rejectRecommendationSchema = z.object({
  recommendationId: z.string().min(1).describe("The recommendation's id, obtained from a prior getRecommendations call."),
  reason: z.string().nullable().default(null),
});

const rejectRecommendationTool = tool({
  name: "rejectRecommendation",
  description:
    "Records that the user explicitly does NOT want this recommendation (e.g. 'don't touch that subscription' / 'não quero mexer nisso'). The same unchanged recommendation will not resurface later. Only call this for an explicit rejection, never for ambiguous or hypothetical language.",
  kind: "MUTATION",
  schema: rejectRecommendationSchema,
  execute: (ctx, args) =>
    recommendationService.rejectRecommendation(
      ctx.db,
      ctx.financialProfileId,
      args.recommendationId,
      args.reason ?? undefined,
    ),
});

// ---------- Concierge (Sprint 6) ----------
//
// NON-NEGOTIABLE: the financial envelope (getConciergeBudget) is always
// resolved deterministically BEFORE any search — searchPlaces/
// buildConciergePlans internally call it themselves; the LLM never
// computes or overrides a budget figure. See docs/CONCIERGE.md.

const activityTypeEnum = z.enum(["DINING", "DRINKS", "LODGING", "ENTERTAINMENT", "GENERIC_OUTING"]);
const paymentResponsibilityEnum = z.enum(["SELF_ONLY", "FULL_PARTY", "PARTIAL", "UNKNOWN"]);

const getConciergeBudgetSchema = z.object({
  userExplicitBudgetReais: z
    .number()
    .positive()
    .describe("Only set if the user stated a specific max budget (e.g. 'no máximo R$250'). Null if not stated — never invent one.")
    .nullable()
    .default(null),
});

const getConciergeBudgetTool = tool({
  name: "getConciergeBudget",
  description:
    "Returns the deterministic recommended amount and caution ceiling for a discretionary outing today. ALWAYS call this (directly, or implicitly via searchPlaces/buildConciergePlans) before discussing how much the user can spend on an outing — never state a budget figure yourself.",
  kind: "READ",
  schema: getConciergeBudgetSchema,
  execute: (ctx, args) =>
    conciergeService.getConciergeBudget(
      ctx.db,
      ctx.financialProfileId,
      ctx.asOfDate,
      args.userExplicitBudgetReais !== null ? Math.round(args.userExplicitBudgetReais * 100) : undefined,
    ),
});

const searchPlacesSchema = z.object({
  activityType: activityTypeEnum,
  location: z
    .string()
    .min(1)
    .describe("City/neighborhood text, e.g. 'Campinas', 'Barão Geraldo'. If the user hasn't stated one, ASK them first in plain text — never guess a city."),
  partySize: z.number().int().positive().nullable().default(null),
  preferences: z.array(z.string()).describe("e.g. ['quiet', 'romantic']. Only from the user's own words.").nullable().default(null),
  avoidances: z.array(z.string()).nullable().default(null),
  dateTime: z.string().describe("ISO 8601 date-time, when known.").nullable().default(null),
  userExplicitBudgetReais: z.number().positive().nullable().default(null),
});

const searchPlacesTool = tool({
  name: "searchPlaces",
  description:
    "Searches for real-world venues of ONE activity type, within the user's financial envelope. Never invents a venue, price, address, or rating — only returns provider evidence. Requires a location.",
  kind: "READ",
  schema: searchPlacesSchema,
  execute: (ctx, args) =>
    conciergeService.searchConciergePlaces(ctx.db, ctx.financialProfileId, ctx.asOfDate, args.activityType, {
      location: args.location,
      ...(args.partySize !== null ? { partySize: args.partySize } : {}),
      ...(args.preferences ? { preferences: args.preferences } : {}),
      ...(args.avoidances ? { avoidances: args.avoidances } : {}),
      ...(args.dateTime ? { dateTime: args.dateTime } : {}),
      ...(args.userExplicitBudgetReais !== null
        ? { userExplicitBudgetCents: Math.round(args.userExplicitBudgetReais * 100) }
        : {}),
    }),
});

const buildConciergePlansSchema = z.object({
  requiredComponents: z
    .array(activityTypeEnum)
    .min(1)
    .describe("Activity types the user has clearly committed to, e.g. ['DINING']. Never invent a component the user didn't mention."),
  optionalComponents: z
    .array(activityTypeEnum)
    .describe("Activity types the user mentioned as maybe/possibly (e.g. 'talvez motel' -> ['LODGING']). Empty if none.")
    .nullable()
    .default(null),
  location: z.string().min(1).describe("City/neighborhood. If the user hasn't stated one, ask them first instead of calling this tool."),
  partySize: z
    .number()
    .int()
    .positive()
    .describe("Only set if inferable from the user's own words (e.g. 'vou sair com uma garota' implies 2). Never assume 2 by default.")
    .nullable()
    .default(null),
  paymentResponsibility: paymentResponsibilityEnum
    .describe("FULL_PARTY only when the user explicitly expects to pay for everyone (e.g. 'vou pagar o jantar'). UNKNOWN otherwise — never assume splitting or full payment without a stated signal.")
    .nullable()
    .default(null),
  userExplicitBudgetReais: z.number().positive().describe("Only if the user stated a specific max amount. Never invent one.").nullable().default(null),
  preferences: z.array(z.string()).nullable().default(null),
  avoidances: z.array(z.string()).nullable().default(null),
  dateTime: z.string().nullable().default(null),
});

const buildConciergePlansTool = tool({
  name: "buildConciergePlans",
  description:
    "Given the user's decided outing intent, resolves the financial envelope, searches real venues for each required/optional component, and returns deterministic combined plans with a budget-fit classification (WITHIN_RECOMMENDED/WITHIN_CAUTION/HIGH_IMPACT/EXCEEDS_LIMIT/UNKNOWN_COST) for each. The LLM never computes cost totals or budget fit itself — only this tool's deterministic output. Requires a location; never invents required/optional components, party size, or payment responsibility beyond what the user's own words support.",
  kind: "READ",
  schema: buildConciergePlansSchema,
  execute: (ctx, args) =>
    conciergeService.buildConciergePlansForProfile(ctx.db, ctx.financialProfileId, ctx.asOfDate, {
      requiredComponents: args.requiredComponents,
      optionalComponents: args.optionalComponents ?? [],
      location: args.location,
      ...(args.partySize !== null ? { partySize: args.partySize } : {}),
      paymentResponsibility: args.paymentResponsibility ?? "UNKNOWN",
      ...(args.userExplicitBudgetReais !== null
        ? { userExplicitBudgetCents: Math.round(args.userExplicitBudgetReais * 100) }
        : {}),
      ...(args.preferences ? { preferences: args.preferences } : {}),
      ...(args.avoidances ? { avoidances: args.avoidances } : {}),
      ...(args.dateTime ? { dateTime: args.dateTime } : {}),
    }),
});

const evaluateConciergePlanSchema = z.object({
  sessionId: z.string().min(1).describe("From a prior buildConciergePlans tool result."),
  planId: z.string().min(1).describe("From a prior buildConciergePlans tool result."),
});

const evaluateConciergePlanTool = tool({
  name: "evaluateConciergePlan",
  description:
    "Re-checks whether a previously-built plan's budget fit is still valid against the user's CURRENT financial state — use when the user returns to an old plan or asks 'isso ainda cabe no meu orçamento?'. Never assume an old plan is still valid without calling this.",
  kind: "READ",
  schema: evaluateConciergePlanSchema,
  execute: (ctx, args) =>
    conciergeService.reevaluateConciergePlan(ctx.db, ctx.financialProfileId, ctx.asOfDate, args.sessionId, args.planId),
});

const saveConciergePlanSchema = z.object({
  sessionId: z.string().min(1).describe("From a prior buildConciergePlans tool result."),
  planId: z.string().min(1).describe("From a prior buildConciergePlans tool result."),
});

const saveConciergePlanTool = tool({
  name: "saveConciergePlan",
  description:
    "Records that the user selected/decided on a specific plan (e.g. 'vamos com a opção B'). This does NOT book anything, contact any merchant, or spend money — it only saves the user's choice for later reference. Only call this for an explicit selection.",
  kind: "MUTATION",
  schema: saveConciergePlanSchema,
  execute: (ctx, args) => conciergeService.saveConciergePlan(ctx.db, ctx.financialProfileId, args.sessionId, args.planId),
});

const reservePlanBudgetSchema = z.object({
  label: z.string().min(1),
  amountReais: z
    .number()
    .positive()
    .describe("The amount the user explicitly wants to reserve (e.g. from 'separa R$250 para isso'). Never invent this."),
  startDate: z.string().describe("ISO 8601 date. Null defaults to today.").nullable().default(null),
  endDate: z.string().nullable().default(null),
});

const reservePlanBudgetTool = tool({
  name: "reservePlanBudget",
  description:
    "Reserves a planned budget amount for an outing (e.g. 'separa R$250 para hoje à noite') using the existing planned-event mechanism. This is a FUTURE reservation, never an actual recorded expense — use recordManualTransaction instead if the user says they already spent the money.",
  kind: "MUTATION",
  schema: reservePlanBudgetSchema,
  execute: (ctx, args) =>
    conciergeService.reservePlanBudget(ctx.db, ctx.financialProfileId, {
      label: args.label,
      amountCents: Math.round(args.amountReais * 100),
      startDate: args.startDate ?? ctx.asOfDate,
      ...(args.endDate ? { endDate: args.endDate } : {}),
    }),
});

// ---------- Alerts / notifications (Sprint 7) ----------
//
// NON-NEGOTIABLE: alert CREATION/lifecycle is 100% deterministic
// (`evaluateAlerts`/`alert-service.ts`) — the AI may only read, explain,
// mark-seen, dismiss, or re-check an alert that ALREADY exists. No tool
// here can create, resolve, or decide the severity of an alert. See
// docs/ALERTS-NOTIFICATIONS.md.

/** Every monetary figure ONE `Alert`'s evidence carries — colocated here per the Sprint 7 declarative-grounding pattern (see `ToolDefinition.extractFacts`'s doc comment). */
function alertFacts(alert: alertService.Alert): FinancialFact[] {
  const sourceTool = "alert";
  const evidence = alert.evidence;
  switch (evidence.kind) {
    case "SAFE_TO_SPEND_MATERIAL_DROP":
      return [
        { label: `${alert.title}: previous Safe-to-Spend`, amountCents: evidence.previousCents, certainty: "HIGH", sourceTool, semanticType: "SAFE_TO_SPEND" },
        { label: `${alert.title}: current Safe-to-Spend`, amountCents: evidence.currentCents, certainty: "HIGH", sourceTool, semanticType: "SAFE_TO_SPEND" },
        { label: `${alert.title}: change`, amountCents: evidence.deltaCents, certainty: "HIGH", sourceTool, semanticType: "SAFE_TO_SPEND" },
      ];
    case "RECOMMENDATION_DECISION":
      return [
        { label: `${alert.title}: observed amount`, amountCents: evidence.observedAmountCents, certainty: "HIGH", sourceTool, semanticType: "RECOMMENDATION_OBSERVED_AMOUNT" },
        { label: `${alert.title}: monthly impact`, amountCents: evidence.projectedMonthlyImpactCents, certainty: "HIGH", sourceTool, semanticType: "RECOMMENDATION_MONTHLY_IMPACT" },
      ];
    case "UPCOMING_EVENT_PRESSURE":
      return [{ label: `${alert.title}: known cost`, amountCents: evidence.knownCostCents, certainty: "HIGH", sourceTool, semanticType: "EVENT_RESERVATION" }];
    case "UPCOMING_EVENT_UNKNOWN_COST":
    case "LIQUIDITY_COVERAGE_DEGRADED":
    case "CONNECTION_NEEDS_ATTENTION":
    case "STALE_CONCIERGE_PLAN":
      return []; // No monetary figure in this alert type's evidence.
  }
}

function alertListFacts(alerts: readonly alertService.Alert[]): FinancialFact[] {
  return alerts.flatMap(alertFacts);
}

const getAlertsSchema = z.object({
  includeHistory: z
    .boolean()
    .describe("Set true to also include DISMISSED/RESOLVED alerts (history). Null/false returns only currently-active alerts.")
    .nullable()
    .default(null),
});

const getAlertsTool = tool({
  name: "getAlerts",
  description:
    "Returns the user's currently-active alerts (deterministically created and ranked — never invented), plus an unread count. Use this for 'tenho algum alerta?' or 'o que precisa da minha atenção?'. Read-only.",
  kind: "READ",
  schema: getAlertsSchema,
  execute: async (ctx, args) => {
    const all = await alertService.listAlertsForProfile(ctx.db, ctx.financialProfileId);
    const active = alertService.activeAlerts(all);
    const ranked = alertService.rankAlerts(active, new Date().toISOString()).map((r) => r.alert);
    const unreadCount = active.filter((a) => a.status === "ACTIVE_UNSEEN").length;
    return {
      active: ranked,
      unreadCount,
      ...(args.includeHistory ? { history: all.filter((a) => a.status === "DISMISSED" || a.status === "RESOLVED") } : {}),
    };
  },
  extractFacts: (result) => {
    const r = result as { active: alertService.Alert[]; history?: alertService.Alert[] };
    return alertListFacts([...r.active, ...(r.history ?? [])]);
  },
});

const getAlertDetailsSchema = z.object({
  alertId: z.string().min(1).describe("The alert's id, obtained from a prior getAlerts call."),
});

const getAlertDetailsTool = tool({
  name: "getAlertDetails",
  description:
    "Returns one alert's full deterministic evidence — use this to answer 'por que você está me avisando disso?'. Never invent a cause beyond what this returns. Read-only.",
  kind: "READ",
  schema: getAlertDetailsSchema,
  execute: (ctx, args) => alertService.getAlertById(ctx.db, ctx.financialProfileId, args.alertId),
  extractFacts: (result) => (result ? alertFacts(result as alertService.Alert) : []),
});

const markAlertSeenSchema = z.object({
  alertId: z.string().min(1).describe("The alert's id, obtained from a prior getAlerts call."),
});

const markAlertSeenTool = tool({
  name: "markAlertSeen",
  description:
    "Marks an alert as seen (e.g. 'pode marcar como visto'). Only call this on the user's own explicit instruction — never merely because the user asked about the alert.",
  kind: "MUTATION",
  schema: markAlertSeenSchema,
  execute: (ctx, args) => alertService.markAlertSeen(ctx.db, ctx.financialProfileId, args.alertId),
  extractFacts: (result) => alertFacts(result as alertService.Alert),
});

const dismissAlertSchema = z.object({
  alertId: z.string().min(1).describe("The alert's id, obtained from a prior getAlerts call."),
  reason: z.string().nullable().default(null),
});

const dismissAlertTool = tool({
  name: "dismissAlert",
  description:
    "Dismisses an alert the user explicitly wants to stop seeing (e.g. 'pode ignorar esse alerta'). This does NOT mean the underlying condition is resolved — only that the user chose not to keep seeing it. Only call this for an explicit decision, never a hypothetical ('e se eu ignorasse?').",
  kind: "MUTATION",
  schema: dismissAlertSchema,
  execute: (ctx, args) =>
    alertService.dismissAlert(ctx.db, ctx.financialProfileId, args.alertId, args.reason ?? undefined),
  extractFacts: (result) => alertFacts(result as alertService.Alert),
});

const reevaluateAlertContextSchema = z.object({
  alertId: z.string().min(1).describe("The alert's id, obtained from a prior getAlerts call."),
});

const reevaluateAlertContextTool = tool({
  name: "reevaluateAlertContext",
  description:
    "Re-checks whether an alert's underlying condition is still true against the user's CURRENT financial state (e.g. 'isso ainda se aplica?'). May return the alert as RESOLVED if the condition no longer holds. Read-only — never mutates anything beyond what the deterministic engine would already do on its own.",
  kind: "READ",
  schema: reevaluateAlertContextSchema,
  execute: (ctx, args) => alertService.reevaluateAlertContext(ctx.db, ctx.financialProfileId, ctx.asOfDate, args.alertId),
  extractFacts: (result) => alertFacts(result as alertService.Alert),
});

const notificationCategoryEnum = z.enum(["FINANCIAL_CHANGE", "PLANNED_EVENTS", "RECOMMENDATIONS", "CONNECTION_HEALTH", "CONCIERGE"]);

const updateNotificationPreferenceSchema = z.object({
  category: notificationCategoryEnum.describe("Which alert category to change (e.g. CONCIERGE for 'não quero mais alertas de concierge')."),
  enabled: z.boolean().describe("true to enable, false to disable — must match exactly what the user asked for."),
});

const updateNotificationPreferenceTool = tool({
  name: "updateNotificationPreference",
  description:
    "Enables or disables in-app alerts for one category (e.g. 'não quero mais alertas de concierge'). Only call this for the user's own explicit preference statement — never infer a preference from a single complaint about one alert.",
  kind: "MUTATION",
  schema: updateNotificationPreferenceSchema,
  execute: (ctx, args) => updateNotificationPreferences(ctx.db, ctx.financialProfileId, { category: args.category, enabled: args.enabled }),
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
  getRecurringIncomeCandidatesTool,
  getRecurringFixedExpenseCandidatesTool,
  getCategoryBudgetStatusTool,
  getRecentSpendingSummaryTool,
  recordManualTransactionTool,
  createPlannedFinancialEventTool,
  updatePlannedFinancialEventTool,
  createIncomeTool,
  createFixedExpenseTool,
  categorizeTransactionTool,
  createCategoryRuleTool,
  confirmRecurringIncomeCandidateTool,
  confirmRecurringFixedExpenseCandidateTool,
  rejectRecurringCandidateTool,
  getPendingConfirmationsTool,
  replanAfterExpenseTool,
  getRecommendationsTool,
  getRecommendationDetailsTool,
  acceptRecommendationTool,
  modifyRecommendationTool,
  rejectRecommendationTool,
  getConciergeBudgetTool,
  searchPlacesTool,
  buildConciergePlansTool,
  evaluateConciergePlanTool,
  saveConciergePlanTool,
  reservePlanBudgetTool,
  getAlertsTool,
  getAlertDetailsTool,
  markAlertSeenTool,
  dismissAlertTool,
  reevaluateAlertContextTool,
  updateNotificationPreferenceTool,
] as unknown as readonly ToolDefinition<never, unknown>[];

export function findTool(name: string): ToolDefinition<unknown, unknown> | undefined {
  return TOOL_REGISTRY.find((t) => t.name === name) as ToolDefinition<unknown, unknown> | undefined;
}
