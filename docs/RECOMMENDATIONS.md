# Money Copilot — Recommendation Engine (Sprint 5)

This document covers the recommendation discovery/decision/verification system added in Sprint 5.
Read `docs/PROJECT_STATE.md` first for the full continuity account; this file is the detailed
reference for how the recommendation engine is built and why. See `docs/DECISIONS.md` DEC-056
through DEC-064 for the individual architectural decisions this document summarizes.

## The one rule everything else follows

Money Copilot never invents a recurring amount, a saving, a monthly/annual impact, an effective date,
transaction evidence, a verification result, or eligibility for a recommendation. Every BRL figure a
recommendation shows traces to persisted financial data, a deterministic calculation in
`@money-copilot/financial-engine`, or the user's own explicit input — exactly the same rule that
already governs the AI copilot (`docs/AI-COPILOT.md`).

## Candidate generation

`generateRecommendationCandidates` (`packages/financial-engine/src/domain/recommendation-generation.ts`)
is a pure function, reusing `detectRecurringCandidates` (Sprint 2) unchanged. A transaction is
eligible evidence only when ALL of the following hold, evaluated in this order:

1. `financialEffect === "CONSUMPTION"` — the `RecommendationPolicy`'s `eligibleFinancialEffects`
   default excludes TRANSFER, CARD_PAYMENT, DEBT_PAYMENT, REFUND, FEE, and INCOME by construction.
2. `category !== null` — an uncategorized transaction is ambiguous by definition and never becomes a
   recommendation (see DEC-063 for why this matters more than it first appears).
3. Its category is not in `protectedCategories(preferences, fixedExpenses)` — see "Protected
   preferences" below. Evaluated BEFORE anything else that follows, per the brief's explicit
   ordering requirement.
4. Its category is not in the policy's `excludedCategories` default list (Housing, Family Support,
   Insurance, Utilities, Healthcare, Taxes, Debt) — a defense-in-depth product default, never a
   substitute for #3.

Surviving transactions go through `detectRecurringCandidates` (merchant + amount-bucket grouping,
2+ occurrences, amount similarity, cadence). For each resulting pattern:

- `classifyCadence` (`recommendation-cadence.ts`) maps the observed interval to `WEEKLY` / `MONTHLY`
  / `YEARLY` / `UNKNOWN` — mirroring `recurring.ts`'s own 20–40-day "monthly" bounds rather than a
  second, inconsistent definition.
- `monthlyEquivalentAmount` converts to a monthly figure ONLY for a recognized cadence — `UNKNOWN`
  returns `null`, and the candidate becomes `REVIEW_RECURRING_COST` rather than `CANCEL_RECURRING_COST`
  regardless of confidence. This is what prevents ever multiplying a weekly/yearly charge as if it
  were monthly.
- Confidence gates the proposed type: `HIGH` confidence + a recognized cadence →
  `CANCEL_RECURRING_COST`; anything real but below that (or an unrecognized cadence) →
  `REVIEW_RECURRING_COST`, whose impact is always presented as informational, never a guaranteed
  saving.

## Recommendation types

- **`CANCEL_RECURRING_COST`** — monthly impact = the monthly-equivalent amount; annual impact =
  monthly × 12 (`annualImpactFromMonthly`).
- **`REDUCE_RECURRING_COST`** — only ever set by an explicit user `MODIFY` action with a stated
  target amount. `computeReductionImpact(current, target)` returns `null` (not zero, not negative)
  whenever `target >= current` — the caller must reject that as "not a savings recommendation," never
  silently show a zero/negative figure.
- **`REVIEW_RECURRING_COST`** — a real, recurring cost that isn't confident enough to propose
  cancelling outright. `REDIRECT_FREED_CASHFLOW` (mentioned as optional in the brief) was
  deliberately NOT implemented — out of scope, per the brief's own "do not expand the sprint
  unnecessarily."

## Protected preferences

`protectedCategories(preferences, fixedExpenses)` (`packages/financial-engine/src/domain/preference.ts`)
resolves every `ProtectedPreference` to the category(ies) it shields — directly for a
`CATEGORY`-scoped preference, or via the referenced `FixedExpense`'s own category for an
`EXPENSE`-scoped one (e.g. the Founder's real family-support fixture, `motherSupportPreference` →
`motherSupport.category === "Family Support"`). This check runs BEFORE recurring-pattern detection,
confidence scoring, or impact calculation — generic by construction, so any future
`ProtectedPreference` gets the identical treatment with zero engine changes.

## Identity and idempotency

