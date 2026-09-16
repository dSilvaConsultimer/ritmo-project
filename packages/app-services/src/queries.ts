import type { Id } from "@money-copilot/shared";
import type {
  Category,
  CategoryRule,
  Recommendation,
  RecommendationType,
  RecurringCandidateConfidence,
  TransactionDirection,
} from "@money-copilot/financial-engine";
import {
  buildFinancialSnapshot,
  buildFinancialPositionFromAccounts,
  breakdownEvent,
  categorySpendingTransactions,
  compareLifestyles,
  detectRecurringCandidates,
  getCategoryBudgetStatus,
  getGoalStatus,
  getSpendingEnvelope,
  getDailyGuidance,
  isConsumptionLike,
  isSameMonth,
  monthlyCategoryTotals,
  monthlyTransactionList,
  reconciliationCandidates,
  simulateExpense,
  uncategorizedTransactions,
  unknownFinancialPosition,
  ZERO,
  sum,
  type CategoryBudgetStatus,
  type CategoryHeadroom,
  type DailyGuidance,
  type EventReserveBreakdown,
  type ExpenseSimulationInput,
  type ExpenseSimulationResult,
  type FinancialEvent,
  type FinancialSnapshot,
  type FinancialPosition,
  type GoalStatus,
  type LifestyleComparisonResult,
  type Money,
  type SafeToSpend,
  type SpendingEnvelope,
  type CategoryTotal,
  type FinancialTransaction,
  type ReconciliationLink,
  type RecurringExpenseCandidate,
  type ProviderConnection,
  type FixedExpense,
  type Income,
} from "@money-copilot/financial-engine";
import * as repo from "@money-copilot/persistence";
import type { Database } from "@money-copilot/persistence";
import { assertOwnedByProfile } from "./ownership";

/**
 * The application/query service layer: every read the UI (or a future
 * LLM tool, per Sprint 4) needs, expressed as a plain async function over
 * a profile id — never a React component or Next.js route talking to
 * Drizzle directly. See docs/ARCHITECTURE.md, "Application service layer."
 */

async function resolvePosition(
  db: Database,
  financialProfileId: string,
  asOfDate: string,
): Promise<FinancialPosition> {
  const profileId = financialProfileId as Id<"financial-profile">;
  const stored = await repo.loadFinancialSnapshotInput(db, financialProfileId, asOfDate);
  if (stored.position) return stored.position;

  // Only provider-synced accounts count toward liquidity coverage — a
  // manually-entered PaymentSource (e.g. the fixture's plain "Nubank" used
  // only to categorize transactions) was never expected to carry balance
  // data, so it must not artificially depress coverage to PARTIAL when in
  // fact zero real accounts are connected yet.
  const accounts = (await repo.listPaymentSourcesForProfile(db, financialProfileId)).filter(
    (a) => a.provider !== undefined,
  );
  if (accounts.length === 0) {
    return unknownFinancialPosition(profileId, asOfDate);
  }
  return buildFinancialPositionFromAccounts(
    accounts,
    profileId,
    asOfDate,
    "derived-from-connected-accounts",
  );
}

export async function getFinancialSnapshot(
  db: Database,
  financialProfileId: string,
  asOfDate: string,
): Promise<FinancialSnapshot> {
  const input = await repo.loadFinancialSnapshotInput(db, financialProfileId, asOfDate);
  const position = input.position ?? (await resolvePosition(db, financialProfileId, asOfDate));
  return buildFinancialSnapshot({ ...input, position });
}

/**
 * Sprint 9 (DEC-127): REALIZED income this month — real posted transactions
 * with `financialEffect === "INCOME"`, dated in the same calendar month as
 * `asOfDate`. Deliberately NOT `snapshot.income.gross` (the declared/
 * expected `incomes` table, a forward-looking planning input) — see
 * `apps/ritmo/src/functions/home.ts`'s "Entradas do mês", the concrete
 * product bug this was added to fix: a real, imported salary transaction
 * never showed up there because "Entradas do mês" was reading the wrong,
 * unrelated table. Reversed transactions are excluded, same as every other
 * real-money total in this file. Reconciliation links are deliberately NOT
 * consulted here (unlike `buildFinancialSnapshot`'s `actualSpending`) —
 * reconciliation exists to avoid double-counting a manual entry against its
 * later-imported equivalent, a consumption-side concern; nothing in this
 * codebase creates a manual "income" entry that an imported one could
 * duplicate.
 */
