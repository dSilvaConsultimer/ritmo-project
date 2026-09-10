import { createId, type Id } from "@money-copilot/shared";
import {
  ALERT_POLICY_VERSION,
  DEFAULT_ALERT_POLICY,
  breakdownEvent,
  evaluateConnectionAttention,
  evaluateEventPressure,
  evaluateLiquidityCoverageChange,
  hasEventPassed,
  hasSafeToSpendRecovered,
  evaluateSafeToSpendChange,
  type AlertPolicy,
} from "@money-copilot/financial-engine";
import type { Database } from "@money-copilot/persistence";
import * as repo from "@money-copilot/persistence";
import {
  getFinancialPosition,
  getFinancialSnapshot,
  getSpendingEnvelopeForProfile,
  getConnections,
  getRecommendationsSummary,
} from "../queries";
import { listSavedConciergePlansForProfile, reevaluateConciergePlan } from "../concierge";
import type { Alert, AlertEvidence, AlertEvaluationSummary, AlertStatus, AlertSeverity, AlertTransitionEvent, AlertType } from "./types";

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Deterministic — the AI never chooses severity (see docs/ALERTS-
 * NOTIFICATIONS.md, "Severity"). A small, meaningful model: IMPORTANT for
 * something that is both financially material and needs a concrete user
 * action; ATTENTION for a real but less urgent change; INFO for a
 * low-noise/positive/planning signal.
 */
function severityFor(type: AlertType, reasonCode: string): AlertSeverity {
  switch (type) {
    case "CONNECTION_NEEDS_ATTENTION":
      return "IMPORTANT";
    case "SAFE_TO_SPEND_MATERIAL_DROP":
      return reasonCode === "CROSSED_INTO_DEFICIT" || reasonCode === "STILL_MATERIALLY_BELOW_BASELINE"
        ? "IMPORTANT"
        : "ATTENTION";
    case "LIQUIDITY_COVERAGE_DEGRADED":
      return "ATTENTION";
    case "UPCOMING_EVENT_PRESSURE":
      return "ATTENTION";
    case "RECOMMENDATION_FAILED":
      return "ATTENTION";
    case "UPCOMING_EVENT_UNKNOWN_COST":
    case "STALE_CONCIERGE_PLAN":
    case "RECOMMENDATION_VERIFIED":
      return "INFO";
  }
}

function alertFromRow(row: repo.AlertRow): Alert {
  return {
    id: row.id as Id<"alert">,
    financialProfileId: row.financialProfileId as Id<"financial-profile">,
    type: row.type as AlertType,
    status: row.status as AlertStatus,
    severity: row.severity as AlertSeverity,
    identityKey: row.identityKey,
    title: row.title,
    reasonCode: row.reasonCode,
    createdAt: row.createdAt,
    firstTriggeredAt: row.firstTriggeredAt,
    lastTriggeredAt: row.lastTriggeredAt,
    ...(row.resolvedAt ? { resolvedAt: row.resolvedAt } : {}),
    ...(row.seenAt ? { seenAt: row.seenAt } : {}),
    ...(row.dismissedAt ? { dismissedAt: row.dismissedAt } : {}),
    evidence: JSON.parse(row.evidenceJson) as AlertEvidence,
    ...(row.relatedEntityType ? { relatedEntityType: row.relatedEntityType } : {}),
    ...(row.relatedEntityId ? { relatedEntityId: row.relatedEntityId } : {}),
    policyVersion: row.policyVersion,
    transitions: JSON.parse(row.transitionsJson) as AlertTransitionEvent[],
  };
}

function alertToRow(alert: Alert): repo.AlertRow {
  return {
    id: alert.id,
    financialProfileId: alert.financialProfileId,
    type: alert.type,
    status: alert.status,
    severity: alert.severity,
    identityKey: alert.identityKey,
    title: alert.title,
    reasonCode: alert.reasonCode,
    createdAt: alert.createdAt,
    firstTriggeredAt: alert.firstTriggeredAt,
    lastTriggeredAt: alert.lastTriggeredAt,
    resolvedAt: alert.resolvedAt ?? null,
    seenAt: alert.seenAt ?? null,
    dismissedAt: alert.dismissedAt ?? null,
    evidenceJson: JSON.stringify(alert.evidence),
    relatedEntityType: alert.relatedEntityType ?? null,
    relatedEntityId: alert.relatedEntityId ?? null,
    policyVersion: alert.policyVersion,
    transitionsJson: JSON.stringify(alert.transitions),
  };
}

