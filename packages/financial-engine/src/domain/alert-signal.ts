import * as M from "../money/index";
import type { SpendingEnvelope } from "../simulation/envelope";
import { evaluateBudgetFit, type CostRange } from "../simulation/budget-fit";
import type { EventReserveBreakdown, FinancialEvent } from "./event";
import type { LiquidityCoverage } from "./position";
import type { ProviderConnectionStatus } from "./provider";
import { DEFAULT_ALERT_POLICY, type AlertPolicy } from "./alert-policy";

/**
 * Sprint 7: pure, deterministic classification functions the alert engine
 * builds on — the AI never decides any of this (see docs/ALERTS-
 * NOTIFICATIONS.md, "Core principle"). Every function here is a plain,
 * framework-free calculation over already-existing `financial-engine`
 * types (no discovery/open-finance/persistence knowledge), following the
 * exact same "usable without a database or LLM" discipline as
 * `budget-fit.ts`. `app-services/src/alerts` assembles these into
 * persisted `Alert` episodes; it never reimplements the arithmetic here.
 */

/**
 * Accepts EITHER a plain "YYYY-MM-DD" date or a full ISO timestamp — see
 * the identical DEC-061 lesson in `recommendation-verification.ts`
 * (appending a synthetic midnight time to an already-full timestamp
 * produces an invalid, silently-NaN date, which previously made a
 * staleness check a silent no-op).
 */
function toEpochMillis(iso: string): number {
  return Date.parse(iso.includes("T") ? iso : `${iso}T00:00:00Z`);
}

function daysBetween(isoA: string, isoB: string): number {
  return Math.abs(toEpochMillis(isoB) - toEpochMillis(isoA)) / (24 * 60 * 60 * 1000);
}

/** `isoB` minus `isoA`, in days — POSITIVE when `isoB` is in the future relative to `isoA`. Unlike `daysBetween`, direction matters here (an event that already passed must never look "upcoming"). */
function daysUntil(fromIso: string, toIso: string): number {
  return (toEpochMillis(toIso) - toEpochMillis(fromIso)) / (24 * 60 * 60 * 1000);
}

export type SafeToSpendChangeReasonCode =
  | "RELATIVE_DROP"
  | "ABSOLUTE_DROP"
  | "CROSSED_INTO_DEFICIT"
  | "NONE";

export interface SafeToSpendChangeAssessment {
  /** True when the CURRENT value alone (vs. the ORIGINAL episode baseline, when one is supplied) is materially worse — what the alert engine uses to decide whether to keep an episode active. */
  readonly material: boolean;
  readonly reasonCode: SafeToSpendChangeReasonCode;
  /** Positive fraction the value declined by, relative to `previousCents`. Null when `previousCents` is null (no baseline yet) or non-positive. */
  readonly relativeDropRatio: number | null;
  /** Positive number of cents the value declined by (0 or negative when it did not decline). */
  readonly absoluteDropCents: number;
}

/**
 * Compares a Safe-to-Spend figure against a previous checkpoint —
 * `previousCents === null` means no baseline exists yet (a fresh
 * bootstrap — see docs/ALERTS-NOTIFICATIONS.md, "Bootstrap semantics"),
 * which never counts as material on its own. A drop is material when EITHER
 * the relative decline meets `safeToSpendMaterialRelativeDropRatio` OR the
 * absolute decline meets `safeToSpendMaterialAbsoluteDropCents` (an OR, not
 * an AND — a huge absolute drop from a huge baseline may look like a small
 * percentage, and a huge percentage drop from a small baseline may be a
 * tiny absolute amount; either alone is worth surfacing). Independently, a
 * transition from a non-negative value into a genuine deficit
 * (`currentCents < 0`, an already-meaningful, already-documented state —
 * see `FinancialSnapshot.safeToSpend.total`'s "not clamped at zero, a real
 * visible deficit" semantics) is ALWAYS material, regardless of the ratio/
 * absolute thresholds — this is the "zone crossing" signal the Sprint 7
 * brief allows reusing existing semantics for, rather than inventing a
 * second, conflicting zone model (see docs/ALERTS-NOTIFICATIONS.md,
 * "Safe-to-Spend zone crossing").
 */