export async function getRealizedIncomeForProfile(
  db: Database,
  financialProfileId: string,
  asOfDate: string,
): Promise<Money> {
  const input = await repo.loadFinancialSnapshotInput(db, financialProfileId, asOfDate);
  const realized = input.transactions.filter(
    (t) => t.financialEffect === "INCOME" && t.status !== "REVERSED" && isSameMonth(t.date, asOfDate),
  );
  return sum(realized.map((t) => t.amount));
}

/**
 * Sprint 9 (DEC-127): candidate patterns of repeated REAL income deposits
 * (e.g. a recurring salary) — evidence only, never a declared `Income`.
 * Filters to `financialEffect === "INCOME"` before reusing
 * `detectRecurringCandidates` unchanged, mirroring exactly how
 * `generateRecommendationCandidates` filters by financial effect before
 * calling the same detector for the (unrelated) recurring-COST case — see
 * that function's own comment. A human must explicitly confirm before this
 * ever becomes a real `Income` row (`mutations.createIncome`) — see
 * docs/AI-COPILOT.md, "Explicit mutation policy."
 */
/**
 * DEC-132: detects candidates fresh from live transactions (unchanged
 * behavior), then reconciles them against the profile's PERSISTED
 * `recurring_candidates` — giving each candidate a STABLE id/status across
 * calls, and making a user's prior CONFIRMED/REJECTED decision durable
 * (previously this package never persisted a single decision — every call
 * re-detected the exact same "fresh" candidates with brand new ids). Only
 * still-`CANDIDATE` items are returned — `detectRecurringCandidates` itself
 * already excludes anything with a resolved decision (see DEC-132's fix in
 * `recurring.ts`).
 */
async function reconcileRecurringCandidates(
  db: Database,
  financialProfileId: string,
  kind: "INCOME" | "FIXED_EXPENSE",
  transactions: readonly FinancialTransaction[],
): Promise<readonly RecurringExpenseCandidate[]> {
  const persisted = await repo.listRecurringCandidatesForProfile(db, financialProfileId, kind);
  const priorDecisions = persisted
    .filter((p) => p.status !== "CANDIDATE")
    .map((p) => ({ evidenceKey: p.evidenceKey, status: p.status as "CONFIRMED" | "REJECTED" }));

  const detected = detectRecurringCandidates(transactions, priorDecisions);
  const reconciled: RecurringExpenseCandidate[] = [];
  for (const candidate of detected) {
    reconciled.push(await repo.upsertRecurringCandidate(db, candidate, financialProfileId, kind));
  }
  return reconciled;
}

export async function getRecurringIncomeCandidates(
  db: Database,
  financialProfileId: string,
  asOfDate: string,
): Promise<readonly RecurringExpenseCandidate[]> {
  const input = await repo.loadFinancialSnapshotInput(db, financialProfileId, asOfDate);
  const incomeTransactions = input.transactions.filter((t) => t.financialEffect === "INCOME");
  return reconcileRecurringCandidates(db, financialProfileId, "INCOME", incomeTransactions);
}

/**
 * Sprint 9 (DEC-127): candidate patterns of repeated REAL debits (e.g. rent,
 * a condo fee) that might be a `FixedExpense` — evidence only, never a
 * declared commitment. Filters to `financialEffect === "CONSUMPTION"`
 * specifically (not the broader `isConsumptionLike` set — a fixed
 * commitment is a genuine purchase/obligation, not a debt payment or bank
 * fee) before reusing `detectRecurringCandidates` unchanged. A human must
 * explicitly confirm before this ever becomes a real `FixedExpense` row
 * (`mutations.createFixedExpense`).
 */
