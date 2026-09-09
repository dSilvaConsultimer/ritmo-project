import { createId, type Id } from "@money-copilot/shared";
import { deriveSearchCeiling, evaluateBudgetFit, fromCents, type BudgetFitResult } from "@money-copilot/financial-engine";
import type { ActivityType, DiscoverySearchCriteria, VenueCandidate } from "@money-copilot/discovery";
import type { Database } from "@money-copilot/persistence";
import * as repo from "@money-copilot/persistence";
import { getSpendingEnvelopeForProfile } from "../queries";
import { createPlannedFinancialEvent } from "../mutations";
import { getDiscoveryProvider, type DiscoveryProviderName } from "../discovery-provider-registry";
import { buildConciergePlans as buildPlansPure } from "./plan-builder";
import type { ConciergeIntent, ConciergeSession, DiscoveryFact, OutingPlan, SavedConciergePlan } from "./types";

function nowIso(): string {
  return new Date().toISOString();
}

export interface ConciergeBudget {
  readonly recommendedAmountCents: number;
  readonly cautionAmountCents: number;
  readonly searchCeilingCents: number;
  readonly asOfDate: string;
}

/**
 * The financial envelope MUST be resolved before anything discovery-related
 * ever runs — see docs/CONCIERGE.md, "Financial-envelope-first." This
 * reuses `getSpendingEnvelopeForProfile` (Sprint 4) unchanged; the
 * concierge never independently calculates a replacement budget.
 */
export async function getConciergeBudget(
  db: Database,
  financialProfileId: string,
  asOfDate: string,
  userExplicitBudgetCents?: number,
): Promise<ConciergeBudget> {
  const envelope = await getSpendingEnvelopeForProfile(db, financialProfileId, asOfDate);
  const userCeiling = userExplicitBudgetCents !== undefined ? fromCents(userExplicitBudgetCents) : undefined;
  const searchCeiling = deriveSearchCeiling(envelope, userCeiling);
  return {
    recommendedAmountCents: envelope.recommendedAmount.cents,
    cautionAmountCents: envelope.cautionAmount.cents,
    searchCeilingCents: searchCeiling.cents,
    asOfDate,
  };
}

/**
 * Builds discovery search criteria containing ONLY derived, non-financial
 * constraints — see docs/CONCIERGE.md, "Privacy boundary." Never includes
 * income, balance, debt, protected preferences, transaction history, or
 * any Safe-to-Spend internals — only what discovery genuinely needs.
 */
function buildSearchCriteria(
  activityType: ActivityType,
  intent: Pick<ConciergeIntent, "location" | "partySize" | "preferences" | "avoidances" | "dateTime">,
  searchCeilingCents: number,
): DiscoverySearchCriteria {
  return {
    activityType,
    location: intent.location ?? "",
    maxPriceCents: searchCeilingCents,
    ...(intent.partySize !== undefined ? { partySize: intent.partySize } : {}),
    ...(intent.preferences ? { preferences: intent.preferences } : {}),
    ...(intent.avoidances ? { avoidances: intent.avoidances } : {}),
    ...(intent.dateTime ? { dateTime: intent.dateTime } : {}),
  };
}

export interface ConciergeSearchResult {
  readonly candidates: readonly VenueCandidate[];
  readonly discoveryFacts: readonly DiscoveryFact[];
}