export function evaluateSafeToSpendChange(
  previousCents: number | null,
  currentCents: number,
  policy: AlertPolicy = DEFAULT_ALERT_POLICY,
): SafeToSpendChangeAssessment {
  if (previousCents === null) {
    return { material: false, reasonCode: "NONE", relativeDropRatio: null, absoluteDropCents: 0 };
  }

  const absoluteDropCents = previousCents - currentCents;
  const crossedIntoDeficit = previousCents >= 0 && currentCents < 0;

  if (absoluteDropCents <= 0) {
    return {
      material: crossedIntoDeficit,
      reasonCode: crossedIntoDeficit ? "CROSSED_INTO_DEFICIT" : "NONE",
      relativeDropRatio: null,
      absoluteDropCents: 0,
    };
  }

  const relativeDropRatio = previousCents > 0 ? absoluteDropCents / previousCents : null;
  const relativeMaterial = relativeDropRatio !== null && relativeDropRatio >= policy.safeToSpendMaterialRelativeDropRatio;
  const absoluteMaterial = absoluteDropCents >= policy.safeToSpendMaterialAbsoluteDropCents;

  if (crossedIntoDeficit) {
    return { material: true, reasonCode: "CROSSED_INTO_DEFICIT", relativeDropRatio, absoluteDropCents };
  }
  if (relativeMaterial) {
    return { material: true, reasonCode: "RELATIVE_DROP", relativeDropRatio, absoluteDropCents };
  }
  if (absoluteMaterial) {
    return { material: true, reasonCode: "ABSOLUTE_DROP", relativeDropRatio, absoluteDropCents };
  }
  return { material: false, reasonCode: "NONE", relativeDropRatio, absoluteDropCents };
}

/**
 * Whether an ACTIVE episode's condition has recovered enough to resolve —
 * a small hysteresis buffer above the ORIGINAL triggering baseline (not
 * the live-fluctuating previous checkpoint) so a value oscillating right at
 * the threshold does not flap the episode open/resolved every evaluation.
 */
export function hasSafeToSpendRecovered(
  episodeBaselineCents: number,
  currentCents: number,
  policy: AlertPolicy = DEFAULT_ALERT_POLICY,
): boolean {
  if (currentCents < 0) return false; // Still in deficit — never "recovered."
  const recoveryFloor = episodeBaselineCents * (1 - policy.safeToSpendRecoveryHysteresisRatio);
  return currentCents >= recoveryFloor;
}

export interface EventPressureAssessment {
  readonly daysUntilStart: number;
  /** True when the event's known cost pushes the plan into WITHIN_CAUTION or worse — reuses `evaluateBudgetFit`'s existing zone model, never a second one. */
  readonly pressure: boolean;
  /** True when the event has at least one UNKNOWN-amount planned line item and the date is within the pressure window — a planning-completeness signal, not a spending warning. */
  readonly unknownCostPlanning: boolean;
}

/**
 * Deterministic upcoming-event evaluation — reuses `evaluateBudgetFit`
 * (the SAME zone model Sprint 6 already established) rather than inventing
 * a second comparison. Only events within `eventPressureWindowDays` are
 * considered at all; an event already fully in the past, or one whose
 * start date is further away than the window, produces
 * `{ pressure: false, unknownCostPlanning: false }` regardless of cost.
 */
