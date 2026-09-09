import { createId } from "@money-copilot/shared";
import { evaluateBudgetFit, fromCents, type BudgetFitResult, type Money, type SpendingEnvelope } from "@money-copilot/financial-engine";
import type { ActivityType, VenueCandidate } from "@money-copilot/discovery";
import { DEFAULT_CONCIERGE_RANKING_POLICY, rankVenueCandidates, type ConciergeRankingPolicy } from "./ranking";
import type { ConciergeIntent, OutingPlan, PlanComponent } from "./types";

export interface CostRangeCents {
  readonly min: number;
  readonly max: number;
}

/**
 * A `FULL_PARTY` payment responsibility is the ONLY case that multiplies a
 * per-person price by party size — see Sprint 6 brief, "User pays for
 * others": "Do not assume bill splitting if user says they expect to pay,"
 * and the converse: never invent a full-party multiplier without an
 * explicit signal. `SELF_ONLY`/`PARTIAL`/`UNKNOWN` all conservatively use a
 * multiplier of 1 (the user's own share only, or the single best-known
 * figure when responsibility is genuinely unclear).
 */
export function resolvePartyMultiplier(
  paymentResponsibility: ConciergeIntent["paymentResponsibility"],
  partySize: number | undefined,
): number {
  if (paymentResponsibility === "FULL_PARTY" && partySize && partySize > 0) return partySize;
  return 1;
}

/**
 * Derives a deterministic cost range (cents) from one venue's price
 * evidence — `null` when no usable numeric estimate exists. `PRICE_LEVEL`
 * evidence NEVER converts to an amount in V1 (Sprint 6 brief, "price
 * evidence model": never invent a $-to-BRL mapping without an explicit,
 * documented, centralized policy — none exists yet, so it contributes no
 * estimate rather than a guessed one).
 */
export function venueCostRangeCents(venue: VenueCandidate, partyMultiplier: number): CostRangeCents | null {
  const evidence = venue.priceEvidence.find(
    (e) => e.priceType !== "UNKNOWN" && e.priceType !== "PRICE_LEVEL",
  );
  if (!evidence) return null;

  let min: number | undefined;
  let max: number | undefined;
  switch (evidence.priceType) {
    case "EXACT":
    case "STARTING_AT":
    case "ESTIMATED":
      min = evidence.amountCents;
      max = evidence.amountCents;
      break;
    case "RANGE":
      min = evidence.minAmountCents;
      max = evidence.maxAmountCents;
      break;
  }
  if (min === undefined || max === undefined) return null;

  const multiplier = evidence.basis === "PER_PERSON" ? partyMultiplier : 1;
  return { min: Math.round(min * multiplier), max: Math.round(max * multiplier) };
}

/** Any missing (`null`) component cost makes the COMBINED total unknown — never silently treated as zero. See Sprint 6 brief, "Unknown future components." */
export function sumCostRangesCents(ranges: readonly (CostRangeCents | null)[]): CostRangeCents | null {
  if (ranges.length === 0) return { min: 0, max: 0 };
  if (ranges.some((r) => r === null)) return null;
  return ranges.reduce<CostRangeCents>(
    (total, r) => ({ min: total.min + r!.min, max: total.max + r!.max }),
    { min: 0, max: 0 },
  );
}

function toMoneyRange(range: CostRangeCents | null): { min: Money; max: Money } | null {
  return range ? { min: fromCents(range.min), max: fromCents(range.max) } : null;
}

function budgetFitFor(
  envelope: SpendingEnvelope,
  range: CostRangeCents | null,
  userCeiling: Money | undefined,
): BudgetFitResult {
  return evaluateBudgetFit(envelope, toMoneyRange(range), userCeiling);
}

/**
 * Builds every deterministic required/optional combination — e.g. with one
 * optional component, exactly two plans ("base" and "base + optional"),
 * matching the Sprint 6 brief's own dinner/dinner+lodging example. Never
 * silently assumes a component the user didn't mention (`candidatesByComponent`
 * only contains entries the caller actually searched for, which in turn
 * only happens for `intent.requiredComponents`/`optionalComponents`).
 */
export function buildConciergePlans(
  intent: ConciergeIntent,
  envelope: SpendingEnvelope,
  candidatesByComponent: ReadonlyMap<ActivityType, readonly VenueCandidate[]>,
  userCeiling?: Money,
  rankingPolicy: ConciergeRankingPolicy = DEFAULT_CONCIERGE_RANKING_POLICY,
): readonly OutingPlan[] {
  const partyMultiplier = resolvePartyMultiplier(intent.paymentResponsibility, intent.partySize);

  function topCandidate(activityType: ActivityType): VenueCandidate | undefined {
    const candidates = candidatesByComponent.get(activityType) ?? [];
    if (candidates.length === 0) return undefined;
    const ranked = rankVenueCandidates(
      candidates,
      intent,
      (v) => budgetFitFor(envelope, venueCostRangeCents(v, partyMultiplier), userCeiling).zone,
      rankingPolicy,
    );
    return ranked[0]?.venue;
  }

  function componentFor(activityType: ActivityType, required: boolean): PlanComponent {
    const venue = topCandidate(activityType);
    const costRangeCents = venue ? venueCostRangeCents(venue, partyMultiplier) : null;
    return { activityType, required, ...(venue ? { venue } : {}), costRangeCents };
  }

  const requiredComponents = intent.requiredComponents.map((a) => componentFor(a, true));
  const optionalComponents = intent.optionalComponents.map((a) => componentFor(a, false));

  const baseCostRangeCents = sumCostRangesCents(requiredComponents.map((c) => c.costRangeCents));
  const baseBudgetFit = budgetFitFor(envelope, baseCostRangeCents, userCeiling);

  const plans: OutingPlan[] = [
    {
      id: createId("concierge-plan"),
      label: requiredComponents.length > 0 ? planLabel(requiredComponents.map((c) => c.activityType)) : "Base plan",
      components: requiredComponents,
      baseCostRangeCents,
      totalCostRangeCents: baseCostRangeCents,
      baseBudgetFit,
      totalBudgetFit: baseBudgetFit,
    },
  ];

  // Power set over optional components — bounded and small in practice
  // (Sprint 6 V1 supports at most a handful of optional components).
  for (const optional of powerSet(optionalComponents).filter((set) => set.length > 0)) {
    const allComponents = [...requiredComponents, ...optional];
    const totalCostRangeCents = sumCostRangesCents(allComponents.map((c) => c.costRangeCents));
    plans.push({
      id: createId("concierge-plan"),
      label: planLabel(allComponents.map((c) => c.activityType)),
      components: allComponents,
      baseCostRangeCents,
      totalCostRangeCents,
      baseBudgetFit,
      totalBudgetFit: budgetFitFor(envelope, totalCostRangeCents, userCeiling),
    });
  }

  return plans;
}

function powerSet<T>(items: readonly T[]): T[][] {
  return items.reduce<T[][]>((sets, item) => sets.concat(sets.map((set) => [...set, item])), [[]]);
}

function planLabel(activityTypes: readonly ActivityType[]): string {
  const labels: Record<ActivityType, string> = {
    DINING: "Dinner",
    DRINKS: "Drinks",
    LODGING: "Lodging",
    ENTERTAINMENT: "Entertainment",
    GENERIC_OUTING: "Outing",
  };
  return activityTypes.map((a) => labels[a]).join(" + ") || "Plan";
}