function factsFromCandidates(candidates: readonly VenueCandidate[], sourceTool: string): DiscoveryFact[] {
  const facts: DiscoveryFact[] = [];
  for (const v of candidates) {
    facts.push({ label: `${v.name}: name`, value: v.name, venueName: v.name, sourceTool, provider: v.provider });
    if (v.rating !== undefined) {
      facts.push({ label: `${v.name}: rating`, value: String(v.rating), venueName: v.name, sourceTool, provider: v.provider });
    }
    if (v.address) {
      facts.push({ label: `${v.name}: address`, value: v.address, venueName: v.name, sourceTool, provider: v.provider });
    }
    for (const price of v.priceEvidence) {
      const amountsCents: number[] = [];
      if (price.amountCents !== undefined) amountsCents.push(price.amountCents);
      if (price.minAmountCents !== undefined) amountsCents.push(price.minAmountCents);
      if (price.maxAmountCents !== undefined) amountsCents.push(price.maxAmountCents);
      const value =
        price.priceType === "RANGE"
          ? `${price.minAmountCents}-${price.maxAmountCents} ${price.currency}`
          : price.amountCents !== undefined
            ? `${price.amountCents} ${price.currency}`
            : "unknown";
      facts.push({
        label: `${v.name}: price (${price.priceType})`,
        value,
        venueName: v.name,
        sourceTool,
        provider: v.provider,
        ...(amountsCents.length > 0 ? { amountsCents } : {}),
      });
    }
  }
  return facts;
}

function factsFromPlans(plans: readonly OutingPlan[], sourceTool: string): DiscoveryFact[] {
  return plans.map((plan) => ({
    label: `${plan.label}: total cost range`,
    value: plan.totalCostRangeCents ? `${plan.totalCostRangeCents.min}-${plan.totalCostRangeCents.max} BRL` : "unknown",
    venueName: plan.label,
    sourceTool,
    provider: "concierge",
    ...(plan.totalCostRangeCents
      ? { amountsCents: [plan.totalCostRangeCents.min, plan.totalCostRangeCents.max] }
      : {}),
  }));
}

/** Requires the caller to have ALREADY resolved the financial envelope — never called on its own to determine spend limits. */
export async function searchConciergePlaces(
  db: Database,
  financialProfileId: string,
  asOfDate: string,
  activityType: ActivityType,
  intent: Pick<ConciergeIntent, "location" | "partySize" | "preferences" | "avoidances" | "dateTime" | "userExplicitBudgetCents">,
  providerName: DiscoveryProviderName = "mock",
): Promise<ConciergeSearchResult> {
  const budget = await getConciergeBudget(db, financialProfileId, asOfDate, intent.userExplicitBudgetCents);
  const provider = getDiscoveryProvider(providerName);
  const criteria = buildSearchCriteria(activityType, intent, budget.searchCeilingCents);
  const candidates = await provider.searchPlaces(criteria);
  return { candidates, discoveryFacts: factsFromCandidates(candidates, "searchPlaces") };
}

export interface ConciergePlansResult {
  readonly sessionId: Id<"concierge-session">;
  readonly budget: ConciergeBudget;
  readonly plans: readonly OutingPlan[];
  readonly discoveryFacts: readonly DiscoveryFact[];
}

/**
 * The full orchestration: envelope FIRST, then search for every required/
 * optional component (never assuming a component the intent doesn't list —
 * see docs/CONCIERGE.md, "Required vs optional components"), then
 * deterministic plan building/ranking. Persists one `ConciergeSession`
 * recording the exact envelope figures used, so a later "is this still
 * valid?" check has something to compare against (see
 * `reevaluateConciergePlan`).
 */
