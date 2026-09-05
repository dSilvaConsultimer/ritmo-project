import type { Id } from "@money-copilot/shared";
import {
  buildFinancialSnapshot,
  buildFinancialPositionFromAccounts,
  compareLifestyles,
  detectRecurringCandidates,
  monthlyCategoryTotals,
  monthlyTransactionList,
  reconciliationCandidates,
  uncategorizedTransactions,
  unknownFinancialPosition,
  type FinancialSnapshot,
  type FinancialPosition,
  type LifestyleComparisonResult,
  type CategoryTotal,
  type FinancialTransaction,
  type ReconciliationLink,
  type RecurringExpenseCandidate,
  type ProviderConnection,
} from "@money-copilot/financial-engine";
import * as repo from "@money-copilot/persistence";
import type { Database } from "@money-copilot/persistence";

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

export async function getCategoryTotals(
  db: Database,
  financialProfileId: string,
  asOfDate: string,
): Promise<readonly CategoryTotal[]> {
  const input = await repo.loadFinancialSnapshotInput(db, financialProfileId, asOfDate);
  return monthlyCategoryTotals(input.transactions, input.reconciliationLinks, asOfDate);
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

export async function getLatestSyncRunForConnection(db: Database, connectionId: string) {
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
