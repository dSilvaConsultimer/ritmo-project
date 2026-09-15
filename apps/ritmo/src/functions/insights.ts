import { createServerFn } from "@tanstack/react-start";
import {
  getDb,
  getRecommendationsSummary,
  listAlertsForProfile,
  activeAlerts,
  rankAlerts,
} from "@money-copilot/app-services";
import { getCurrentProfileContext } from "./profile.server";
import { resolveAsOfDate } from "./config";

/**
 * Raw data for the Insights screen. See `src/adapters/insights.ts` for the
 * presentation reshaping — the feed only ever renders real active Alerts
 * and pending Recommendations, never the mock's example insights that have
 * no engine equivalent (see docs/RITMO.md, "Data-model gaps").
 */
export const getInsightsData = createServerFn({ method: "GET" }).handler(async () => {
  const { financialProfileId } = await getCurrentProfileContext();
  const db = await getDb();

  const [allAlerts, recommendationsSummary] = await Promise.all([
    listAlertsForProfile(db, financialProfileId),
    getRecommendationsSummary(db, financialProfileId),
  ]);

  const ranked = rankAlerts(activeAlerts(allAlerts), new Date().toISOString());

  return {
    asOfDate: resolveAsOfDate(),
    alerts: ranked.map(({ alert }) => ({
      id: alert.id,
      type: alert.type,
      severity: alert.severity,
      title: alert.title,
      evidence: alert.evidence,
    })),
    pendingRecommendations: recommendationsSummary.pending.map((r) => ({
      id: r.id,
      type: r.type,
      title: r.title,
      description: r.description ?? null,
      projectedMonthlyImpactCents: r.projectedMonthlyImpact.cents,
    })),
  };
});

export type InsightsData = Awaited<ReturnType<typeof getInsightsData>>;
