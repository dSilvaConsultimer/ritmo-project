# Money Copilot — Concierge & Real-World Discovery (Sprint 6)

This document covers the budget-aware concierge system added in Sprint 6. Read
`docs/PROJECT_STATE.md` first for the full continuity account; this file is the detailed reference
for how the concierge is built and why. See `docs/DECISIONS.md` DEC-065 onward for the individual
architectural decisions this document summarizes.

## The one rule everything else follows

**Financial envelope first, discovery second — never the other way around.** External search must
NEVER determine Safe-to-Spend, and the LLM never invents a venue's existence, price, address, rating,
or opening status. Every real-world fact traces to actual discovery-provider evidence; every
financial figure traces to `@money-copilot/financial-engine`, exactly like the AI copilot (Sprint 4)
and recommendation engine (Sprint 5) before it.

```
FINANCIAL ENVELOPE → USER INTENT → DISCOVERY REQUIREMENTS → REAL-WORLD SEARCH →
PRICE EVIDENCE → BUDGET FIT → RANKED OPTIONS → AI EXPLANATION
```

## Architecture

A brand-new package, `@money-copilot/discovery`, mirrors `@money-copilot/open-finance`'s exact
pattern: a provider-neutral `LocalDiscoveryProvider` interface, a deterministic
`MockDiscoveryProvider`, and (when infrastructure exists) a future live adapter — never coupled to
Google, Yelp, or any specific vendor. Like Open Finance, `financial-engine` has zero dependency on
`discovery`, and `discovery` has zero dependency on `financial-engine` — the two domains only meet in
`packages/app-services/src/concierge/`, the orchestration layer:

```
packages/discovery/src/
  provider.ts        LocalDiscoveryProvider, VenueCandidate, PriceEvidence, DiscoverySearchCriteria
  mock-provider.ts    MockDiscoveryProvider — deterministic, obviously-synthetic venue data

packages/financial-engine/src/simulation/
  budget-fit.ts       evaluateBudgetFit, deriveSearchCeiling — pure, reuses SpendingEnvelope

packages/app-services/src/
  discovery-provider-registry.ts   mirrors provider-registry.ts exactly
  concierge/
    types.ts            ConciergeIntent, OutingPlan, PlanComponent, ConciergeSession, DiscoveryFact
    ranking.ts          ConciergeRankingPolicy, rankVenueCandidates
    plan-builder.ts     buildConciergePlans (pure combination/impact arithmetic)
    concierge-service.ts  orchestration: envelope → search → plans → session/save persistence
```

## Financial-envelope-first

`getConciergeBudget`/`searchConciergePlaces`/`buildConciergePlansForProfile`
(`concierge-service.ts`) all call `getSpendingEnvelopeForProfile` (Sprint 4, unchanged) before
anything discovery-related happens. The concierge never independently calculates a replacement
budget — it only ever reads the existing `SpendingEnvelope` (`recommendedAmount`, `cautionAmount`).
Regression-tested directly: `concierge-service.test.ts`'s "(A)" test proves the search ceiling passed
to the discovery provider is *exactly* the envelope's own caution ceiling — a value that cannot exist
unless the envelope was already computed.

## ConciergeIntent

The AI-interpreted structured request — this **is** the `buildConciergePlans`/`searchPlaces` tool-call
argument shape (Zod-validated, strict-mode compatible), not a separate NLU parser layer. Fields:
`requiredComponents`/`optionalComponents` (`ActivityType[]`: `DINING`/`DRINKS`/`LODGING`/
`ENTERTAINMENT`/`GENERIC_OUTING`), `location`, `dateTime`, `partySize`, `paymentResponsibility`
(`SELF_ONLY`/`FULL_PARTY`/`PARTIAL`/`UNKNOWN`), `userExplicitBudgetCents`, `preferences`,
`avoidances`, `notes`. Every tool description explicitly instructs the model never to invent a
component, party size, or payment responsibility beyond what the user's own words support.

## Required vs. optional components