export async function getRecurringFixedExpenseCandidates(
  db: Database,
  financialProfileId: string,
  asOfDate: string,
): Promise<readonly RecurringExpenseCandidate[]> {
  const input = await repo.loadFinancialSnapshotInput(db, financialProfileId, asOfDate);
  const consumptionTransactions = input.transactions.filter((t) => t.financialEffect === "CONSUMPTION");
  return reconcileRecurringCandidates(db, financialProfileId, "FIXED_EXPENSE", consumptionTransactions);
}

/**
 * DEC-132: "Ritmo precisa confirmar" — the ONE aggregated, canonical list of
 * everything Ritmo needs a human answer for, spanning three previously
 * separate/unsurfaced mechanisms (never a new fourth pending-task system):
 * uncategorized transactions (`getUncategorizedTransactions` — pre-existing,
 * previously wired only into `apps/web`), recurring income/expense
 * candidates (`getRecurringIncomeCandidates`/`getRecurringFixedExpenseCandidates`
 * above), and pending Recommendations (`getRecommendationsSummary` —
 * pre-existing, previously only interactive in `apps/web`). A caller resolves
 * each item via the mutation matching its `kind` — see
 * `mutations.categorizeTransaction`/`confirmRecurringIncomeCandidate`/
 * `confirmRecurringFixedExpenseCandidate`/`rejectRecurringCandidate`, and the
 * pre-existing `acceptRecommendation`/`modifyRecommendation`/`rejectRecommendation`.
 */
export type PendingConfirmation =
  | {
      readonly kind: "UNCATEGORIZED_TRANSACTION";
      readonly transactionId: string;
      readonly description: string;
      readonly amount: Money;
      readonly direction: TransactionDirection;
      readonly date: string;
    }
  | {
      readonly kind: "RECURRING_INCOME_CANDIDATE";
      readonly candidateId: string;
      readonly merchant: string;
      readonly amount: Money;
      readonly occurrences: number;
      readonly confidence: RecurringCandidateConfidence;
    }
  | {
      readonly kind: "RECURRING_EXPENSE_CANDIDATE";
      readonly candidateId: string;
      readonly merchant: string;
      readonly amount: Money;
      readonly occurrences: number;
      readonly confidence: RecurringCandidateConfidence;
    }
  | {
      readonly kind: "RECOMMENDATION";
      readonly recommendationId: string;
      readonly title: string;
      readonly description?: string;
      readonly recommendationType: RecommendationType;
    };

export async function getPendingConfirmations(
  db: Database,
  financialProfileId: string,
  asOfDate: string,
): Promise<readonly PendingConfirmation[]> {
  const [uncategorized, incomeCandidates, expenseCandidates, recommendations] = await Promise.all([
    getUncategorizedTransactions(db, financialProfileId, asOfDate),
    getRecurringIncomeCandidates(db, financialProfileId, asOfDate),
    getRecurringFixedExpenseCandidates(db, financialProfileId, asOfDate),
    getRecommendationsSummary(db, financialProfileId),
  ]);

  const items: PendingConfirmation[] = [];
  for (const t of uncategorized) {
    items.push({
      kind: "UNCATEGORIZED_TRANSACTION",
      transactionId: t.id,
      description: t.normalizedDescription || t.rawDescription,
      amount: t.amount,
      direction: t.direction,
      date: t.date,
    });
  }
  for (const c of incomeCandidates) {
    items.push({
      kind: "RECURRING_INCOME_CANDIDATE",
      candidateId: c.id,
      merchant: c.normalizedMerchant,
      amount: c.evidence.averageAmount,
      occurrences: c.evidence.occurrences,
      confidence: c.confidence,
    });
  }
  for (const c of expenseCandidates) {
    items.push({
      kind: "RECURRING_EXPENSE_CANDIDATE",
      candidateId: c.id,
      merchant: c.normalizedMerchant,
      amount: c.evidence.averageAmount,
      occurrences: c.evidence.occurrences,
      confidence: c.confidence,
    });
  }
  for (const r of recommendations.pending) {
    items.push({
      kind: "RECOMMENDATION",
      recommendationId: r.id,
      title: r.title,
      ...(r.description ? { description: r.description } : {}),
      recommendationType: r.type,
    });
  }
  return items;
}