`Recommendation.identityKey` is computed once, at generation time, from the freshly-detected evidence
— never from a random id, and never recomputed from a recommendation's CURRENT (possibly
user-`MODIFIED`) `type`:

```
identityKey = financialProfileId : type : normalizedMerchant : cadence : amountBucket : paymentSourceId
```

`amountBucket` rounds the representative amount to the nearest `identityAmountBucketCents` (default
100 cents), mirroring `detectRecurringCandidates`'s own bucketing — a genuine price change earns a
NEW identity rather than silently blending with the old one.

`evaluateRecommendations` (`packages/app-services/src/recommendation-service.ts`) is strictly
ADD-ONLY: for each candidate, `findRecommendationByIdentityKey` decides whether to insert a new
PENDING row or do nothing. An existing row of ANY status — including REJECTED — means "nothing to
do." The database enforces this too: `recommendations` has a UNIQUE constraint on
`(financialProfileId, identityKey)`, mirroring DEC-023's `ProviderConnection` uniqueness pattern.

This single rule is simultaneously:
- **Idempotency** — three identical syncs (or three calls to `evaluateRecommendations`) never
  duplicate a recommendation.
- **Suppression** — a REJECTED recommendation's `identityKey` never gets a new PENDING sibling, so
  it never resurfaces unchanged.
- **Material-change resurfacing** — because `identityKey` embeds merchant, cadence, amount bucket,
  and type, a genuinely different opportunity (a real price change, a cadence change, a different
  merchant) produces a DIFFERENT key with no existing row, and therefore becomes eligible again
  automatically — no separate "resurfacing" code path exists or is needed.

## Lifecycle and decision history

`RecommendationStatus`: `PENDING` → `ACCEPTED` | `MODIFIED` | `REJECTED` → (`ACCEPTED`/`MODIFIED`
only) → `VERIFIED` | `FAILED`. Every transition appends to `decisionHistory` (an append-only
`RecommendationDecisionEvent[]`) — prior states are never overwritten or lost.

- **ACCEPT** (`acceptRecommendation`) — only valid from `PENDING`, and only for a concrete action
  type (`CANCEL_RECURRING_COST` or an already-`MODIFIED`-into `REDUCE_RECURRING_COST`) —
  `REVIEW_RECURRING_COST` has no single concrete action to accept; the caller must `MODIFY` it into
  one first. Sets `effectiveDate` to the user's stated date, or "today" if unstated (a reasonable
  operational default, never an invented financial value).
- **MODIFY** (`modifyRecommendation`) — valid from `PENDING`, `ACCEPTED`, or `MODIFIED` (re-modifying
  is allowed). A `targetAmount`, when given, must already be the user's own explicit figure —
  `computeReductionImpact` recalculates impact from it; the function throws rather than silently
  accepting a target that would not be a savings recommendation. Can also just change
  `effectiveDate` (e.g. "cancel it, but only next month") without touching the amount.
- **REJECT** (`rejectRecommendation`) — only valid from `PENDING`. This is the entire suppression
  mechanism (see "Identity and idempotency" above) — no separate suppression flag or table exists.

## Safe-to-Spend separation

**Accepting a recommendation never increases current Safe-to-Spend.** User intention is not actual
financial savings. `acceptRecommendation`/`modifyRecommendation` touch only the `recommendations`
table — they never write to any table `buildFinancialSnapshot` reads from. `queries.ts`'s
`getRecommendationsSummary` exposes three DISTINCT, never-blended figures:

- `potentialMonthlySavingsCents` — sum of PENDING `CANCEL`/`REDUCE` (never `REVIEW`) impacts.
- `acceptedExpectedMonthlySavingsCents` — sum of ACCEPTED/MODIFIED impacts (stated intent, not yet
  confirmed).
- `verifiedMonthlySavingsCents` — sum of VERIFIED impacts only — the only figure backed by confirmed
  evidence.

Regression-tested directly (`recommendation-service.test.ts`, "(I) accepting a recommendation does
not change current Safe-to-Spend").

## Verification

`assessVerification` (`packages/financial-engine/src/domain/recommendation-verification.ts`) is a
pure function returning a `VerificationAssessment` — `NOT_DUE`, `INCONCLUSIVE`, `CONFIRMED_SUCCESS`,
or `CONFIRMED_FAILURE` — kept deliberately separate from `RecommendationStatus` so "insufficient
evidence" never corrupts the lifecycle. Only `CONFIRMED_SUCCESS`/`CONFIRMED_FAILURE` ever cause
`evaluateRecommendationVerifications` (`packages/app-services/src/recommendation-service.ts`) to
transition status to VERIFIED/FAILED.

Order of checks:
1. **Grace period** — `daysBetween(effectiveDate, asOfDate) < verificationGracePeriodDays` (default
   45 days) → `NOT_DUE`.
2. **Evidence sufficiency** — if the evidence is provider-backed (`paymentSourceId` set) and that
   connection's `lastSuccessfulSyncAt` is more than `maxSyncStalenessDaysForVerification` (default 10
   days) old → `INCONCLUSIVE`. Absence of a recent sync is not proof of anything. A manual-only
   recommendation (no `paymentSourceId`) is never blocked by this check.
