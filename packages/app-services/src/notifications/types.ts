import type { AlertType } from "../alerts/types";

/**
 * V1 (Sprint 7) fully supports IN_APP only — PUSH/EMAIL are modeled here so
 * a future channel is additive, never a schema replacement (see
 * docs/ALERTS-NOTIFICATIONS.md, "V1 channel strategy" /
 * "LIVE_EXTERNAL_NOTIFICATION_VALIDATION = NOT_CONFIGURED").
 */
export type NotificationChannel = "IN_APP" | "PUSH" | "EMAIL";

export type NotificationStatus = "PENDING" | "DELIVERED" | "FAILED" | "SUPPRESSED";

/** Delivery of ONE alert through ONE channel — distinct from the `Alert` itself. See docs/ALERTS-NOTIFICATIONS.md, "Alert vs notification." */
export interface NotificationDelivery {
  readonly id: string;
  readonly alertId: string;
  readonly financialProfileId: string;
  readonly channel: NotificationChannel;
  readonly status: NotificationStatus;
  readonly attemptedAt: string;
  readonly deliveredAt?: string;
  readonly failureReasonCode?: string;
}

export type NotificationCategory =
  | "FINANCIAL_CHANGE"
  | "PLANNED_EVENTS"
  | "RECOMMENDATIONS"
  | "CONNECTION_HEALTH"
  | "CONCIERGE";

export const CATEGORY_FOR_ALERT_TYPE: Record<AlertType, NotificationCategory> = {
  SAFE_TO_SPEND_MATERIAL_DROP: "FINANCIAL_CHANGE",
  LIQUIDITY_COVERAGE_DEGRADED: "FINANCIAL_CHANGE",
  RECOMMENDATION_FAILED: "RECOMMENDATIONS",
  RECOMMENDATION_VERIFIED: "RECOMMENDATIONS",
  UPCOMING_EVENT_PRESSURE: "PLANNED_EVENTS",
  UPCOMING_EVENT_UNKNOWN_COST: "PLANNED_EVENTS",
  CONNECTION_NEEDS_ATTENTION: "CONNECTION_HEALTH",
  STALE_CONCIERGE_PLAN: "CONCIERGE",
};

/**
 * Whether a future external (lock-screen) notification may include amounts.
 * See docs/ALERTS-NOTIFICATIONS.md, "Notification privacy model" — GENERIC
 * never mentions a figure; AMOUNT_ALLOWED may. In-app content (rendered
 * inside the authenticated dashboard) is never restricted by this — it only
 * governs what a FUTURE external provider payload may contain.
 */
export type NotificationPrivacyMode = "GENERIC" | "AMOUNT_ALLOWED";

export interface NotificationPreferences {
  readonly financialProfileId: string;
  readonly inAppEnabled: boolean;
  readonly financialChangeEnabled: boolean;
  readonly plannedEventsEnabled: boolean;
  readonly recommendationsEnabled: boolean;
  readonly connectionHealthEnabled: boolean;
  readonly conciergeEnabled: boolean;
  /** "HH:MM" 24h local strings; both undefined means no quiet hours configured. */
  readonly quietHoursStart?: string;
  readonly quietHoursEnd?: string;
  readonly privacyMode: NotificationPrivacyMode;
  readonly updatedAt: string;
}

const CATEGORY_FIELD: Record<NotificationCategory, keyof NotificationPreferences> = {
  FINANCIAL_CHANGE: "financialChangeEnabled",
  PLANNED_EVENTS: "plannedEventsEnabled",
  RECOMMENDATIONS: "recommendationsEnabled",
  CONNECTION_HEALTH: "connectionHealthEnabled",
  CONCIERGE: "conciergeEnabled",
};

export function isCategoryEnabled(preferences: NotificationPreferences, category: NotificationCategory): boolean {
  return Boolean(preferences[CATEGORY_FIELD[category]]);
}

/** The default preferences for a profile with no row yet — every category enabled, amounts allowed, no quiet hours. Never a "silent by default" surprise. */
export function defaultNotificationPreferences(financialProfileId: string, nowIso: string): NotificationPreferences {
  return {
    financialProfileId,
    inAppEnabled: true,
    financialChangeEnabled: true,
    plannedEventsEnabled: true,
    recommendationsEnabled: true,
    connectionHealthEnabled: true,
    conciergeEnabled: true,
    privacyMode: "AMOUNT_ALLOWED",
    updatedAt: nowIso,
  };
}

/**
 * Deterministic quiet-hours evaluation — handles a window that wraps past
 * midnight (e.g. 22:00-07:00). Only meaningful for a FUTURE external
 * channel's delivery scheduling (see docs/ALERTS-NOTIFICATIONS.md, "Quiet
 * hours") — never suppresses the alert itself or its in-app visibility.
 */
export function isWithinQuietHours(preferences: NotificationPreferences, nowHHMM: string): boolean {
  if (!preferences.quietHoursStart || !preferences.quietHoursEnd) return false;
  const { quietHoursStart: start, quietHoursEnd: end } = preferences;
  if (start === end) return false;
  if (start < end) return nowHHMM >= start && nowHHMM < end;
  return nowHHMM >= start || nowHHMM < end; // wraps past midnight
}