export type EpisodeOutcome = "CREATED" | "REUSED" | "RESOLVED" | "UNCHANGED";

interface UpsertEpisodeInput {
  readonly financialProfileId: string;
  readonly identityKey: string;
  readonly type: AlertType;
  readonly isCurrentlyTrue: boolean;
  readonly title: string;
  readonly reasonCode: string;
  readonly evidence: AlertEvidence;
  readonly relatedEntityType?: string;
  readonly relatedEntityId?: string;
  readonly asOfIso: string;
}

export interface UpsertEpisodeResult {
  readonly outcome: EpisodeOutcome;
  readonly alert?: Alert;
  /** True only for a fresh CREATE where a PRIOR (now-RESOLVED) episode existed for the same identity — a genuine re-arm, not a first-time alert. See docs/ALERTS-NOTIFICATIONS.md, "Episode/rearm behavior." */
  readonly isRearm: boolean;
}

/**
 * The single, shared "episode" mechanism every alert type below is built
 * on — see docs/ALERTS-NOTIFICATIONS.md, "Episode identity" / "Anti-spam
 * policy." One active (non-RESOLVED) row per `identityKey` at a time;
 * `status`/`seenAt`/`dismissedAt` are NEVER touched by a mere re-evaluation
 * that finds the condition still true (a DISMISSED or SEEN episode stays
 * that way — repeated identical evaluations must not "un-dismiss" or
 * "un-see" anything). A brand-new row is only ever created once no
 * non-terminal row exists for this identity.
 */
async function upsertAlertEpisode(db: Database, input: UpsertEpisodeInput): Promise<UpsertEpisodeResult> {
  const latestRow = await repo.findLatestAlertRowByIdentityKey(db, input.financialProfileId, input.identityKey);
  const latest = latestRow ? alertFromRow(latestRow) : undefined;
  const isNonTerminal = latest !== undefined && latest.status !== "RESOLVED";

  if (!input.isCurrentlyTrue) {
    if (isNonTerminal && latest) {
      const resolved: Alert = {
        ...latest,
        status: "RESOLVED",
        resolvedAt: input.asOfIso,
        transitions: [...latest.transitions, { status: "RESOLVED", at: input.asOfIso }],
      };
      await repo.upsertAlertRow(db, alertToRow(resolved));
      return { outcome: "RESOLVED", alert: resolved, isRearm: false };
    }
    return { outcome: "UNCHANGED", isRearm: false };
  }

  if (isNonTerminal && latest) {
    const reused: Alert = {
      ...latest,
      lastTriggeredAt: input.asOfIso,
      reasonCode: input.reasonCode,
      evidence: input.evidence,
      title: input.title,
    };
    await repo.upsertAlertRow(db, alertToRow(reused));
    return { outcome: "REUSED", alert: reused, isRearm: false };
  }

  const created: Alert = {
    id: createId("alert"),
    financialProfileId: input.financialProfileId as Id<"financial-profile">,
    type: input.type,
    status: "ACTIVE_UNSEEN",
    severity: severityFor(input.type, input.reasonCode),
    identityKey: input.identityKey,
    title: input.title,
    reasonCode: input.reasonCode,
    createdAt: input.asOfIso,
    firstTriggeredAt: input.asOfIso,
    lastTriggeredAt: input.asOfIso,
    evidence: input.evidence,
    ...(input.relatedEntityType ? { relatedEntityType: input.relatedEntityType } : {}),
    ...(input.relatedEntityId ? { relatedEntityId: input.relatedEntityId } : {}),
    policyVersion: ALERT_POLICY_VERSION,
    transitions: [{ status: "ACTIVE_UNSEEN", at: input.asOfIso }],
  };
  await repo.upsertAlertRow(db, alertToRow(created));
  return { outcome: "CREATED", alert: created, isRearm: latestRow !== undefined };
}

interface Counters {
  alertsEvaluated: number;
  alertsCreated: number;
  alertsReused: number;
  alertsResolved: number;
  alertsSuppressed: number;
  alertEpisodesRearmed: number;
}

function applyOutcome(counters: Counters, result: UpsertEpisodeResult): void {
  counters.alertsEvaluated += 1;
  if (result.outcome === "CREATED") {
    counters.alertsCreated += 1;
    if (result.isRearm) counters.alertEpisodesRearmed += 1;
  } else if (result.outcome === "REUSED") {
    counters.alertsReused += 1;
  } else if (result.outcome === "RESOLVED") {
    counters.alertsResolved += 1;
  } else {
    counters.alertsSuppressed += 1;
  }
}