export async function buildConciergePlansForProfile(
  db: Database,
  financialProfileId: string,
  asOfDate: string,
  intent: ConciergeIntent,
  providerName: DiscoveryProviderName = "mock",
): Promise<ConciergePlansResult> {
  const envelope = await getSpendingEnvelopeForProfile(db, financialProfileId, asOfDate);
  const budget = await getConciergeBudget(db, financialProfileId, asOfDate, intent.userExplicitBudgetCents);
  const provider = getDiscoveryProvider(providerName);

  const allComponents = [...intent.requiredComponents, ...intent.optionalComponents];
  const candidatesByComponent = new Map<ActivityType, readonly VenueCandidate[]>();
  const allDiscoveryFacts: DiscoveryFact[] = [];

  for (const activityType of allComponents) {
    const criteria = buildSearchCriteria(activityType, intent, budget.searchCeilingCents);
    const candidates = await provider.searchPlaces(criteria);
    candidatesByComponent.set(activityType, candidates);
    allDiscoveryFacts.push(...factsFromCandidates(candidates, "buildConciergePlans"));
  }

  const userCeiling = intent.userExplicitBudgetCents !== undefined ? fromCents(intent.userExplicitBudgetCents) : undefined;
  const plans = buildPlansPure(intent, envelope, candidatesByComponent, userCeiling);
  allDiscoveryFacts.push(...factsFromPlans(plans, "buildConciergePlans"));

  const session: ConciergeSession = {
    id: createId("concierge-session"),
    financialProfileId: financialProfileId as Id<"financial-profile">,
    intent,
    envelopeSnapshot: {
      recommendedAmountCents: envelope.recommendedAmount.cents,
      cautionAmountCents: envelope.cautionAmount.cents,
      asOfDate,
    },
    plans,
    createdAt: nowIso(),
  };
  await repo.upsertConciergeSessionRow(db, {
    id: session.id,
    financialProfileId: session.financialProfileId,
    intentJson: JSON.stringify(session.intent),
    envelopeRecommendedAmountCents: session.envelopeSnapshot.recommendedAmountCents,
    envelopeCautionAmountCents: session.envelopeSnapshot.cautionAmountCents,
    envelopeAsOfDate: session.envelopeSnapshot.asOfDate,
    plansJson: JSON.stringify(session.plans),
    createdAt: session.createdAt,
  });

  return { sessionId: session.id, budget, plans, discoveryFacts: allDiscoveryFacts };
}

function sessionFromRow(row: NonNullable<Awaited<ReturnType<typeof repo.getConciergeSessionRowById>>>): ConciergeSession {
  return {
    id: row.id as Id<"concierge-session">,
    financialProfileId: row.financialProfileId as Id<"financial-profile">,
    intent: JSON.parse(row.intentJson) as ConciergeIntent,
    envelopeSnapshot: {
      recommendedAmountCents: row.envelopeRecommendedAmountCents,
      cautionAmountCents: row.envelopeCautionAmountCents,
      asOfDate: row.envelopeAsOfDate,
    },
    plans: JSON.parse(row.plansJson) as OutingPlan[],
    createdAt: row.createdAt,
  };
}

async function requireSession(db: Database, sessionId: string): Promise<ConciergeSession> {
  const row = await repo.getConciergeSessionRowById(db, sessionId);
  if (!row) throw new Error(`No concierge session ${sessionId}`);
  return sessionFromRow(row);
}

function requirePlanInSession(session: ConciergeSession, planId: string): OutingPlan {
  const plan = session.plans.find((p) => p.id === planId);
  if (!plan) throw new Error(`No plan ${planId} in concierge session ${session.id}`);
  return plan;
}

export interface PlanValidityResult {
  readonly plan: OutingPlan;
  readonly stale: boolean;
  readonly currentBudget: ConciergeBudget;
}

/**
 * "Esse orçamento ainda é válido?" — re-evaluates a plan's budget fit
 * against the LATEST envelope rather than trusting however long ago it was
 * first built (Sprint 6 brief, "Stale financial context"). `stale` is true
 * whenever the recommended/caution figures have changed at all since the
 * plan's session was created. Takes only `sessionId`/`planId` (both short
 * strings the caller already has from a prior `buildConciergePlans` tool
 * result) — never requires re-transmitting the full plan object.
 */
