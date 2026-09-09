import type { BudgetFitResult } from "@money-copilot/financial-engine";
import type { ActivityType, VenueCandidate } from "@money-copilot/discovery";
import type { Id } from "@money-copilot/shared";

/**
 * The Sprint 6 concierge domain — deliberately separate from Sprint 5's
 * Recommendation engine (see docs/RECOMMENDATIONS.md vs docs/CONCIERGE.md,
 * "Relationship to the Recommendations engine"). A restaurant suggestion is
 * never a `Recommendation` entity; these types never appear in
 * `packages/financial-engine/src/domain/recommendation*.ts`.
 */

/** Who is expected to pay — see docs/CONCIERGE.md, "Party size and payment responsibility." */
export type PaymentResponsibility = "SELF_ONLY" | "FULL_PARTY" | "PARTIAL" | "UNKNOWN";

/**
 * The AI-interpreted structured request — this IS the tool-call argument
 * shape (Zod-validated in `copilot/tools.ts`), not a separate NLU parser.
 * `requiredComponents`/`optionalComponents` must never be assumed beyond
 * what the user's message actually implies (Sprint 6 brief, "required vs
 * optional components": never silently add Uber/parking/dessert/tip).
 */
export interface ConciergeIntent {
  readonly requiredComponents: readonly ActivityType[];
  readonly optionalComponents: readonly ActivityType[];
  readonly location?: string;
  readonly dateTime?: string;
  readonly partySize?: number;
  readonly paymentResponsibility: PaymentResponsibility;
  /** The user's own explicit stated ceiling, if any — never invented. See `deriveSearchCeiling`. */
  readonly userExplicitBudgetCents?: number;
  readonly preferences?: readonly string[];
  readonly avoidances?: readonly string[];
  readonly notes?: string;
}

/** One component's contribution to a plan — `venue`/`costRange` are absent when no candidate was chosen or no price evidence exists. */
export interface PlanComponent {
  readonly activityType: ActivityType;
  readonly required: boolean;
  readonly venue?: VenueCandidate;
  readonly costRangeCents: { readonly min: number; readonly max: number } | null;
}

/**
 * One deterministic combination of components — e.g. "dinner only" or
 * "dinner + lodging." `baseBudgetFit` covers only the REQUIRED components
 * (never inflated by an optional one the user hasn't committed to); see
 * docs/CONCIERGE.md, "Optional component presentation."
 */
export interface OutingPlan {
  readonly id: string;
  readonly label: string;
  readonly components: readonly PlanComponent[];
  readonly baseCostRangeCents: { readonly min: number; readonly max: number } | null;
  readonly totalCostRangeCents: { readonly min: number; readonly max: number } | null;
  readonly baseBudgetFit: BudgetFitResult;
  readonly totalBudgetFit: BudgetFitResult;
}

/**
 * A non-financial fact traceable to a discovery tool's actual output —
 * kept separate from `FinancialFact` (Sprint 4/4.5/5) since it describes
 * an EXTERNAL venue, never the user's own money. Populated structurally by
 * the orchestrator directly from tool results — never written by the LLM
 * — so every entry is grounded BY CONSTRUCTION rather than verified after
 * the fact via fragile text-pattern matching. See docs/CONCIERGE.md,
 * "Discovery grounding."
 */
export interface DiscoveryFact {
  readonly label: string;
  readonly value: string;
  readonly venueName: string;
  readonly sourceTool: string;
  readonly provider: string;
  /** Present only for a price-evidence fact — the raw cents amount(s) this fact represents, reused to ground any BRL figure the assistant mentions about this venue (see `copilot/discovery-facts.ts`). */
  readonly amountsCents?: readonly number[];
}

export interface ConciergeSession {
  readonly id: Id<"concierge-session">;
  readonly financialProfileId: Id<"financial-profile">;
  readonly intent: ConciergeIntent;
  /** The exact envelope figures (cents) this session's plans were evaluated against — see docs/CONCIERGE.md, "Stale financial context." */
  readonly envelopeSnapshot: {
    readonly recommendedAmountCents: number;
    readonly cautionAmountCents: number;
    readonly asOfDate: string;
  };
  /** Every plan this session proposed — lets `saveConciergePlan` look one up by its short id alone. */
  readonly plans: readonly OutingPlan[];
  readonly createdAt: string;
}

export interface SavedConciergePlan {
  readonly id: Id<"saved-concierge-plan">;
  readonly sessionId: Id<"concierge-session">;
  readonly financialProfileId: Id<"financial-profile">;
  readonly plan: OutingPlan;
  readonly status: "SELECTED";
  readonly createdAt: string;
}