export async function getSafeToSpendBreakdown(
  db: Database,
  financialProfileId: string,
  asOfDate: string,
) {
  const snapshot = await getFinancialSnapshot(db, financialProfileId, asOfDate);
  return snapshot.safeToSpendBreakdown;
}

export async function getFinancialPosition(
  db: Database,
  financialProfileId: string,
  asOfDate: string,
): Promise<FinancialPosition> {
  return resolvePosition(db, financialProfileId, asOfDate);
}

export async function getTransactions(
  db: Database,
  financialProfileId: string,
  asOfDate: string,
): Promise<readonly FinancialTransaction[]> {
  const input = await repo.loadFinancialSnapshotInput(db, financialProfileId, asOfDate);
  return monthlyTransactionList(input.transactions, asOfDate);
}

/**
 * DEC-129: the Extrato screen's full, all-time ledger for a profile —
 * unlike `getTransactions` (current month only, via `monthlyTransactionList`),
 * this is never date-windowed. A pure read model over `financial_transactions`
 * (never mutates it); every status included, matching
 * `monthlyTransactionList`'s own "nothing is hidden" contract — just ordered
 * newest first instead of oldest first, since a ledger is read backwards
 * from "now."
 */
export async function getTransactionHistory(
  db: Database,
  financialProfileId: string,
  asOfDate: string,
): Promise<readonly FinancialTransaction[]> {
  const input = await repo.loadFinancialSnapshotInput(db, financialProfileId, asOfDate);
  return [...input.transactions].sort(
    (a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt),
  );
}

/**
 * DEC-136: `monthlyCategoryTotals` (financial-engine, DB-agnostic) can only
 * ever build `categoryName` from each transaction's own denormalized
 * `category` string — it has no way to look up a `Category` row. That
 * string is written at categorization time and never updated again, so a
 * category renamed AFTER a transaction was categorized would otherwise
 * still display its old name here. This resolves the canonical, CURRENT
 * `Category.name` for every bucket that has a real `categoryId`, and
 * leaves the denormalized name as-is only for the two cases with no
 * backing `Category` row: the `UNCATEGORIZED` bucket, and a `legacy:<name>`
 * bucket for a transaction categorized before `categoryId` existed and not
 * yet backfilled (see `categoryGroupId`'s own doc comment).
 */
async function resolveCanonicalCategoryNames(
  db: Database,
  financialProfileId: string,
  totals: readonly CategoryTotal[],
): Promise<readonly CategoryTotal[]> {
  const visible = await repo.listCategoriesForProfile(db, financialProfileId);
  const byId = new Map(visible.map((c) => [c.id, c.name]));
  return totals.map((t) => {
    const canonicalName = byId.get(t.categoryId as Id<"category">);
    return canonicalName === undefined ? t : { ...t, categoryName: canonicalName };
  });
}

export async function getCategoryTotals(
  db: Database,
  financialProfileId: string,
  asOfDate: string,
): Promise<readonly CategoryTotal[]> {
  const input = await repo.loadFinancialSnapshotInput(db, financialProfileId, asOfDate);
  const totals = monthlyCategoryTotals(input.transactions, input.reconciliationLinks, asOfDate);
  return resolveCanonicalCategoryNames(db, financialProfileId, totals);
}

/**
 * DEC-135/136: Planning's "Gastos por categoria" drill-down — the real
 * transactions behind one category's total for the given period, using the
 * EXACT SAME filtering `getCategoryTotals`/`monthlyCategoryTotals` applies
 * (never a separate/looser query), so the list always sums to the total
 * shown alongside it. `categoryId` accepts the literal `UNCATEGORIZED`
 * sentinel for the "uncategorized" filter option — see
 * `CategoryTotal.categoryId`'s own doc comment for what else this can be.
 */
export async function getCategorySpendingDetail(
  db: Database,
  financialProfileId: string,
  asOfDate: string,
  categoryId: string,
): Promise<readonly FinancialTransaction[]> {
  const input = await repo.loadFinancialSnapshotInput(db, financialProfileId, asOfDate);
  return categorySpendingTransactions(input.transactions, input.reconciliationLinks, asOfDate, categoryId);
}

/**
 * DEC-135: every category VISIBLE to this profile (base + personal) — the
 * source list for the CategoryPicker, wherever it's used.
 */
