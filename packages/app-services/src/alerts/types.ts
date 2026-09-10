import type { Id } from "@money-copilot/shared";

/**
 * The Sprint 7 alert catalog. Deliberately small — see docs/ALERTS-
 * NOTIFICATIONS.md, "Initial alert catalog." Alert CREATION is always
 * deterministic (`alert-service.ts`); the AI may only explain/read/mark-
 * seen/dismiss an alert that already exists.
 */
export type AlertType =
  | "SAFE_TO_SPEND_MATERIAL_DROP"
  | "RECOMMENDATION_FAILED"
  | "RECOMMENDATION_VERIFIED"
  | "UPCOMING_EVENT_PRESSURE"
  | "UPCOMING_EVENT_UNKNOWN_COST"
  | "LIQUIDITY_COVERAGE_DEGRADED"
  | "CONNECTION_NEEDS_ATTENTION"
  | "STALE_CONCIERGE_PLAN";

/**
 * A small, meaningful severity model — no fake emergency language (see
 * docs/ALERTS-NOTIFICATIONS.md, "Severity"). Deterministic, from
 * `AlertPolicy`-driven mapping — the AI never chooses this.
 */
export type AlertSeverity = "INFO" | "ATTENTION" | "IMPORTANT";

/**
 * ACTIVE_UNSEEN — the condition is currently true and the user has not seen it.
 * ACTIVE_SEEN   — still true, and the user has seen it.
 * DISMISSED     — the user chose to stop seeing this ACTIVE episode (the
 *                 condition may still be true — dismissal is not resolution).
 * RESOLVED      — the underlying condition is no longer true (deterministic,
 *                 never user-driven).
 */
export type AlertStatus = "ACTIVE_UNSEEN" | "ACTIVE_SEEN" | "DISMISSED" | "RESOLVED";

export interface AlertTransitionEvent {
  readonly status: AlertStatus;
  readonly at: string;
  readonly note?: string;
}

/**
 * Per-type deterministic evidence — a plain, JSON-serializable record so
 * "why did I get this alert?" always has a real, structured answer (see
 * docs/ALERTS-NOTIFICATIONS.md, "Alert evidence/auditability"). Every
 * `*Cents` field here is what `alerts/facts.ts` exposes to grounding.
 */
export type AlertEvidence =
  | {
      readonly kind: "SAFE_TO_SPEND_MATERIAL_DROP";
      readonly previousCents: number;
      readonly currentCents: number;
      readonly deltaCents: number;
      readonly relativeDropRatio: number | null;
    }
  | {
      readonly kind: "RECOMMENDATION_DECISION";
      readonly recommendationId: string;
      readonly recommendationTitle: string;
      readonly observedAmountCents: number;
      readonly projectedMonthlyImpactCents: number;
    }
  | {
      readonly kind: "UPCOMING_EVENT_PRESSURE";
      readonly eventId: string;
      readonly eventLabel: string;
      readonly daysUntilStart: number;
      readonly knownCostCents: number;
    }
  | {
      readonly kind: "UPCOMING_EVENT_UNKNOWN_COST";
      readonly eventId: string;
      readonly eventLabel: string;
      readonly daysUntilStart: number;
    }
  | {
      readonly kind: "LIQUIDITY_COVERAGE_DEGRADED";
      readonly previousCoverage: string;
      readonly currentCoverage: string;
    }
  | {
      readonly kind: "CONNECTION_NEEDS_ATTENTION";
      readonly connectionId: string;
      readonly connectorName: string | null;
      readonly status: string;
      readonly reasonCode: string;
    }
  | {
      readonly kind: "STALE_CONCIERGE_PLAN";
      readonly savedPlanId: string;
      readonly planLabel: string;
      readonly savedAt: string;
    };

/**
 * A persisted domain signal — distinct from a `NotificationDelivery` (see
 * docs/ALERTS-NOTIFICATIONS.md, "Alert vs notification"). Never mutated by
 * the AI directly — only through `markAlertSeen`/`dismissAlert`, which are
 * thin, explicit-intent-gated wrappers over `alert-service.ts`.
 */
export interface Alert {
  readonly id: Id<"alert">;
  readonly financialProfileId: Id<"financial-profile">;
  readonly type: AlertType;
  readonly status: AlertStatus;
  readonly severity: AlertSeverity;
  /** Identifies the ECONOMIC CONDITION, not a random id — see docs/ALERTS-NOTIFICATIONS.md, "Episode identity." More than one historical row may share an identityKey over time; at most one is ever non-terminal. */
  readonly identityKey: string;
  readonly title: string;
  readonly reasonCode: string;
  readonly createdAt: string;
  readonly firstTriggeredAt: string;
  readonly lastTriggeredAt: string;
  readonly resolvedAt?: string;
  readonly seenAt?: string;
  readonly dismissedAt?: string;
  readonly evidence: AlertEvidence;
  readonly relatedEntityType?: string;
  readonly relatedEntityId?: string;
  readonly policyVersion: number;
  readonly transitions: readonly AlertTransitionEvent[];
}

export interface AlertEvaluationSummary {
  readonly alertsEvaluated: number;
  readonly alertsCreated: number;
  readonly alertsReused: number;
  readonly alertsResolved: number;
  readonly alertsSuppressed: number;
  readonly alertEpisodesRearmed: number;
}