"Jantar e talvez motel" → `requiredComponents: ["DINING"]`, `optionalComponents: ["LODGING"]`. Never
silently assumes Uber, parking, drinks, dessert, or tips. `buildConciergePlans` (`plan-builder.ts`)
builds the deterministic power-set over optional components — with one optional component, exactly
two plans ("dinner only" and "dinner + lodging"), matching the brief's own example.

## Party size and payment responsibility

`resolvePartyMultiplier(paymentResponsibility, partySize)` (`plan-builder.ts`) is the ONLY place a
per-person price is multiplied by party size — and only when `paymentResponsibility === "FULL_PARTY"`.
`SELF_ONLY`/`PARTIAL`/`UNKNOWN` all conservatively use a multiplier of 1 (never assume bill-splitting
or full payment without an explicit signal). "Vou sair com uma garota" is expected to be interpreted
by the model as `partySize: 2` (the language explicitly identifies the user plus one other person);
"provavelmente vou pagar o jantar" as `paymentResponsibility: "FULL_PARTY"`. These specific inferences
are LLM behavior, not a deterministic parser — validated via live/orchestrator testing, not unit
tests of a parsing function that doesn't exist.

## Price evidence model

`PriceEvidence` (`packages/discovery/src/provider.ts`) never treats a price as always exact:

- `EXACT` — a specific, confirmed amount.
- `RANGE` — a min/max band.
- `STARTING_AT` — a floor only.
- `PRICE_LEVEL` — a coarse 1-4 ("$".."$$$$") indicator. **V1 never converts this to a BRL amount** —
  no documented, centralized `$`→BRL policy exists yet, so a `PRICE_LEVEL`-only venue contributes no
  numeric cost estimate at all (`plan-builder.ts`'s `venueCostRangeCents` explicitly skips it) rather
  than guessing. If such a mapping is ever added, it must be centralized in policy and every resulting
  figure must stay labeled `ESTIMATED`, never presented as externally confirmed.
- `ESTIMATED` — a derived/inferred figure, explicitly not externally confirmed.
- `UNKNOWN` — no usable price signal — contributes nothing to any cost calculation.

Every `PriceEvidence` carries `currency`, `basis` (`PER_PERSON`/`TOTAL`/`UNKNOWN_BASIS`), `source`,
`observedAt`, and `confidence` — full provenance, never a bare number.

## Budget fit

`evaluateBudgetFit(envelope, cost, userCeiling?)` (`packages/financial-engine/src/simulation/
budget-fit.ts`) is the deterministic classifier — the LLM never decides this. It deliberately REUSES
`SpendingEnvelope`'s existing two boundaries (`recommendedAmount`, `cautionAmount` — the same ones
`SpendStatus` uses) rather than inventing a second, conflicting zone model:

- `WITHIN_RECOMMENDED` — at or under the recommended amount.
- `WITHIN_CAUTION` — over recommended but at or under the caution ceiling.
- `HIGH_IMPACT` — over the caution ceiling (unbounded above).
- `EXCEEDS_LIMIT` — over the USER'S OWN explicit ceiling specifically. A generous user ceiling can
  NEVER loosen a `HIGH_IMPACT` classification into something safer — `userCeiling` only ever adds a
  stricter constraint on top of the engine's own boundaries, never replaces them (see "User-specified
  limit override" below).
- `UNKNOWN_COST` — no usable cost estimate exists — never presented as "fits."

For a cost RANGE, `evaluateBudgetFit` returns `minZone`/`maxZone` separately plus a conservative
overall `zone` (the worse of the two) — a range whose lower bound is `WITHIN_RECOMMENDED` but whose
upper bound is `WITHIN_CAUTION` is never presented as simply "safe."

## User-specified limit override