export async function reevaluateConciergePlan(
  db: Database,
  financialProfileId: string,
  asOfDate: string,
  sessionId: string,
  planId: string,
): Promise<PlanValidityResult> {
  const originalSession = await requireSession(db, sessionId);
  const plan = requirePlanInSession(originalSession, planId);
  const currentEnvelope = await getSpendingEnvelopeForProfile(db, financialProfileId, asOfDate);
  const currentBudget = await getConciergeBudget(db, financialProfileId, asOfDate);

  const stale =
    originalSession.envelopeSnapshot.recommendedAmountCents !== currentEnvelope.recommendedAmount.cents ||
    originalSession.envelopeSnapshot.cautionAmountCents !== currentEnvelope.cautionAmount.cents;

  const totalRange = plan.totalCostRangeCents
    ? { min: fromCents(plan.totalCostRangeCents.min), max: fromCents(plan.totalCostRangeCents.max) }
    : null;
  const totalBudgetFit: BudgetFitResult = evaluateBudgetFit(currentEnvelope, totalRange);

  return { plan: { ...plan, totalBudgetFit }, stale, currentBudget };
}

/**
 * Saving a plan is NEVER spending — see docs/CONCIERGE.md, "Plan vs. actual
 * spending." Idempotent by (financialProfileId, planId). Takes only
 * `sessionId`/`planId`, looked up from the session's own stored plans —
 * never requires the caller (including the LLM) to re-transmit the full
 * plan object.
 */
export async function saveConciergePlan(
  db: Database,
  financialProfileId: string,
  sessionId: string,
  planId: string,
): Promise<SavedConciergePlan> {
  const existingRow = await repo.findSavedConciergePlanRowByPlanId(db, financialProfileId, planId);
  if (existingRow) {
    return {
      id: existingRow.id as Id<"saved-concierge-plan">,
      sessionId: existingRow.sessionId as Id<"concierge-session">,
      financialProfileId: existingRow.financialProfileId as Id<"financial-profile">,
      plan: JSON.parse(existingRow.planJson) as OutingPlan,
      status: existingRow.status,
      createdAt: existingRow.createdAt,
    };
  }

  const session = await requireSession(db, sessionId);
  const plan = requirePlanInSession(session, planId);

  const saved: SavedConciergePlan = {
    id: createId("saved-concierge-plan"),
    sessionId: sessionId as Id<"concierge-session">,
    financialProfileId: financialProfileId as Id<"financial-profile">,
    plan,
    status: "SELECTED",
    createdAt: nowIso(),
  };
  await repo.upsertSavedConciergePlanRow(db, {
    id: saved.id,
    sessionId: saved.sessionId,
    financialProfileId: saved.financialProfileId,
    planId: plan.id,
    planJson: JSON.stringify(plan),
    status: saved.status,
    createdAt: saved.createdAt,
  });
  return saved;
}

export interface ReservePlanBudgetInput {
  readonly label: string;
  readonly amountCents: number;
  readonly startDate: string;
  readonly endDate?: string;
}

/**
 * "Separa R$250 para isso" — reuses the EXISTING `FinancialEvent`
 * architecture (Sprint 1/4) rather than inventing a parallel reservation
 * mechanism (Sprint 6 brief, section 43). This is a planned budget
 * reservation, never a `FinancialTransaction` — no money has been spent.
 */
export async function reservePlanBudget(db: Database, financialProfileId: string, input: ReservePlanBudgetInput) {
  return createPlannedFinancialEvent(db, financialProfileId, {
    label: input.label,
    startDate: input.startDate,
    endDate: input.endDate ?? input.startDate,
    budgetAmount: fromCents(input.amountCents),
  });
}

/** For the dashboard's "Saved plans" section — every plan the user has explicitly selected, most recent first. */
export async function listSavedConciergePlansForProfile(
  db: Database,
  financialProfileId: string,
): Promise<readonly SavedConciergePlan[]> {
  const rows = await repo.listSavedConciergePlansForProfile(db, financialProfileId);
  return rows
    .map((row) => ({
      id: row.id as Id<"saved-concierge-plan">,
      sessionId: row.sessionId as Id<"concierge-session">,
      financialProfileId: row.financialProfileId as Id<"financial-profile">,
      plan: JSON.parse(row.planJson) as OutingPlan,
      status: row.status,
      createdAt: row.createdAt,
    }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
