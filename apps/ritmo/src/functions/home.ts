import { createServerFn } from "@tanstack/react-start";
import {
  getDb,
  getFinancialSnapshot,
  getFixedExpensesForProfile,
  getRealizedIncomeForProfile,
  getRecommendationsSummary,
  listAlertsForProfile,
  activeAlerts,
  rankAlerts,
  evaluateAlerts,
  evaluateRecommendations,
  evaluateRecommendationVerifications,
  syncNotificationsForProfile,
} from "@money-copilot/app-services";
import { getCurrentProfileContext } from "./profile.server";
import { resolveAsOfDate } from "./config";

/**
 * Raw data for the Home screen — everything comes from
 * `@money-copilot/app-services`, nothing is computed here beyond picking
 * which fields the adapter needs. See `src/adapters/home.ts` for the
 * presentation reshaping (never done in a server function or a component).
 */
export const getHomeData = createServerFn({ method: "GET" }).handler(async () => {
  const { financialProfileId, displayName } = await getCurrentProfileContext();
  const db = await getDb();
  const asOfDate = resolveAsOfDate();

  // Same idempotent, safe-to-re-run-on-every-load pattern apps/web's
  // page.tsx already uses (Sprint 5/7) — never a separate scheduler.
  await evaluateRecommendations(db, financialProfileId, asOfDate);
  await evaluateRecommendationVerifications(db, financialProfileId, asOfDate);
  await evaluateAlerts(db, financialProfileId, asOfDate);
  await syncNotificationsForProfile(db, financialProfileId);

  const [snapshot, realizedIncomeCents, fixedExpenses, recommendationsSummary, allAlerts] =
    await Promise.all([
      getFinancialSnapshot(db, financialProfileId, asOfDate),
      getRealizedIncomeForProfile(db, financialProfileId, asOfDate).then((m) => m.cents),
      getFixedExpensesForProfile(db, financialProfileId, asOfDate),
      getRecommendationsSummary(db, financialProfileId),
      listAlertsForProfile(db, financialProfileId),
    ]);

  const topAlert = rankAlerts(activeAlerts(allAlerts), new Date().toISOString())[0]?.alert ?? null;
  const topPendingRecommendation = recommendationsSummary.pending[0] ?? null;

  return {
    displayName,
    asOfDate,
    // DEC-130: the canonical engine result — `snapshot.liquidity.
    // recommendedTotal` is `liquidityAwareSafeToSpend` when real current
    // liquidity exists (`basis: "LIQUIDITY_AWARE"`), otherwise the
    // unchanged declared-plan `planSafeToSpend` (`basis: "PLAN_BASED"`).
    // Never `snapshot.safeToSpend.total` directly — that field alone
    // produced a nonsensical negative Home value whenever declared Income
    // was empty, even with healthy real liquidity. See docs/DECISIONS.md
    // DEC-130.
    safeToSpendCents: snapshot.liquidity.recommendedTotal.cents,
    safeToSpendBasis: snapshot.liquidity.basis,
    daysRemainingInMonth: snapshot.safeToSpend.daysRemainingInMonth,
    // Sprint 9 (DEC-127): "Entradas do mês" is REALIZED income this month —
    // real posted transactions with financial_effect = INCOME — never the
    // declared/expected `incomes` table (`snapshot.income.gross`), which is
    // a forward-looking planning input for Safe-to-Spend, not a report of
    // what already happened. See docs/DECISIONS.md DEC-127.
    incomeCents: realizedIncomeCents,
    // DEC-130: "Já comprometido" — the canonical engine figure
    // (`snapshot.recommendedCommittedTotal`), never `commitments.fixed`
    // directly. When real liquidity is authoritative this is the
    // liquidity-aware committed total (card obligations + unpaid fixed
    // expenses + this-month event reservations + debt/installments,
    // reconciled against real transactions — never variable budgets,
    // protected savings, or future income); otherwise it falls back to the
    // unchanged plan-based `commitments.fixed`.
    committedCents: snapshot.recommendedCommittedTotal.cents,
    fixedExpenses: fixedExpenses.map((e) => ({
      id: e.id,
      label: e.label,
      category: e.category,
      amountCents: e.amount.cents,
      dueDayOfMonth: e.dueDayOfMonth ?? null,
    })),
    topAlert: topAlert
      ? { id: topAlert.id, title: topAlert.title, severity: topAlert.severity }
      : null,
    topPendingRecommendation: topPendingRecommendation
      ? {
          id: topPendingRecommendation.id,
          title: topPendingRecommendation.title,
          description: topPendingRecommendation.description ?? null,
        }
      : null,
  };
});

export type HomeData = Awaited<ReturnType<typeof getHomeData>>;