3. **CANCEL**: any matching transaction after `effectiveDate` → `CONFIRMED_FAILURE` (the charge
   continued); none → `CONFIRMED_SUCCESS`.
4. **REDUCE**: no matching transaction at all → `INCONCLUSIVE` (absence is not proof of a *reduction*
   specifically); an amount within `reductionAmountToleranceRatio` (default 5%) of the user's target
   → `CONFIRMED_SUCCESS`; within that same tolerance of the OLD amount → `CONFIRMED_FAILURE`;
   anything else → `INCONCLUSIVE` (never force a binary call from an ambiguous amount).

Transaction matching reuses existing identity (`normalizedMerchant`, optionally `paymentSourceId`) —
no second, disconnected matching implementation — so a recommendation survives a new monthly provider
transaction id representing the same economic recurring charge.

Once VERIFIED or FAILED, a recommendation is terminal: `evaluateRecommendationVerifications` only
ever selects ACCEPTED/MODIFIED recommendations, so repeated syncs never re-transition an
already-decided outcome.

## Sync integration

`syncConnection` (`packages/app-services/src/sync.ts`) calls `evaluateRecommendations` then
`evaluateRecommendationVerifications` after every successful import, in its own try/catch (a problem
here never fails the sync itself). The same pair also runs on every homepage load
(`apps/web/app/page.tsx`), so fixture/demo-mode users see recommendations too, generated from any
qualifying MANUAL-origin transactions.

## AI tools and grounding

Five tools, following the exact Sprint 4 allowlist pattern (`packages/app-services/src/copilot/tools.ts`):
`getRecommendations`/`getRecommendationDetails` (READ), `acceptRecommendation`/
`modifyRecommendation`/`rejectRecommendation` (MUTATION, gated by `hasExplicitMutationIntent` exactly
like every other mutation tool). `mutation-guard.ts`'s pattern lists were extended (English + PT-BR)
with recommendation-decision language (DEC-064) — reading recommendations never mutates; ambiguous or
hypothetical language never mutates; an explicit decision mutates exactly once.

`recommendationFacts` (`packages/app-services/src/copilot/facts.ts`) exposes every monetary field a
`Recommendation` carries (observed amount, monthly-equivalent amount, monthly/annual impact, a
MODIFIED user target) to grounding, plus the three aggregate figures for `getRecommendations` — added
proactively (DEC-062) per the Sprint 4.5 lesson that a correct-but-ungrounded tool result is still a
product bug.

## UX disclaimer

Accepting "Cancel Netflix" records that the user INTENDS to cancel it and schedules deterministic
verification — Money Copilot never contacts Netflix or performs any external cancellation. The
Recommendations panel states this explicitly; status copy ("Aguardando confirmação pelas próximas
movimentações" / "Economia confirmada" / "A cobrança continuou") never shames the user for a
rejection or a FAILED verification.

## Known limitations

- V1 candidate generation only considers CONSUMPTION-effect transactions grouped by merchant and
  amount — it does not yet examine `FixedExpense` entries directly (only indirectly, via
  `protectedCategories`), so a recurring cost that only ever appears as a `FixedExpense` (never a
  transaction) cannot yet become a recommendation.
- No UI affordance exists yet for a rejected recommendation to be explicitly reconsidered by the user
  outside of the underlying opportunity materially changing — the brief lists "user explicitly
  requests reconsideration" as a potential material change, but no dedicated action was built for it
  this sprint.
- `evaluateRecommendationVerifications`'s REDUCE-path matching uses the single MOST RECENT matching
  transaction after `effectiveDate` — a merchant that briefly bills at an intermediate amount before
  settling could, in principle, need more than one verification pass to resolve; this is a reasonable
  and explicit tradeoff (never a hidden one), not a bug.
- Sprint 6 concierge/search, real-world price discovery, and any external cancellation capability
  remain explicitly out of scope, as instructed.