export async function getCategoriesForProfile(
  db: Database,
  financialProfileId: string,
): Promise<readonly Category[]> {
  return repo.listCategoriesForProfile(db, financialProfileId);
}

export async function getUncategorizedTransactions(
  db: Database,
  financialProfileId: string,
  asOfDate: string,
): Promise<readonly FinancialTransaction[]> {
  const input = await repo.loadFinancialSnapshotInput(db, financialProfileId, asOfDate);
  return uncategorizedTransactions(input.transactions, input.reconciliationLinks, asOfDate);
}

export async function getInstallmentCommitments(
  db: Database,
  financialProfileId: string,
  asOfDate: string,
) {
  const snapshot = await getFinancialSnapshot(db, financialProfileId, asOfDate);
  return snapshot.futureInstallmentCommitments;
}

export interface PaymentSourceAuditEntry {
  readonly type: string;
  readonly subtype: string | null;
  readonly hasProvider: boolean;
  readonly hasDistinctExternalAccountId: boolean;
  readonly contributesToLiquidity: boolean;
  readonly isCreditCardLiability: boolean;
}

export interface EntityCounts {
  readonly connections: { readonly count: number; readonly byStatus: Record<string, number> };
  readonly paymentSources: {
    readonly count: number;
    readonly allExternalAccountIdsDistinct: boolean;
    readonly audit: readonly PaymentSourceAuditEntry[];
  };
  readonly transactions: { readonly count: number; readonly consumptionTotalCents: number };
  readonly bills: { readonly count: number };
  readonly installmentPlans: { readonly count: number };
  readonly reconciliationLinks: { readonly count: number };
}

/**
 * Read-only entity counts for verifying sync idempotency (Sprint 4.5,
 * DEC-052 follow-up) without opening a second process against the
 * file-backed PGlite database (forbidden — see DEC-051, PGlite has no
 * arbitration for concurrent process access) and without exposing secrets
 * or provider identifiers.
 */
export async function getEntityCounts(
  db: Database,
  financialProfileId: string,
  asOfDate: string,
): Promise<EntityCounts> {
  const [connections, paymentSources, snapshotInput, bills] = await Promise.all([
    repo.listProviderConnections(db, financialProfileId),
    repo.listPaymentSourcesForProfile(db, financialProfileId),
    repo.loadFinancialSnapshotInput(db, financialProfileId, asOfDate),
    repo.listBillsForProfile(db, financialProfileId),
  ]);

  const connectionsByStatus: Record<string, number> = {};
  for (const c of connections) {
    connectionsByStatus[c.status] = (connectionsByStatus[c.status] ?? 0) + 1;
  }

  const consumptionTotalCents = snapshotInput.transactions
    .filter((t) => isConsumptionLike(t.financialEffect))
    .reduce((total, t) => total + t.amount.cents, 0);

  // Distinctness is a property of the whole set, not any one row — an
  // external account id is only meaningful as evidence against accidental
  // duplication when compared against its siblings (Sprint 4.5 payment-
  // source audit, DEC-053). Sources with no externalAccountId (manually
  // entered, no provider) are excluded from this comparison entirely.
  const externalAccountIds = paymentSources
    .map((p) => p.externalAccountId)
    .filter((id): id is string => id !== undefined);
  const allExternalAccountIdsDistinct = externalAccountIds.length === new Set(externalAccountIds).size;

  const audit: PaymentSourceAuditEntry[] = paymentSources.map((p) => ({
    type: p.type,
    subtype: p.subtype ?? null,
    hasProvider: p.provider !== undefined,
    hasDistinctExternalAccountId:
      p.externalAccountId !== undefined &&
      externalAccountIds.filter((id) => id === p.externalAccountId).length === 1,
    // Mirrors resolvePosition's own filter above: only provider-synced
    // accounts count toward liquidity coverage.
    contributesToLiquidity: p.provider !== undefined,
    isCreditCardLiability: p.type === "CREDIT_CARD",
  }));

  return {
    connections: { count: connections.length, byStatus: connectionsByStatus },
    paymentSources: { count: paymentSources.length, allExternalAccountIdsDistinct, audit },
    transactions: { count: snapshotInput.transactions.length, consumptionTotalCents },
    bills: { count: bills.length },
    installmentPlans: { count: snapshotInput.installmentPlans.length },
    reconciliationLinks: { count: snapshotInput.reconciliationLinks.length },
  };
}

