import { createId } from "@money-copilot/shared";
import type { Database } from "@money-copilot/persistence";
import * as repo from "@money-copilot/persistence";
import type { Alert } from "../alerts/types";
import { listAlertsForProfile } from "../alerts/alert-service";
import { getNotificationProvider, type NotificationProviderName } from "../notification-provider-registry";
import type { NotificationProvider } from "./provider";
import {
  CATEGORY_FOR_ALERT_TYPE,
  defaultNotificationPreferences,
  isCategoryEnabled,
  isWithinQuietHours,
  type NotificationCategory,
  type NotificationDelivery,
  type NotificationPreferences,
} from "./types";

function nowIso(): string {
  return new Date().toISOString();
}

function rowToPreferences(row: repo.NotificationPreferencesRow): NotificationPreferences {
  return {
    financialProfileId: row.financialProfileId,
    inAppEnabled: row.inAppEnabled,
    financialChangeEnabled: row.financialChangeEnabled,
    plannedEventsEnabled: row.plannedEventsEnabled,
    recommendationsEnabled: row.recommendationsEnabled,
    connectionHealthEnabled: row.connectionHealthEnabled,
    conciergeEnabled: row.conciergeEnabled,
    ...(row.quietHoursStart ? { quietHoursStart: row.quietHoursStart } : {}),
    ...(row.quietHoursEnd ? { quietHoursEnd: row.quietHoursEnd } : {}),
    privacyMode: row.privacyMode,
    updatedAt: row.updatedAt,
  };
}

function preferencesToRow(preferences: NotificationPreferences, id: string): repo.NotificationPreferencesRow {
  return {
    id,
    financialProfileId: preferences.financialProfileId,
    inAppEnabled: preferences.inAppEnabled,
    financialChangeEnabled: preferences.financialChangeEnabled,
    plannedEventsEnabled: preferences.plannedEventsEnabled,
    recommendationsEnabled: preferences.recommendationsEnabled,
    connectionHealthEnabled: preferences.connectionHealthEnabled,
    conciergeEnabled: preferences.conciergeEnabled,
    quietHoursStart: preferences.quietHoursStart ?? null,
    quietHoursEnd: preferences.quietHoursEnd ?? null,
    privacyMode: preferences.privacyMode,
    updatedAt: preferences.updatedAt,
  };
}

/** Returns the profile's preferences, or the sensible "everything on" default when none have been set yet — see docs/ALERTS-NOTIFICATIONS.md, "Notification preferences." */
export async function getNotificationPreferences(db: Database, financialProfileId: string): Promise<NotificationPreferences> {
  const row = await repo.getNotificationPreferencesRow(db, financialProfileId);
  return row ? rowToPreferences(row) : defaultNotificationPreferences(financialProfileId, nowIso());
}

export interface UpdateNotificationPreferenceInput {
  readonly category?: NotificationCategory;
  readonly enabled?: boolean;
  readonly inAppEnabled?: boolean;
  readonly quietHoursStart?: string | null;
  readonly quietHoursEnd?: string | null;
  readonly privacyMode?: "GENERIC" | "AMOUNT_ALLOWED";
}

const CATEGORY_FIELD: Record<NotificationCategory, keyof NotificationPreferences> = {
  FINANCIAL_CHANGE: "financialChangeEnabled",
  PLANNED_EVENTS: "plannedEventsEnabled",
  RECOMMENDATIONS: "recommendationsEnabled",
  CONNECTION_HEALTH: "connectionHealthEnabled",
  CONCIERGE: "conciergeEnabled",
};

/**
 * The only way notification preferences change — always an explicit user
 * decision (gated by `hasExplicitMutationIntent` at the tool layer, exactly
 * like every other mutation). Never disables/enables anything the user
 * didn't ask about; unset fields are left exactly as they were.
 */
export async function updateNotificationPreferences(
  db: Database,
  financialProfileId: string,
  input: UpdateNotificationPreferenceInput,
): Promise<NotificationPreferences> {
  const existingRow = await repo.getNotificationPreferencesRow(db, financialProfileId);
  const current = existingRow ? rowToPreferences(existingRow) : defaultNotificationPreferences(financialProfileId, nowIso());

  const categoryPatch: Partial<NotificationPreferences> =
    input.category && input.enabled !== undefined ? { [CATEGORY_FIELD[input.category]]: input.enabled } : {};

  const merged: NotificationPreferences = {
    ...current,
    ...categoryPatch,
    ...(input.inAppEnabled !== undefined ? { inAppEnabled: input.inAppEnabled } : {}),
    ...(input.quietHoursStart ? { quietHoursStart: input.quietHoursStart } : {}),
    ...(input.quietHoursEnd ? { quietHoursEnd: input.quietHoursEnd } : {}),
    ...(input.privacyMode ? { privacyMode: input.privacyMode } : {}),
    updatedAt: nowIso(),
  };
  // `null` (as opposed to `undefined`, meaning "leave unchanged") explicitly
  // clears one quiet-hours bound — done as a real key deletion, never a
  // `{ quietHoursStart: undefined }` property (incompatible with this
  // repo's `exactOptionalPropertyTypes` convention).
  if (input.quietHoursStart === null) delete (merged as { quietHoursStart?: string }).quietHoursStart;
  if (input.quietHoursEnd === null) delete (merged as { quietHoursEnd?: string }).quietHoursEnd;
  const updated: NotificationPreferences = merged;

  await repo.upsertNotificationPreferencesRow(db, preferencesToRow(updated, existingRow?.id ?? createId("notification-preferences")));
  return updated;
}

