/**
 * Sprint 7: every numeric threshold the deterministic alert engine uses,
 * centralized in one place — see docs/ALERTS-NOTIFICATIONS.md, "AlertPolicy
 * defaults." Mirrors the existing `RecommendationPolicy`/
 * `ConciergeRankingPolicy` precedent: named, documented, product-owned
 * defaults, never a magic number scattered through orchestration code.
 * These are PRODUCT POLICY defaults, not universal financial truths.
 */
export interface AlertPolicy {
  /**
   * A Safe-to-Spend drop is material when it falls by AT LEAST this
   * fraction of the previous checkpoint's value (e.g. 0.15 = a 15% drop).
   * Evaluated together with `safeToSpendMaterialAbsoluteDropCents` — see
   * `evaluateSafeToSpendChange`'s doc comment for exactly how the two
   * combine.
   */
  readonly safeToSpendMaterialRelativeDropRatio: number;
  /**
   * A Safe-to-Spend drop is ALSO material when the absolute decline is at
   * least this many cents, regardless of the relative percentage — this is
   * what keeps a large-in-absolute-terms drop from a large baseline (where
   * the relative ratio alone might look small) from being silently missed.
   */
  readonly safeToSpendMaterialAbsoluteDropCents: number;
  /**
   * Once a SAFE_TO_SPEND_MATERIAL_DROP episode is active, the condition
   * must recover to within this fraction of the ORIGINAL baseline (the
   * checkpoint value recorded when the episode was first triggered) before
   * it's considered resolved — a small hysteresis buffer so a value
   * hovering exactly at the threshold doesn't flap open/resolved/open every
   * evaluation.
   */
  readonly safeToSpendRecoveryHysteresisRatio: number;
  /** How many days ahead of an event's start date "upcoming" pressure/unknown-cost evaluation begins looking at all. */
  readonly eventPressureWindowDays: number;
  /** A connection needs attention once its status has reported a login/action-required/error state for this many CONSECUTIVE sync attempts. */
  readonly connectionConsecutiveFailureThreshold: number;
  /** A CONNECTED connection with no successful sync in this many days is also treated as needing attention (stale, even without an explicit error). */
  readonly connectionStaleSyncDays: number;
  /** Whether a VERIFIED recommendation produces its own (low-severity, informational) alert at all — see Section 14, "avoid notification fatigue." */
  readonly verifiedRecommendationAlertsEnabled: boolean;
  /** A saved concierge plan is "stale" (per the SAME staleness check `reevaluateConciergePlan` already performs) AND still upcoming/relevant enough to alert about within this many days of being saved. */
  readonly staleConciergePlanRelevanceWindowDays: number;
  /** Minimum time between two IN_APP notification deliveries for the SAME alert episode, even if re-evaluated more often than this. */
  readonly notificationCooldownHours: number;
}

export const DEFAULT_ALERT_POLICY: AlertPolicy = {
  safeToSpendMaterialRelativeDropRatio: 0.15,
  safeToSpendMaterialAbsoluteDropCents: 20_000, // R$200.00
  safeToSpendRecoveryHysteresisRatio: 0.05,
  eventPressureWindowDays: 5,
  connectionConsecutiveFailureThreshold: 2,
  connectionStaleSyncDays: 14,
  verifiedRecommendationAlertsEnabled: true,
  staleConciergePlanRelevanceWindowDays: 3,
  notificationCooldownHours: 12,
};

/** Bumped whenever a change to this policy (or the classification functions that consume it) could alter historical alert behavior — see `Alert.policyVersion`, docs/ALERTS-NOTIFICATIONS.md "Policy versioning." */
export const ALERT_POLICY_VERSION = 1;