/**
 * Sprint 8 (Ritmo UI): the raw list of confirmed recurring commitments
 * (rent, insurance, subscriptions, etc.) — distinct from
 * `getRecurringCandidates` (detected PATTERNS from transaction history).
 */
export async function getFixedExpensesForProfile(
  db: Database,
  financialProfileId: string,
  asOfDate: string,
): Promise<readonly FixedExpense[]> {
  const input = await repo.loadFinancialSnapshotInput(db, financialProfileId, asOfDate);
  return input.fixedExpenses;
}

/**
 * DEC-132: the raw list of declared/confirmed recurring income (Planning's
 * "Receitas previstas" section) — mirrors `getFixedExpensesForProfile`
 * exactly.
 */
export async function getIncomesForProfile(
  db: Database,
  financialProfileId: string,
  asOfDate: string,
): Promise<readonly Income[]> {
  const input = await repo.loadFinancialSnapshotInput(db, financialProfileId, asOfDate);
  return input.income;
}

/**
 * Sprint 8 (Ritmo UI), DEC-133: how many deterministic categorization rules
 * are VISIBLE to this profile — the global `SYSTEM_DEFAULT` baseline plus
 * this profile's own personal overrides (see `repo.loadRules`). Powers the
 * "Mais" screen's "Categorias e regras" row honestly instead of a
 * hardcoded count.
 */
export async function getCategoryRuleCount(db: Database, financialProfileId: string): Promise<number> {
  const { categoryRules } = await repo.loadRules(db, financialProfileId);
  return categoryRules.length;
}

/**
 * DEC-133: the full list of categorization rules visible to this profile —
 * global `SYSTEM_DEFAULT` rules plus this profile's own personal overrides,
 * never another profile's. Powers Planning's "Regras e categorias" section:
 * view + create + delete (personal rules only — a `SYSTEM_DEFAULT` row is
 * never editable/deletable through this list, see
 * `mutations.deleteCategoryRule`). Sorted by descending priority, matching
 * the tie-breaking order WITHIN each precedence tier `categorize` itself
 * uses (see `packages/financial-engine/src/domain/category.ts`) — personal
 * vs. global ordering itself is a UI concern, not encoded in this sort.
 */
/**
 * DEC-136: `CategoryRule.category` is legacy/denormalized text captured at
 * rule-creation time — resolve it against the CURRENT canonical
 * `Category.name` here (never override the stored row, only what this read
 * returns) so a category rename is reflected immediately, without needing
 * to rewrite every rule that references it. Falls back to the stored
 * string only for a rule with no `categoryId` yet (see
 * `CategoryRule.categoryId`'s own doc comment).
 */
export async function getCategoryRulesList(
  db: Database,
  financialProfileId: string,
): Promise<readonly CategoryRule[]> {
  const { categoryRules } = await repo.loadRules(db, financialProfileId);
  const visible = await repo.listCategoriesForProfile(db, financialProfileId);
  const byId = new Map(visible.map((c) => [c.id, c.name]));
  return categoryRules
    .map((r) => {
      const canonicalName = r.categoryId !== undefined ? byId.get(r.categoryId) : undefined;
      return canonicalName === undefined ? r : { ...r, category: canonicalName };
    })
    .sort((a, b) => b.priority - a.priority);
}

export async function getRecurringCandidates(
  db: Database,
  financialProfileId: string,
  asOfDate: string,
): Promise<readonly RecurringExpenseCandidate[]> {
  const input = await repo.loadFinancialSnapshotInput(db, financialProfileId, asOfDate);
  return detectRecurringCandidates(input.transactions);
}

export async function getReconciliationCandidates(
  db: Database,
  financialProfileId: string,
  asOfDate: string,
): Promise<readonly ReconciliationLink[]> {
  const input = await repo.loadFinancialSnapshotInput(db, financialProfileId, asOfDate);
  return reconciliationCandidates(input.reconciliationLinks);
}

