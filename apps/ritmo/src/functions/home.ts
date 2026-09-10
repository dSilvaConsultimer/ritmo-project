import { createServerFn } from "@tanstack/react-start";
import {
  getDb,
  getFinancialSnapshot,
  getFixedExpensesForProfile,
  getRecommendationsSummary,
  listAlertsForProfile,
  activeAlerts,
  rankAlerts,
  evaluateAlerts,
  evaluateRecommendations,
  evaluateRecommendationVerifications,
  syncNotificationsForProfile,
} from "@money-copilot/app-services";
import { getCurrentProfileContext } from "./profile-context";
import { ASOF_DATE } from "./config";

/**
 * Raw data for the Home screen — everything comes from
 * `@money-copilot/app-services`, nothing is computed here beyond picking
 * which fields the adapter needs. See `src/adapters/home.ts` for the
 * presentation reshaping (never done in a server function or a component).
 */
export const getHomeData = createServerFn({ method: "GET" }).handler(async () => {
  const { financialProfileId, displayName } = getCurrentProfileContext();
  const db = await getDb();

  // Same idempotent, safe-to-re-run-on-every-load pattern apps/web's
  // page.tsx already uses (Sprint 5/7) — never a separate scheduler.
  await evaluateRecommendations(db, financialProfileId, ASOF_DATE);
  await evaluateRecommendationVerifications(db, financialProfileId, ASOF_DATE);
  await evaluateAlerts(db, financialProfileId, ASOF_DATE);
  await syncNotificationsForProfile(db, financialProfileId);

  const [snapshot, fixedExpenses, recommendationsSummary, allAlerts] = await Promise.all([
    getFinancialSnapshot(db, financialProfileId, ASOF_DATE),
    getFixedExpensesForProfile(db, financialProfileId, ASOF_DATE),
    getRecommendationsSummary(db, financialProfileId),
    listAlertsForProfile(db, financialProfileId),
  ]);

  const topAlert = rankAlerts(activeAlerts(allAlerts), new Date().toISOString())[0]?.alert ?? null;
  const topPendingRecommendation = recommendationsSummary.pending[0] ?? null;

  return {
    displayName,
    asOfDate: ASOF_DATE,
    safeToSpendCents: snapshot.safeToSpend.total.cents,
    daysRemainingInMonth: snapshot.safeToSpend.daysRemainingInMonth,
    incomeCents: snapshot.income.gross.cents,
    committedCents: snapshot.commitments.fixed.cents,
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