/** Amount-bearing body for AMOUNT_ALLOWED mode — GENERIC mode never calls this. */
function amountAwareBody(alert: Alert): string {
  const fmt = (cents: number) => `R$ ${(cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  switch (alert.evidence.kind) {
    case "SAFE_TO_SPEND_MATERIAL_DROP":
      return `Seu Safe-to-Spend caiu ${fmt(Math.max(0, alert.evidence.deltaCents))}.`;
    case "RECOMMENDATION_DECISION":
      return `${alert.evidence.recommendationTitle}: ${fmt(alert.evidence.observedAmountCents)}.`;
    case "UPCOMING_EVENT_PRESSURE":
      return `${alert.evidence.eventLabel}: custo conhecido de ${fmt(alert.evidence.knownCostCents)}.`;
    default:
      return alert.title;
  }
}

function renderPayload(alert: Alert, privacyMode: NotificationPreferences["privacyMode"]): { title: string; body: string } {
  if (privacyMode === "GENERIC") {
    return { title: "Money Copilot", body: "Money Copilot encontrou algo que merece sua atenção." };
  }
  return { title: alert.title, body: amountAwareBody(alert) };
}

function deliveryRowToDelivery(row: repo.NotificationDeliveryRow): NotificationDelivery {
  return {
    id: row.id,
    alertId: row.alertId,
    financialProfileId: row.financialProfileId,
    channel: row.channel as NotificationDelivery["channel"],
    status: row.status,
    attemptedAt: row.attemptedAt,
    ...(row.deliveredAt ? { deliveredAt: row.deliveredAt } : {}),
    ...(row.failureReasonCode ? { failureReasonCode: row.failureReasonCode } : {}),
  };
}

/**
 * Delivers ONE alert through the IN_APP channel, respecting category/
 * global preferences and privacy mode. Idempotent: if an IN_APP delivery
 * already exists for this alert, this is a no-op (see docs/ALERTS-
 * NOTIFICATIONS.md, "Notification delivery model"). Quiet hours never
 * suppress the IN_APP delivery itself (Section 28: "in-app alerts can
 * still exist during quiet hours") — they are recorded for observability
 * only, and would gate a FUTURE external channel's scheduling.
 */
export async function deliverAlertNotification(
  db: Database,
  alert: Alert,
  provider: NotificationProvider = getNotificationProvider(),
): Promise<NotificationDelivery | undefined> {
  const existing = await repo.listNotificationDeliveriesForAlert(db, alert.id);
  if (existing.some((d) => d.channel === "IN_APP")) {
    return deliveryRowToDelivery(existing.find((d) => d.channel === "IN_APP")!);
  }

  const preferences = await getNotificationPreferences(db, alert.financialProfileId);
  const category = CATEGORY_FOR_ALERT_TYPE[alert.type];
  const attemptedAt = nowIso();

  if (!preferences.inAppEnabled || !isCategoryEnabled(preferences, category)) {
    const suppressedRow: repo.NotificationDeliveryRow = {
      id: createId("notification-delivery"),
      alertId: alert.id,
      financialProfileId: alert.financialProfileId,
      channel: "IN_APP",
      status: "SUPPRESSED",
      attemptedAt,
      deliveredAt: null,
      failureReasonCode: "CATEGORY_DISABLED",
    };
    await repo.upsertNotificationDeliveryRow(db, suppressedRow);
    return deliveryRowToDelivery(suppressedRow);
  }

  void isWithinQuietHours; // reserved for a future external channel's delivery scheduling — never gates IN_APP.

  const { title, body } = renderPayload(alert, preferences.privacyMode);
  const result = await provider.send({ financialProfileId: alert.financialProfileId, channel: "IN_APP", title, body });

  const row: repo.NotificationDeliveryRow = {
    id: createId("notification-delivery"),
    alertId: alert.id,
    financialProfileId: alert.financialProfileId,
    channel: "IN_APP",
    status: result.delivered ? "DELIVERED" : "FAILED",
    attemptedAt,
    deliveredAt: result.delivered ? attemptedAt : null,
    failureReasonCode: result.failureReasonCode ?? null,
  };
  await repo.upsertNotificationDeliveryRow(db, row);
  return deliveryRowToDelivery(row);
}

/**
 * Delivers a notification for every currently-ACTIVE alert that hasn't
 * been notified yet — the entire "one episode, at most one eligible
 * in-app notification" mechanism (Section 70.A/C/D/E): DISMISSED/RESOLVED
 * alerts are never included, and an alert that already has an IN_APP
 * delivery is skipped by `deliverAlertNotification`'s own idempotency
 * check. Call after `evaluateAlerts` — kept as a SEPARATE step so alert
 * creation and notification delivery stay independently testable (see
 * docs/ALERTS-NOTIFICATIONS.md, "Alert vs notification").
 */
export async function syncNotificationsForProfile(
  db: Database,
  financialProfileId: string,
  providerName: NotificationProviderName = "mock",
): Promise<{ delivered: number; suppressed: number }> {
  const provider = getNotificationProvider(providerName);
  const alerts = await listAlertsForProfile(db, financialProfileId);
  const active = alerts.filter((a) => a.status === "ACTIVE_UNSEEN" || a.status === "ACTIVE_SEEN");

  let delivered = 0;
  let suppressed = 0;
  for (const alert of active) {
    // Skip anything already notified — `deliverAlertNotification` is itself
    // idempotent (never creates a second row), but checking here too keeps
    // this function's own return counts meaning "NEW deliveries this call,"
    // not "the alert happens to already be delivered."
    const alreadyNotified = (await repo.listNotificationDeliveriesForAlert(db, alert.id)).length > 0;
    if (alreadyNotified) continue;

    const result = await deliverAlertNotification(db, alert, provider);
    if (result?.status === "DELIVERED") delivered += 1;
    else if (result?.status === "SUPPRESSED") suppressed += 1;
  }
  return { delivered, suppressed };
}