export async function getConnections(
  db: Database,
  financialProfileId: string,
): Promise<readonly ProviderConnection[]> {
  return repo.listProviderConnections(db, financialProfileId);
}

export async function getLatestSyncRunForConnection(
  db: Database,
  financialProfileId: string,
  connectionId: string,
) {
  const connection = await repo.getProviderConnectionById(db, connectionId);
  assertOwnedByProfile(connection, financialProfileId, `connection ${connectionId}`);
  return repo.getLatestSyncRun(db, connectionId);
}

export async function getLifestyleComparison(
  db: Database,
  financialProfileId: string,
  asOfDate: string,
): Promise<LifestyleComparisonResult> {
  const input = await repo.loadFinancialSnapshotInput(db, financialProfileId, asOfDate);
  const { current, independent } = await repo.loadLifestyleScenarios(db, financialProfileId);
  if (!current || !independent) {
    throw new Error(
      `Profile ${financialProfileId} is missing CURRENT_LIFESTYLE/INDEPENDENT_LIVING scenarios`,
    );
  }
  return compareLifestyles(input, current, independent);
}

// ---------- Sprint 4: AI copilot read/simulation tools ----------
// Every function below is a pure READ or SIMULATION over already-committed
// data — none of them mutate anything, so the copilot tool loop may call
// them without requiring explicit user mutation intent. See
// docs/AI-COPILOT.md, "Explicit mutation policy."

export async function getSafeToSpend(
  db: Database,
  financialProfileId: string,
  asOfDate: string,
): Promise<SafeToSpend> {
  const snapshot = await getFinancialSnapshot(db, financialProfileId, asOfDate);
  return snapshot.safeToSpend;
}

export async function getGoalStatusForProfile(
  db: Database,
  financialProfileId: string,
  asOfDate: string,
): Promise<GoalStatus> {
  const input = await repo.loadFinancialSnapshotInput(db, financialProfileId, asOfDate);
  const snapshot = await getFinancialSnapshot(db, financialProfileId, asOfDate);
  return getGoalStatus(input.goal, snapshot);
}

export async function getCategoryBudgetStatusForProfile(
  db: Database,
  financialProfileId: string,
  asOfDate: string,
): Promise<readonly CategoryBudgetStatus[]> {
  const input = await repo.loadFinancialSnapshotInput(db, financialProfileId, asOfDate);
  return getCategoryBudgetStatus(input.variableBudgets, input.transactions, input.reconciliationLinks, asOfDate);
}

export async function getSpendingEnvelopeForProfile(
  db: Database,
  financialProfileId: string,
  asOfDate: string,
  categoryHeadroom?: CategoryHeadroom,
): Promise<SpendingEnvelope> {
  const snapshot = await getFinancialSnapshot(db, financialProfileId, asOfDate);
  return getSpendingEnvelope(snapshot, undefined, categoryHeadroom);
}

export async function getDailyGuidanceForProfile(
  db: Database,
  financialProfileId: string,
  asOfDate: string,
): Promise<DailyGuidance> {
  const snapshot = await getFinancialSnapshot(db, financialProfileId, asOfDate);
  return getDailyGuidance(snapshot);
}

export async function simulateExpenseForProfile(
  db: Database,
  financialProfileId: string,
  asOfDate: string,
  input: ExpenseSimulationInput,
): Promise<ExpenseSimulationResult> {
  const snapshot = await getFinancialSnapshot(db, financialProfileId, asOfDate);
  return simulateExpense(snapshot, input);
}

export interface UpcomingFinancialEvent {
  readonly event: FinancialEvent;
  readonly breakdown: EventReserveBreakdown;
}

/** Events whose window has not fully ended as of `asOfDate` — never invents a budget for one with an UNKNOWN line item. */
export async function getUpcomingFinancialEventsForProfile(
  db: Database,
  financialProfileId: string,
  asOfDate: string,
): Promise<readonly UpcomingFinancialEvent[]> {
  const input = await repo.loadFinancialSnapshotInput(db, financialProfileId, asOfDate);
  return input.events
    .filter((event) => event.endDate >= asOfDate)
    .map((event) => ({ event, breakdown: breakdownEvent(event) }));
}

