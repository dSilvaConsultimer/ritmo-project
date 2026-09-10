import type { Alert, AlertSeverity } from "./types";

/**
 * Every weight the dashboard's alert prioritization uses, centralized —
 * mirrors `concierge/ranking.ts`'s exact pattern. See docs/ALERTS-
 * NOTIFICATIONS.md, "Alert ranking." Product policy defaults, not
 * universal truth.
 */
export interface AlertRankingPolicy {
  readonly severityWeight: number;
  readonly unseenWeight: number;
  /** Higher for alert types that are directly actionable right now (a connection needing reconnect, a stale plan to recalculate) vs. purely informational ones. */
  readonly actionabilityWeight: number;
  readonly recencyWeight: number;
}

export const DEFAULT_ALERT_RANKING_POLICY: AlertRankingPolicy = {
  severityWeight: 100,
  unseenWeight: 30,
  actionabilityWeight: 20,
  recencyWeight: 10,
};

const SEVERITY_SCORE: Record<AlertSeverity, number> = { IMPORTANT: 1, ATTENTION: 0.6, INFO: 0.3 };

/** Higher for a type where the natural next step is a concrete action (reconnect, recalculate) vs. purely informational context. */
const ACTIONABILITY_SCORE: Record<Alert["type"], number> = {
  CONNECTION_NEEDS_ATTENTION: 1,
  STALE_CONCIERGE_PLAN: 1,
  UPCOMING_EVENT_UNKNOWN_COST: 0.8,
  UPCOMING_EVENT_PRESSURE: 0.7,
  SAFE_TO_SPEND_MATERIAL_DROP: 0.6,
  RECOMMENDATION_FAILED: 0.5,
  LIQUIDITY_COVERAGE_DEGRADED: 0.4,
  RECOMMENDATION_VERIFIED: 0.1,
};

export interface RankedAlert {
  readonly alert: Alert;
  readonly totalScore: number;
  readonly factors: {
    readonly severityScore: number;
    readonly unseenScore: number;
    readonly actionabilityScore: number;
    readonly recencyScore: number;
  };
}

/**
 * Deterministic, explainable ranking — never one opaque AI score (Sprint 7
 * brief, "Alert ordering": "Do not use opaque AI ranking"). `nowIso` is an
 * explicit parameter so recency scoring stays testable without depending on
 * the real clock. Ties break by `lastTriggeredAt` descending (most recently
 * re-triggered first) for a stable, explainable order.
 */
export function rankAlerts(
  alerts: readonly Alert[],
  nowIso: string,
  policy: AlertRankingPolicy = DEFAULT_ALERT_RANKING_POLICY,
): readonly RankedAlert[] {
  const nowMs = Date.parse(nowIso);
  const ranked = alerts.map((alert) => {
    const ageMs = Math.max(0, nowMs - Date.parse(alert.lastTriggeredAt));
    const ageDays = ageMs / (24 * 60 * 60 * 1000);
    // Recency decays smoothly to 0 over ~14 days — recent alerts score higher, but this never dominates severity/actionability.
    const recencyRatio = Math.max(0, 1 - ageDays / 14);

    const factors = {
      severityScore: SEVERITY_SCORE[alert.severity] * policy.severityWeight,
      unseenScore: (alert.status === "ACTIVE_UNSEEN" ? 1 : 0) * policy.unseenWeight,
      actionabilityScore: ACTIONABILITY_SCORE[alert.type] * policy.actionabilityWeight,
      recencyScore: recencyRatio * policy.recencyWeight,
    };
    const totalScore = factors.severityScore + factors.unseenScore + factors.actionabilityScore + factors.recencyScore;
    return { alert, totalScore, factors };
  });

  return [...ranked].sort((a, b) => {
    if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
    return b.alert.lastTriggeredAt.localeCompare(a.alert.lastTriggeredAt);
  });
}

/** Only ACTIVE (unseen or seen) alerts are ever ranked for display — DISMISSED/RESOLVED never appear on the dashboard's top-N surface. See docs/ALERTS-NOTIFICATIONS.md, "Dashboard prioritization." */
export function activeAlerts(alerts: readonly Alert[]): readonly Alert[] {
  return alerts.filter((a) => a.status === "ACTIVE_UNSEEN" || a.status === "ACTIVE_SEEN");
}