/**
 * The central deterministic evaluation pass — see docs/ALERTS-
 * NOTIFICATIONS.md, "Alert evaluation orchestration." Consumes already-
 * computed domain state (snapshot, envelope, connections, recommendations,
 * upcoming events, saved concierge plans); never invents a condition. Safe
 * to call repeatedly (after a sync, after a mutation, on every dashboard
 * load) — idempotent by construction via `upsertAlertEpisode`.
 */
export async function evaluateAlerts(
  db: Database,
  financialProfileId: string,
  asOfDate: string,
  policy: AlertPolicy = DEFAULT_ALERT_POLICY,
): Promise<AlertEvaluationSummary> {
  const asOfIso = nowIso();
  const counters: Counters = {
    alertsEvaluated: 0,
    alertsCreated: 0,
    alertsReused: 0,
    alertsResolved: 0,
    alertsSuppressed: 0,
    alertEpisodesRearmed: 0,
  };

  const checkpointRow = await repo.getAlertEvaluationCheckpointRow(db, financialProfileId);
  const isBootstrap = checkpointRow === undefined;

  const [snapshot, position] = await Promise.all([
    getFinancialSnapshot(db, financialProfileId, asOfDate),
    getFinancialPosition(db, financialProfileId, asOfDate),
  ]);
  const currentSafeToSpendCents = snapshot.safeToSpend.total.cents;

  // ---------- (A) Safe-to-Spend material drop — see docs/ALERTS-NOTIFICATIONS.md, "Safe-to-Spend change alert" ----------
  const previousRolling = checkpointRow?.safeToSpendCents ?? null;
  const activeBaseline = checkpointRow?.activeDropEpisodeBaselineCents ?? null;

  let stsCurrentlyTrue: boolean;
  let stsReasonCode: string;
  let stsRelativeDropRatio: number | null = null;
  let stsPreviousForEvidence: number;

  if (activeBaseline !== null) {
    const recovered = hasSafeToSpendRecovered(activeBaseline, currentSafeToSpendCents, policy);
    stsCurrentlyTrue = !recovered;
    stsReasonCode = stsCurrentlyTrue ? "STILL_MATERIALLY_BELOW_BASELINE" : "RECOVERED";
    stsPreviousForEvidence = activeBaseline;
  } else {
    const assessment = evaluateSafeToSpendChange(previousRolling, currentSafeToSpendCents, policy);
    stsCurrentlyTrue = assessment.material;
    stsReasonCode = assessment.reasonCode;
    stsRelativeDropRatio = assessment.relativeDropRatio;
    stsPreviousForEvidence = previousRolling ?? currentSafeToSpendCents;
  }

  const stsResult = await upsertAlertEpisode(db, {
    financialProfileId,
    identityKey: `${financialProfileId}:SAFE_TO_SPEND_MATERIAL_DROP`,
    type: "SAFE_TO_SPEND_MATERIAL_DROP",
    isCurrentlyTrue: stsCurrentlyTrue,
    title: "Seu Safe-to-Spend caiu de forma relevante desde a última atualização.",
    reasonCode: stsReasonCode,
    evidence: {
      kind: "SAFE_TO_SPEND_MATERIAL_DROP",
      previousCents: stsPreviousForEvidence,
      currentCents: currentSafeToSpendCents,
      deltaCents: stsPreviousForEvidence - currentSafeToSpendCents,
      relativeDropRatio: stsRelativeDropRatio,
    },
    asOfIso,
  });
  applyOutcome(counters, stsResult);

  const newActiveBaseline =
    stsResult.outcome === "CREATED" ? stsPreviousForEvidence : stsResult.outcome === "RESOLVED" ? null : activeBaseline;

  // ---------- (E) Liquidity coverage degraded — see "Liquidity coverage degradation" ----------
  // A profile that has NEVER connected an institution is permanently
  // UNKNOWN from day one — that is not a "degradation" (nothing was ever
  // better), just the ongoing state of a demo/fixture-only profile, so it
  // must never alert. Only two things make this alert CURRENTLY true: (1)
  // an episode is already active/dismissed for this identity and coverage
  // still isn't back to COMPLETE, or (2) coverage genuinely got WORSE than
  // the last evaluation's rolling value. Checking the actual alert row
  // (not just the rolling checkpoint value) is what tells these apart —
  // see docs/ALERTS-NOTIFICATIONS.md, "Liquidity coverage degradation."
  const liquidityIdentityKey = `${financialProfileId}:LIQUIDITY_COVERAGE_DEGRADED`;
  const existingLiquidityAlertRow = await repo.findLatestAlertRowByIdentityKey(db, financialProfileId, liquidityIdentityKey);
  const liquidityEpisodeAlreadyActive =
    existingLiquidityAlertRow !== undefined && existingLiquidityAlertRow.status !== "RESOLVED";
  const previousCoverage = checkpointRow?.liquidityCoverage ?? position.coverage;
  const lcCurrentlyTrue = isBootstrap
    ? false
    : liquidityEpisodeAlreadyActive
      ? position.coverage !== "COMPLETE"
      : evaluateLiquidityCoverageChange(previousCoverage, position.coverage).degraded;
  const lcResult = await upsertAlertEpisode(db, {
    financialProfileId,
    identityKey: liquidityIdentityKey,
    type: "LIQUIDITY_COVERAGE_DEGRADED",
    isCurrentlyTrue: lcCurrentlyTrue,
    title: "Alguns saldos não estão atualizados, então seu limite atual está com confiança menor.",
    reasonCode: previousCoverage === position.coverage ? `STILL_${position.coverage}` : `${previousCoverage}_TO_${position.coverage}`,
    evidence: { kind: "LIQUIDITY_COVERAGE_DEGRADED", previousCoverage, currentCoverage: position.coverage },
    asOfIso,
  });
  applyOutcome(counters, lcResult);

  await repo.upsertAlertEvaluationCheckpointRow(db, {
    id: checkpointRow?.id ?? createId("alert-checkpoint"),
    financialProfileId,
    safeToSpendCents: currentSafeToSpendCents,
    liquidityAwareSafeToSpendCents: snapshot.liquidity.liquidityAwareSafeToSpend?.cents ?? null,
    liquidityCoverage: position.coverage,
    activeDropEpisodeBaselineCents: newActiveBaseline,
    evaluatedAt: asOfIso,
    policyVersion: ALERT_POLICY_VERSION,
  });

  // ---------- (B, H) Recommendation FAILED / VERIFIED — see "Recommendation failure/verified integration" ----------
  const recommendationsSummary = await getRecommendationsSummary(db, financialProfileId);
  for (const recommendation of recommendationsSummary.failed) {
    const result = await upsertAlertEpisode(db, {
      financialProfileId,
      identityKey: `${financialProfileId}:RECOMMENDATION_FAILED:${recommendation.id}`,
      type: "RECOMMENDATION_FAILED",
      isCurrentlyTrue: true, // FAILED is terminal — once true, always true for this recommendation.
      title: `${recommendation.title}: a cobrança continuou aparecendo.`,
      reasonCode: "RECOMMENDATION_FAILED",
      evidence: {
        kind: "RECOMMENDATION_DECISION",
        recommendationId: recommendation.id,
        recommendationTitle: recommendation.title,
        observedAmountCents: recommendation.evidence.observedAmount.cents,
        projectedMonthlyImpactCents: recommendation.projectedMonthlyImpact.cents,
      },
      relatedEntityType: "recommendation",
      relatedEntityId: recommendation.id,
      asOfIso,
    });
    applyOutcome(counters, result);
  }
  if (policy.verifiedRecommendationAlertsEnabled) {
    for (const recommendation of recommendationsSummary.verified) {
      const result = await upsertAlertEpisode(db, {
        financialProfileId,
        identityKey: `${financialProfileId}:RECOMMENDATION_VERIFIED:${recommendation.id}`,
        type: "RECOMMENDATION_VERIFIED",
        isCurrentlyTrue: true,
        title: `${recommendation.title}: economia confirmada.`,
        reasonCode: "RECOMMENDATION_VERIFIED",
        evidence: {
          kind: "RECOMMENDATION_DECISION",
          recommendationId: recommendation.id,
          recommendationTitle: recommendation.title,
          observedAmountCents: recommendation.evidence.observedAmount.cents,
          projectedMonthlyImpactCents: recommendation.projectedMonthlyImpact.cents,
        },
        relatedEntityType: "recommendation",
        relatedEntityId: recommendation.id,
        asOfIso,
      });
      applyOutcome(counters, result);
    }
  }

  // ---------- (C, D) Upcoming event pressure / unknown cost — see "Upcoming financial event pressure" ----------
  // Uses the FULL event list (not the "still upcoming" query) so an event
  // alert can still be found and RESOLVED once the event has passed — see
  // "(V, W)" in docs/ALERTS-NOTIFICATIONS.md, "Resolution engine."
  const envelope = await getSpendingEnvelopeForProfile(db, financialProfileId, asOfDate);
  const snapshotInput = await repo.loadFinancialSnapshotInput(db, financialProfileId, asOfDate);
  for (const event of snapshotInput.events) {
    const breakdown = breakdownEvent(event);
    const passed = hasEventPassed(event, asOfDate);
    const assessment = passed
      ? { daysUntilStart: -1, pressure: false, unknownCostPlanning: false }
      : evaluateEventPressure(event, breakdown, envelope, asOfDate, policy);

    const pressureResult = await upsertAlertEpisode(db, {
      financialProfileId,
      identityKey: `${financialProfileId}:UPCOMING_EVENT_PRESSURE:${event.id}`,
      type: "UPCOMING_EVENT_PRESSURE",
      isCurrentlyTrue: assessment.pressure,
      title: `Seu compromisso "${event.label}" está chegando e seu orçamento ficou mais apertado.`,
      reasonCode: "EVENT_COST_PRESSURE",
      evidence: {
        kind: "UPCOMING_EVENT_PRESSURE",
        eventId: event.id,
        eventLabel: event.label,
        daysUntilStart: assessment.daysUntilStart,
        knownCostCents: breakdown.futureConfirmed.cents + breakdown.futureEstimated.cents,
      },
      relatedEntityType: "financial-event",
      relatedEntityId: event.id,
      asOfIso,
    });
    applyOutcome(counters, pressureResult);

    const unknownCostResult = await upsertAlertEpisode(db, {
      financialProfileId,
      identityKey: `${financialProfileId}:UPCOMING_EVENT_UNKNOWN_COST:${event.id}`,
      type: "UPCOMING_EVENT_UNKNOWN_COST",
      isCurrentlyTrue: assessment.unknownCostPlanning,
      title: `Seu compromisso "${event.label}" está chegando e o custo esperado ainda é desconhecido.`,
      reasonCode: "UNKNOWN_COST_NEAR_DATE",
      evidence: {
        kind: "UPCOMING_EVENT_UNKNOWN_COST",
        eventId: event.id,
        eventLabel: event.label,
        daysUntilStart: assessment.daysUntilStart,
      },
      relatedEntityType: "financial-event",
      relatedEntityId: event.id,
      asOfIso,
    });
    applyOutcome(counters, unknownCostResult);
  }

  // ---------- (F) Connection health — see "Connection health alert" ----------
  const connections = await getConnections(db, financialProfileId);
  for (const connection of connections) {
    if (connection.status === "DISCONNECTED" || connection.status === "PENDING") continue;

    const recentRuns = await repo.listRecentSyncRunsForConnection(db, connection.id, 5);
    let consecutiveNonSucceeded = 0;
    for (const run of recentRuns) {
      if (run.status === "SUCCEEDED") break;
      consecutiveNonSucceeded += 1;
    }
    const daysSinceLastSuccess = connection.lastSuccessfulSyncAt
      ? (Date.now() - Date.parse(connection.lastSuccessfulSyncAt)) / (24 * 60 * 60 * 1000)
      : null;

    const assessment = evaluateConnectionAttention(connection.status, consecutiveNonSucceeded, daysSinceLastSuccess, policy);
    const result = await upsertAlertEpisode(db, {
      financialProfileId,
      identityKey: `${financialProfileId}:CONNECTION_NEEDS_ATTENTION:${connection.id}`,
      type: "CONNECTION_NEEDS_ATTENTION",
      isCurrentlyTrue: assessment.needsAttention,
      title: "Sua conexão bancária precisa de atenção.",
      reasonCode: assessment.reasonCode,
      evidence: {
        kind: "CONNECTION_NEEDS_ATTENTION",
        connectionId: connection.id,
        connectorName: connection.connectorName ?? null,
        status: connection.status,
        reasonCode: assessment.reasonCode,
      },
      relatedEntityType: "provider-connection",
      relatedEntityId: connection.id,
      asOfIso,
    });
    applyOutcome(counters, result);
  }

  // ---------- (G) Stale concierge plan — see "Stale concierge plan alert" ----------
  const savedPlans = await listSavedConciergePlansForProfile(db, financialProfileId);
  for (const saved of savedPlans) {
    const ageDays = (Date.parse(asOfIso) - Date.parse(saved.createdAt)) / (24 * 60 * 60 * 1000);
    const withinRelevanceWindow = ageDays <= policy.staleConciergePlanRelevanceWindowDays;

    let isStale = false;
    if (withinRelevanceWindow) {
      try {
        const validity = await reevaluateConciergePlan(db, financialProfileId, asOfDate, saved.sessionId, saved.plan.id);
        isStale = validity.stale;
      } catch {
        isStale = false; // Session/plan no longer resolvable — nothing to alert about.
      }
    }

    const result = await upsertAlertEpisode(db, {
      financialProfileId,
      identityKey: `${financialProfileId}:STALE_CONCIERGE_PLAN:${saved.id}`,
      type: "STALE_CONCIERGE_PLAN",
      isCurrentlyTrue: isStale,
      title: `Seu plano salvo "${saved.plan.label}" foi calculado com uma situação financeira antiga.`,
      reasonCode: "PLAN_STALE",
      evidence: { kind: "STALE_CONCIERGE_PLAN", savedPlanId: saved.id, planLabel: saved.plan.label, savedAt: saved.createdAt },
      relatedEntityType: "saved-concierge-plan",
      relatedEntityId: saved.id,
      asOfIso,
    });
    applyOutcome(counters, result);
  }

  return counters;
}