export function evaluateEventPressure(
  event: FinancialEvent,
  breakdown: EventReserveBreakdown,
  envelope: SpendingEnvelope,
  asOfDate: string,
  policy: AlertPolicy = DEFAULT_ALERT_POLICY,
): EventPressureAssessment {
  const daysUntilStart = daysUntil(asOfDate, event.startDate);
  if (daysUntilStart < 0 || daysUntilStart > policy.eventPressureWindowDays) {
    return { daysUntilStart, pressure: false, unknownCostPlanning: false };
  }

  const unknownCostPlanning = breakdown.unknownLabels.length > 0;

  const knownCost = M.add(breakdown.futureConfirmed, breakdown.futureEstimated);
  const costRange: CostRange | null = M.isZero(knownCost) && unknownCostPlanning ? null : { min: knownCost, max: knownCost };
  const fit = evaluateBudgetFit(envelope, costRange);
  const pressure = fit.zone === "WITHIN_CAUTION" || fit.zone === "HIGH_IMPACT" || fit.zone === "EXCEEDS_LIMIT";

  return { daysUntilStart, pressure, unknownCostPlanning };
}

/** Whether an event is far enough past that any pressure/unknown-cost alert about it should resolve. */
export function hasEventPassed(event: FinancialEvent, asOfDate: string): boolean {
  return event.endDate < asOfDate;
}

const COVERAGE_RANK: Record<LiquidityCoverage, number> = { COMPLETE: 2, PARTIAL: 1, UNKNOWN: 0 };

export interface LiquidityCoverageChangeAssessment {
  readonly degraded: boolean;
  readonly improved: boolean;
}

/**
 * `previous === null` (no baseline yet) never counts as a degradation —
 * same bootstrap principle as `evaluateSafeToSpendChange`. Otherwise a
 * strict rank decrease (COMPLETE -> PARTIAL, COMPLETE -> UNKNOWN, PARTIAL
 * -> UNKNOWN) is a degradation; a strict increase is an improvement (used
 * to resolve an existing alert); no change is neither.
 */
export function evaluateLiquidityCoverageChange(
  previous: LiquidityCoverage | null,
  current: LiquidityCoverage,
): LiquidityCoverageChangeAssessment {
  if (previous === null) return { degraded: false, improved: false };
  const previousRank = COVERAGE_RANK[previous];
  const currentRank = COVERAGE_RANK[current];
  return { degraded: currentRank < previousRank, improved: currentRank > previousRank };
}

const ATTENTION_STATUSES: ReadonlySet<ProviderConnectionStatus> = new Set([
  "LOGIN_ERROR",
  "USER_ACTION_REQUIRED",
  "ERROR",
]);

export type ConnectionAttentionReasonCode =
  | "REPEATED_SYNC_FAILURE"
  | "STALE_SYNC"
  | "NONE";

export interface ConnectionAttentionAssessment {
  readonly needsAttention: boolean;
  readonly reasonCode: ConnectionAttentionReasonCode;
}

/**
 * A connection needs attention when EITHER its own status has reported an
 * attention-worthy state (login error / user action required / generic
 * error) for at least `connectionConsecutiveFailureThreshold` consecutive
 * sync attempts (never on a single transient error — see the Sprint 7
 * brief's explicit "do not alert for one transient harmless sync error"),
 * OR a CONNECTED connection has gone stale (no successful sync in
 * `connectionStaleSyncDays` days) despite reporting a healthy status —
 * silence from a connection that claims to be fine is itself a signal.
 * `DISCONNECTED`/`PENDING` never need attention here — a disconnected
 * connection is an explicit, already-understood user action, not a fault.
 */
export function evaluateConnectionAttention(
  status: ProviderConnectionStatus,
  consecutiveAttentionStatusSyncs: number,
  daysSinceLastSuccessfulSync: number | null,
  policy: AlertPolicy = DEFAULT_ALERT_POLICY,
): ConnectionAttentionAssessment {
  if (ATTENTION_STATUSES.has(status) && consecutiveAttentionStatusSyncs >= policy.connectionConsecutiveFailureThreshold) {
    return { needsAttention: true, reasonCode: "REPEATED_SYNC_FAILURE" };
  }
  if (
    status === "CONNECTED" &&
    daysSinceLastSuccessfulSync !== null &&
    daysSinceLastSuccessfulSync >= policy.connectionStaleSyncDays
  ) {
    return { needsAttention: true, reasonCode: "STALE_SYNC" };
  }
  return { needsAttention: false, reasonCode: "NONE" };
}

export { daysBetween as alertDaysBetween };