`deriveSearchCeiling(envelope, userExplicitBudget?)` computes the actual search ceiling sent to the
discovery provider: the user's own stated budget when it's SMALLER than the envelope's caution
ceiling, otherwise the caution ceiling itself. A generous user-stated budget (e.g. "quero opções de
R$500" when the engine's ceiling is lower) never loosens the search ceiling beyond the caution amount
— and separately, `evaluateBudgetFit`'s `userCeiling` parameter never erases a `HIGH_IMPACT`
classification either. Money Copilot does not block the user from asking for pricier options — it
informs and replans, never silently overrides its own financial judgment.

## Multi-part plan calculation

`sumCostRangesCents` (`plan-builder.ts`): any `null` (unknown-price) component makes the COMBINED
total `null` too — never silently treated as zero. "Talvez motel" with no valid lodging price found
means the dinner-only base plan can still be `WITHIN_RECOMMENDED`, but the dinner+lodging plan's fit
becomes `UNKNOWN_COST`, never `SAFE` (see `plan-builder.test.ts`, "(N)"). An `OutingPlan`'s
`baseBudgetFit` covers ONLY required components — an optional component's cost is never silently
folded into the "base" figure a user might mistake for guaranteed spend.

## Ranking

`ConciergeRankingPolicy` (`ranking.ts`) centralizes every weight (budget-fit, preference-match,
rating, price-confidence) — never scattered magic numbers, and initial values are documented product
defaults, not universal truth. Budget fit DOMINATES: the per-zone score (`WITHIN_RECOMMENDED` highest,
`EXCEEDS_LIMIT` lowest) carries the largest weight by a wide margin, so a lower-rated but
within-budget venue outranks a higher-rated but `HIGH_IMPACT` one (regression-tested directly). Every
ranked result exposes its full factor breakdown — never one opaque AI score.

## Financial impact preview / Safe-to-Spend separation

Accepting/saving a plan NEVER changes current Safe-to-Spend — `saveConciergePlan` only writes to
`saved_concierge_plans`, never to any table `buildFinancialSnapshot` reads from (regression-tested
directly, mirroring Sprint 5's identical Safe-to-Spend-separation discipline). A plan's cost range
and budget fit are exposed as a distinct "if this happens" preview, never blended with the user's
actual current spendable cash.

## Plan vs. actual spending

Saving/selecting a plan is intent, never spending — no `FinancialTransaction` is ever created by
`saveConciergePlan`. "Separa R$250 para isso" reuses the EXISTING `FinancialEvent`/
`createPlannedFinancialEvent` mechanism (Sprint 1/4) via `reservePlanBudget` — no parallel reservation
mechanism was invented. "Já gastei R$250" still follows the existing `recordManualTransaction` path,
completely unchanged by this sprint. `replanAfterExpense` (Sprint 4) is reused as-is for "gastei mais
no jantar do que esperava" — no concierge-specific replanning logic was created.

## Stale financial context

Every `ConciergeSession` records the exact envelope figures (`recommendedAmountCents`,
`cautionAmountCents`) used at build time. `reevaluateConciergePlan` compares those against a freshly
computed envelope and returns `stale: true` whenever they differ at all — "esse orçamento ainda é
válido?" always re-derives from the LATEST snapshot rather than trusting however old the session is
(regression-tested directly: recording an unrelated real expense between build and re-check flips
`stale` to `true`).

## Privacy boundary

`DiscoverySearchCriteria` (sent to the discovery provider) contains ONLY: `activityType`, `location`,
`maxPriceCents` (a DERIVED search ceiling, never the raw envelope/Safe-to-Spend/income/balance),
`partySize`, `preferences`, `avoidances`, `dateTime`. It structurally CANNOT carry income, bank
balance, debt, protected preferences, or transaction history — those types don't exist in the
`@money-copilot/discovery` package at all. Regression-tested directly (`concierge-service.test.ts`,
"(B, Z)"): the exact criteria object passed to the provider is asserted to contain only these keys,
and a serialized-JSON scan confirms none of income/balance/safeToSpend/protectedSavings/debt ever
appear.

## External data safety (prompt-injection resistance)

A discovery provider's response — including a maliciously-crafted venue name or price description
containing text like "ignore all previous instructions" — is DATA passed as a `tool_result` turn item,
never concatenated into the system `instructions` sent to the AI provider. Regression-tested directly
(`orchestrator-concierge.test.ts`, "(Q, injection)"): a scripted malicious venue payload is fed
through a full turn, and the test asserts (a) the system instructions sent to the provider are
byte-identical across every call in the turn regardless of tool output, and (b) an invented monetary
figure the model states is still caught and rejected by grounding — external content can influence
what the LLM CHOOSES to say, but never what instructions or financial facts it is grounded against.

## Discovery grounding

`DiscoveryFact` (`concierge/types.ts`) is deliberately a SEPARATE type from `FinancialFact` — an
external venue's name/price/rating/address is never the user's own money. Discovery facts are
populated STRUCTURALLY, directly from tool results, by the orchestrator itself (`copilot/
discovery-facts.ts`'s `extractDiscoveryFacts`) — never written by the LLM — so every entry is grounded
BY CONSTRUCTION, avoiding the fragile regex-based name/address/rating verification the brief
explicitly warns against. Only price-shaped amounts need the SAME kind of check `FinancialFact`
amounts get: `discoveryFactsAsGroundingFacts` converts price evidence into the same amount-checking
pool `groundResponseText` already uses (merged into the check only, never into the client-facing
`financialFacts` array) — so an invented BRL figure about a venue is caught exactly like an invented
financial figure would be, without conflating the two concepts in the response shape.

## AI tools

Six new tools (`packages/app-services/src/copilot/tools.ts`), following the exact Sprint 4/5
allowlist pattern: `getConciergeBudget`/`searchPlaces`/`buildConciergePlans`/`evaluateConciergePlan`
(READ) and `saveConciergePlan`/`reservePlanBudget` (MUTATION, gated by the same
`hasExplicitMutationIntent` mechanism as every other mutation tool — extended with PT-BR/English plan-
selection and budget-reservation language, e.g. "vamos com essa opção," "escolho essa," "separa
R$250"). `saveConciergePlan`/`evaluateConciergePlan` take only a short `sessionId`/`planId` pair
(never requiring the model to re-transmit a complex plan object it received earlier) — both looked up
from the session's own persisted `plans` array.

## UI

A "Saved Concierge Plans" dashboard section (read-only, listing what's been explicitly saved via
chat) plus discovery-evidence cards in the chat panel (`DiscoveryFactCard`, rendered exactly like
`FactCard` for financial facts, but visually distinct) — kept intentionally small, not an "oversized
travel website." An explicit disclaimer states saving a plan never books anything or spends money.

## Persistence

Two new tables: `concierge_sessions` (intent + envelope snapshot + every proposed plan, as JSON —
enough to answer "why" and "is this still valid" without a giant cache of the internet) and
`saved_concierge_plans` (one row per explicit user selection, unique per `(financialProfileId,
planId)` so saving the same already-returned plan twice never duplicates a row). Both live in
`packages/app-services/src/concierge/types.ts` as application-layer types — NOT `financial-engine`
domain types, since they reference discovery-domain concepts (`VenueCandidate`) that `financial-engine`
must never depend on. `packages/persistence` therefore works with plain row shapes (JSON blobs +
primitives) for these two tables rather than importing the rich types directly — `concierge-service.ts`
does its own mapping, avoiding an illegal `app-services → persistence → app-services` dependency
cycle.

## Live provider status

**No live discovery provider credential exists in this environment** (no Google Places / web-search
API key configured — confirmed by inspecting `apps/web/.env.example`/`.env.local` before choosing a
V1 implementation, per the brief's explicit instruction not to assume a stale API contract). Per the
brief's own fallback instruction, this does NOT block the sprint: the full `LocalDiscoveryProvider`
abstraction + `MockDiscoveryProvider` are complete and fully tested, and the running application uses
the mock provider by default (clearly-synthetic venue names like "Generic Bistro," never real
business names — mirroring Pluggy's own sandbox-data labeling discipline). Live validation of the full
conversational flow (financial envelope → intent → search → plans → grounding → AI explanation) was
performed against the real running product with real OpenAI, using the mock discovery provider for
the external-data step only.

**`LIVE_DISCOVERY_VALIDATION = BLOCKED_BY_EXTERNAL_PROVIDER_CONFIGURATION`.** Exact infrastructure
needed for a real live provider: a product-owned (never end-user-supplied) API key for a places/local-
search provider — e.g. Google Places API (Places API (New) — Text Search / Place Details), or a
web-search-backed provider — configured server-side only (matching the existing `OPENAI_API_KEY`/
`PLUGGY_CLIENT_ID` pattern), plus confirmation of that provider's current pricing/terms-of-service
before any live call. Adding it later is purely additive: one new adapter class implementing
`LocalDiscoveryProvider` + one new `discovery-provider-registry.ts` branch — no other file changes.

The pipeline that WOULD use that live provider — financial envelope → intent → search → plans →
grounding → AI explanation — was fully validated live against the real running product and real
OpenAI, through the mock discovery provider, using the brief's own Section 51 scenario ("Vou sair com
uma garota em Campinas hoje à noite. Provavelmente vou pagar o jantar e talvez motel...") end to end:
correct financial-envelope-first ordering, correct party-size-2/`FULL_PARTY` inference from
"pagar o jantar," correct required-dinner/optional-lodging split, correct deterministic combination
arithmetic, correct `BudgetFitZone` classification, no fabricated venue or price, and
`groundingStatus: "PASSED"` — with the homepage's Safe-to-Spend figure confirmed unchanged afterward.

### Two real bugs found and fixed during live validation

Live validation (against the real model, not `MockAIProvider`) found two genuine bugs that no offline
test had caught — both fixed, both covered by permanent regression tests, both documented as decisions:

- **DEC-074** — `getConciergeBudget` (and the nested `budget`/`currentBudget` field inside
  `buildConciergePlans`/`evaluateConciergePlan`) had no `extractFinancialFacts` case, so a live response
  that correctly cited the tool's own recommended/caution amounts was rejected by grounding as
  "unsupported." The same "tool output not exposed to grounding is a product bug" lesson as DEC-055
  (Sprint 4.5) and DEC-062 (Sprint 5) — a third recurrence.
- **DEC-075** — Sprint 4's system instructions contained a rule, accurate at the time, telling the model
  it did not yet have real-world venue search — which survived unnoticed into Sprint 6 and actively
  suppressed the brand-new, correctly-registered discovery tools. Fixed by removing the stale rule and
  layering the instruction version chain (`V1`→`V2`→`V3`→`V4`) so each sprint's additions stay
  traceable and reviewable against what earlier rules claim.

## Relationship to the Recommendations engine (Sprint 5)

Deliberately separate domains. Recommendations improve recurring FINANCIAL STRUCTURE (cancel/reduce a
subscription); the concierge helps choose a real-world DISCRETIONARY ACTION within the current
financial situation. A restaurant suggestion is never a `Recommendation` entity of type
`CANCEL_RECURRING_COST` — the two domains share no types and no lifecycle machinery.

## Known limitations

- No live discovery provider — see "Live provider status" above.
- `PRICE_LEVEL` evidence never contributes a numeric estimate in V1 (no documented `$`→BRL policy
  exists) — a venue with ONLY price-level evidence is treated as having no usable price.
- Distance/travel-time ranking is not implemented — V1 ranks by neighborhood/location-text match only,
  never invented kilometers or minutes, per the brief's explicit "do not implement a routing engine."
- No FX/currency-conversion policy exists — a non-BRL price would be treated as incomparable, not
  converted (this has not been exercised live since the mock provider only produces BRL evidence).
- No external booking/reservation/payment/cancellation of any kind — discovery and recommendation
  only, exactly as scoped.
- Selecting a plan by reference ("Vamos com a opção 1") depends on the model still having (within the
  SAME turn's tool-calling loop, or by choosing to re-invoke a read tool) the session/plan identifiers
  from an earlier search — conversation history across separate turns is exactly the persisted plain-
  text messages, never raw tool results (a Sprint 4 architectural decision, not specific to concierge).
  Observed live behavior when that context isn't available: the model asks the user to resend the
  option rather than fabricating a save — the safe failure mode, not a mutation-guard or grounding
  violation. Similarly, a single message that mixes hypothetical wording ("quanto posso gastar") with
  an explicit directive ("já escolha e salve") is treated as ambiguous by the whole-message
  `hasExplicitMutationIntent` heuristic and does not mutate — also the documented safe-failure design,
  not a bug. A more reliable "resume the last concierge session" mechanism is a reasonable future
  improvement but is out of scope for Sprint 6.