export async function getAlertById(db: Database, alertId: string): Promise<Alert | undefined> {
  const row = await repo.getAlertRowById(db, alertId);
  return row ? alertFromRow(row) : undefined;
}

export async function listAlertsForProfile(db: Database, financialProfileId: string): Promise<Alert[]> {
  const rows = await repo.listAlertRowsForProfile(db, financialProfileId);
  return rows.map(alertFromRow);
}

async function requireAlert(db: Database, alertId: string): Promise<Alert> {
  const alert = await getAlertById(db, alertId);
  if (!alert) throw new Error(`No alert ${alertId}`);
  return alert;
}

/**
 * ACTIVE_UNSEEN -> ACTIVE_SEEN only — idempotent: calling this again (or on
 * an already-DISMISSED/RESOLVED alert) is a no-op, never re-triggers a
 * transition or resets `seenAt`. See docs/ALERTS-NOTIFICATIONS.md,
 * "Idempotency."
 */
export async function markAlertSeen(db: Database, alertId: string): Promise<Alert> {
  const alert = await requireAlert(db, alertId);
  if (alert.status !== "ACTIVE_UNSEEN") return alert;
  const at = nowIso();
  const updated: Alert = {
    ...alert,
    status: "ACTIVE_SEEN",
    seenAt: at,
    transitions: [...alert.transitions, { status: "ACTIVE_SEEN", at }],
  };
  await repo.upsertAlertRow(db, alertToRow(updated));
  return updated;
}