export interface RecentSpendingSummary {
  readonly fromDate: string;
  readonly toDate: string;
  readonly transactionCount: number;
  readonly total: Money;
  readonly byCategory: readonly CategoryTotal[];
}

function isoDateMinusDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

/**
 * A small, bounded window of recent spending — never the user's entire
 * transaction history. See NON-NEGOTIABLE (Sprint 4) "data minimization":
 * "never send the user's entire transaction history to the LLM by
 * default."
 */
export async function getRecentSpendingSummaryForProfile(
  db: Database,
  financialProfileId: string,
  asOfDate: string,
  days = 7,
): Promise<RecentSpendingSummary> {
  const input = await repo.loadFinancialSnapshotInput(db, financialProfileId, asOfDate);
  const fromDate = isoDateMinusDays(asOfDate, days);
  const relevant = input.transactions.filter(
    (t) => t.date >= fromDate && t.date <= asOfDate && isConsumptionLike(t.financialEffect),
  );

  const byCategory = monthlyCategoryTotals(relevant, input.reconciliationLinks, asOfDate);
  return {
    fromDate,
    toDate: asOfDate,
    transactionCount: relevant.length,
    total: relevant.length > 0 ? sum(relevant.map((t) => t.amount)) : ZERO,
    byCategory: await resolveCanonicalCategoryNames(db, financialProfileId, byCategory),
  };
}

// ---------- Recommendations (Sprint 5) ----------

export interface RecommendationsSummary {
  readonly pending: readonly Recommendation[];
  readonly awaitingVerification: readonly Recommendation[];
  readonly verified: readonly Recommendation[];
  readonly failed: readonly Recommendation[];
  readonly rejected: readonly Recommendation[];
  /**
   * Sum of PENDING `CANCEL_RECURRING_COST`/`REDUCE_RECURRING_COST`
   * `projectedMonthlyImpact` — deliberately EXCLUDES `REVIEW_RECURRING_COST`
   * (never a guaranteed saving, RULE section 3) and anything already
   * decided. A wholly distinct concept from Safe-to-Spend — see
   * docs/RECOMMENDATIONS.md, "Safe-to-Spend separation": accepting a
   * recommendation NEVER moves money from here into actual spendable cash.
   */
  readonly potentialMonthlySavingsCents: number;
  /** Sum of ACCEPTED/MODIFIED `projectedMonthlyImpact` — the user's stated intent, not yet confirmed by evidence. */
  readonly acceptedExpectedMonthlySavingsCents: number;
  /** Sum of VERIFIED `projectedMonthlyImpact` — the only figure backed by confirmed financial evidence. */
  readonly verifiedMonthlySavingsCents: number;
}

export async function getRecommendationsSummary(
  db: Database,
  financialProfileId: string,
): Promise<RecommendationsSummary> {
  const all = await repo.listRecommendationsForProfile(db, financialProfileId);

  const pending = all.filter((r) => r.status === "PENDING");
  const awaitingVerification = all.filter((r) => r.status === "ACCEPTED" || r.status === "MODIFIED");
  const verified = all.filter((r) => r.status === "VERIFIED");
  const failed = all.filter((r) => r.status === "FAILED");
  const rejected = all.filter((r) => r.status === "REJECTED");

  const centsSum = (recs: readonly Recommendation[]): number =>
    recs.reduce((total, r) => total + r.projectedMonthlyImpact.cents, 0);

  return {
    pending,
    awaitingVerification,
    verified,
    failed,
    rejected,
    potentialMonthlySavingsCents: centsSum(pending.filter((r) => r.type !== "REVIEW_RECURRING_COST")),
    acceptedExpectedMonthlySavingsCents: centsSum(awaitingVerification),
    verifiedMonthlySavingsCents: centsSum(verified),
  };
}

export async function getRecommendationDetails(
  db: Database,
  financialProfileId: string,
  recommendationId: string,
): Promise<Recommendation | undefined> {
  const recommendation = await repo.getRecommendationById(db, recommendationId);
  return recommendation && recommendation.financialProfileId === financialProfileId
    ? recommendation
    : undefined;
}