/**
 * ACTIVE_UNSEEN/ACTIVE_SEEN -> DISMISSED only — idempotent, and does NOT
 * mean the underlying condition is resolved (see docs/ALERTS-
 * NOTIFICATIONS.md, "Dismissal semantics"): a dismissed episode stays
 * dismissed even while `evaluateAlerts` keeps finding the condition true,
 * and only a genuinely NEW episode (after resolution) can surface again.
 */
export async function dismissAlert(db: Database, alertId: string, reason?: string): Promise<Alert> {
  const alert = await requireAlert(db, alertId);
  if (alert.status === "DISMISSED" || alert.status === "RESOLVED") return alert;
  const at = nowIso();
  const updated: Alert = {
    ...alert,
    status: "DISMISSED",
    dismissedAt: at,
    transitions: [...alert.transitions, { status: "DISMISSED", at, ...(reason ? { note: reason } : {}) }],
  };
  await repo.upsertAlertRow(db, alertToRow(updated));
  return updated;
}

/**
 * "Isso ainda se aplica?" — re-runs the FULL deterministic evaluation pass
 * (never a separate, duplicated per-type check) and returns this alert's
 * current state afterward, which may now be RESOLVED. Safe to call
 * anytime; never mutates anything beyond what `evaluateAlerts` itself would
 * already do on its own.
 */
export async function reevaluateAlertContext(
  db: Database,
  financialProfileId: string,
  asOfDate: string,
  alertId: string,
): Promise<Alert> {
  await evaluateAlerts(db, financialProfileId, asOfDate);
  return requireAlert(db, alertId);
}

export { alertFromRow, alertToRow, severityFor };
