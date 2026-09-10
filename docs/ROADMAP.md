# Money Copilot — Roadmap

This is a proposed sequence, not a commitment to exact scope per sprint. Each sprint should begin by
reading `docs/PROJECT_STATE.md` and end by updating it.

## Sprint 1 — Financial Core + persistent project memory ✅ (this sprint)

Deterministic financial engine: `Money`, domain model, `FinancialSnapshot`/Safe-to-Spend,
`simulateExpense`, lifestyle simulation, initial real-life fixture, strong test coverage, minimal
Next.js display UI, full documentation set. No persistence, no Open Finance, no LLM.

## Sprint 2 — Transactions + persistence + financial normalization ✅ (complete)

Canonical `FinancialTransaction` model + `FinancialEffect` classification (no more card-payment/
transfer double counting); merchant normalization + deterministic categorization; recurring-expense
*candidate* detection (never auto-confirmed); `InstallmentPlan` (incomplete-schedule-aware) +
future-commitment read model; deduplication/reconciliation (provider-id → fingerprint → candidate,
never silently merged); `FinancialProfile` ownership model; `FinancialPosition`/liquidity-aware
Safe-to-Spend alongside the plan figure; tri-state lifestyle viability
(UNSUSTAINABLE/FRAGILE/SUSTAINABLE); auditable `SafeToSpendBreakdown`; first persistence layer
(Drizzle + PGlite, no hosted credentials needed) with idempotent seed; extended debug/validation UI.
See `docs/DECISIONS.md` DEC-009 through DEC-020 and `docs/PROJECT_STATE.md` for the full account.

## Sprint 3 — Open Finance provider abstraction + sandbox integration ✅ (complete)

`OpenFinanceProvider` interface + `PluggyProvider` (real Pluggy sandbox REST contract, verified
against Pluggy's own SDK/reference source) + `MockProvider` (credential-free demo/testing);
provider-independent DTOs (`ExternalAccountInput`/`ExternalTransactionInput`/`ExternalBillInput`);
a documented, tested amount-sign/effect mapping (`docs/OPEN-FINANCE.md`); the full connect → sync →
snapshot pipeline (`@money-copilot/app-services`) reusing Sprint 2's normalization/categorization/
reconciliation unchanged; idempotent webhook processing; `ProviderConnection`/`SyncRun` observability;
liquidity coverage (`COMPLETE`/`PARTIAL`/`UNKNOWN`); old-debt reconciliation candidates (never
auto-applied); the web UI now reads live from the database via `app-services` (DEC-024, superseding
DEC-019). Live Pluggy sandbox validation was **not executed** (no credentials available in this
environment) — engineering is complete and contract-tested via `MockProvider`/fixtures regardless.
See `docs/DECISIONS.md` DEC-022 through DEC-033 and `docs/PROJECT_STATE.md` for the full account.

Deferred to a later sprint: `Recommendation.VERIFIED`/`FAILED` (no recommendation discovery engine
exists yet — that's Sprint 5's job); replacing the old credit-card debt's unknown installment
schedule with a real one (no live sandbox data was available to populate it).

## Sprint 4 — AI conversational copilot with deterministic financial tools ✅ (complete)

`@money-copilot/ai` (provider-neutral `AIProvider`, `MockAIProvider`, `OpenAIProvider` using the
OpenAI Responses API, default model `gpt-5.6-terra`); a 16-tool allowlist in
`@money-copilot/app-services/copilot` (12 READ/SIMULATION + 4 MUTATION, the latter gated by a
deterministic `hasExplicitMutationIntent` guard independent of the model's own judgment); app-owned
conversation persistence (`conversations`/`conversation_messages`/`ai_tool_executions`/`ai_requests`,
migration `0002`); financial fact grounding (`FinancialFact[]` + regex-based hallucination guard with
a deterministic fallback template); a bounded tool-calling loop (`MAX_TOOL_ITERATIONS = 6`); a basic
chat UI (`/api/chat` + `ChatPanel.tsx`) with quick actions and fact cards. See `docs/AI-COPILOT.md`
for the full account and `docs/DECISIONS.md` DEC-034 onward.

Live OpenAI validation and live Pluggy sandbox validation (Sprint 3's `DEC-033` pending item) were
both **not executed** in this sprint — no credentials were available in this environment; engineering
for both is complete and automated-test-covered regardless. WhatsApp (or another conversational
surface) remains unscheduled — text chat via the web UI is the only surface built so far.

## Sprint 5 — Recommendation engine with ACCEPT / MODIFY / REJECT / VERIFY lifecycle ✅ (complete)

Actual recommendation *discovery*, built on the Sprint 1 data model (extended, not replaced —
`domain/recommendation.ts`): deterministic candidate generation from confirmed recurring
discretionary spending (`detectRecurringCandidates`, reused unchanged), cadence-normalized impact
calculation (`CANCEL_RECURRING_COST`/`REDUCE_RECURRING_COST`/`REVIEW_RECURRING_COST`), a centralized
`RecommendationPolicy` (no hidden thresholds), deterministic-identity-based idempotency and
suppression (one mechanism handles both), a full ACCEPT/MODIFY/REJECT/VERIFIED/FAILED lifecycle with
append-only decision history, verification against Sprint 3's imported transaction data (a separate
`VerificationAssessment` keeps "insufficient evidence" from corrupting lifecycle status), a
Recommendations UI panel, and 5 new AI tools with full grounding coverage. `ProtectedPreference` is
evaluated before anything else (RULE #5, #11) — the Founder's real family-support fixture is
regression-tested as never producing a recommendation. See `docs/RECOMMENDATIONS.md` for the full
architecture and `docs/DECISIONS.md` DEC-056 through DEC-064.

Old-debt installment-match candidates (`DEC-032`) were NOT bundled into this sprint's UI — they still
have no accept/reject flow; this remains a candidate for a future sprint using the same lifecycle
machinery, not yet done.

## Sprint 6 — Financial concierge ✅ (complete)

Budget-aware real-world discovery: financial envelope always resolved before any external search
(`docs/CONCIERGE.md`, "Financial-envelope-first" — enforced architecturally, not just by convention,
since `@money-copilot/discovery` has zero dependency on `@money-copilot/financial-engine`); a
provider-neutral `LocalDiscoveryProvider` abstraction (new `@money-copilot/discovery` package,
mirroring Open Finance's own pattern) with a deterministic `MockDiscoveryProvider` — no live provider
credential exists yet, so live discovery itself remains `BLOCKED_BY_EXTERNAL_PROVIDER_CONFIGURATION`
(DEC-073); structured, provenance-tagged `PriceEvidence` (never a bare number, never inventing a
`$`-to-BRL conversion); a deterministic `evaluateBudgetFit` classifier reusing the financial engine's
existing SAFE/CAUTION/HIGH_IMPACT boundaries; required-vs-optional multi-part outing plans with
deterministic combination arithmetic; a centralized, budget-fit-dominant ranking policy; discovery
facts grounded by construction (never fragile regex-based name/address/rating verification); a
privacy boundary ensuring the discovery provider only ever sees derived search constraints, never raw
financial data; and full plan-vs-actual-spending separation (saving a plan never creates a
transaction; an explicit budget reservation reuses the existing `FinancialEvent` mechanism). See
`docs/CONCIERGE.md` and `docs/DECISIONS.md` DEC-065 through DEC-073.

## Sprint 7 — Notifications, alerts, product hardening ✅ (complete)

A deterministic alert engine (`docs/ALERTS-NOTIFICATIONS.md`) with an 8-type catalog
(`SAFE_TO_SPEND_MATERIAL_DROP`, `RECOMMENDATION_FAILED`/`VERIFIED`, `UPCOMING_EVENT_PRESSURE`/
`UNKNOWN_COST`, `LIQUIDITY_COVERAGE_DEGRADED`, `CONNECTION_NEEDS_ATTENTION`, `STALE_CONCIERGE_PLAN`) —
alert creation is 100% deterministic (financial-engine's pure `alert-signal.ts` classification
functions + app-services' `evaluateAlerts`), never decided by the AI; one shared episode mechanism
(`upsertAlertEpisode`) implements anti-spam/reuse/resolve/rearm for every type at once; bootstrap
semantics prevent retroactive alerting on a profile's pre-existing historical state. An in-app
notification layer, architecturally separate from alert state (`NotificationDelivery`/
`NotificationPreferences`/a provider-neutral `NotificationProvider` mirroring
`OpenFinanceProvider`/`LocalDiscoveryProvider`) — no real push/email provider exists yet
(`LIVE_EXTERNAL_NOTIFICATION_VALIDATION = NOT_CONFIGURED`). Connected Accounts UX hardening (a
Disconnect button, a Reconnect flow, closing the Sprint 4.5 duplicate-Connect-click gap) and discovery
production safety (mock venues can no longer reach a production deployment) round out the sprint. A
declarative fact-extraction mechanism (`ToolDefinition.extractFacts`) ends a fourth recurrence of the
"new tool, no grounding extractor" bug class. Live-validated end to end against the real running app,
real OpenAI, and the real persisted Pluggy sandbox connection — genuine success, with one real bug
found and fixed live (DEC-082, a mutation-guard pattern that only matched the brief's own bare example
phrasing). See `docs/ALERTS-NOTIFICATIONS.md` and `docs/DECISIONS.md` DEC-076 through DEC-082.

## Sprint 8 — Ritmo (Lovable) UI integration ✅ (complete)

A Founder-approved Lovable-generated prototype ("Ritmo") became the visual source of truth for the
product UI, replacing `apps/web`'s developer dashboard. A new app, `apps/ritmo` (React 19, TanStack
Start, Vite, Tailwind v4, shadcn/ui — the prototype's own stack, ported in and never redesigned),
connects that unchanged visual design to the same deterministic engine every prior sprint built — all
six screens (Home, Transações, Planejamento, Insights, Assistente, Mais) read real data via
`@money-copilot/app-services`, never a second business-logic implementation. A strict server/client
security boundary (`apps/ritmo/src/functions/` is the only layer allowed to import `app-services`,
enforced by TanStack Start's native import-protection plugin and proved at build time by
`scripts/check-client-bundle.mjs`) and a single profile-resolution seam (`getCurrentProfileContext()`
— explicitly not an auth implementation, but the seam a future sprint's real auth replaces) were both
built before any screen was wired. The Assistente screen's chat is real, calling the same
`runCopilotTurn` orchestrator `apps/web`'s (previously UI-less) `/api/chat` route already used.
`FixedExpense.dueDayOfMonth?: number` was added as the one additive domain-model change. Nine
data-model gaps (a bill due-date, a paycheck date, a fabricated subscription plan, etc.) were each
resolved by adapting displayed copy honestly, never by fabricating a number or changing the approved
visual result. Founder visual and product validation PASSED against the real engine. See
`docs/RITMO.md` for the full architecture and `docs/DECISIONS.md` DEC-083 through DEC-086.

## Sprint 9 and beyond — not yet scoped

No brief exists yet for Sprint 9. Candidates the Founder/Product Lead may consider: real production
authentication (Sprint 8 built the seam for it — `getCurrentProfileContext()` — but implemented no
login UI), retiring `apps/web` once `apps/ritmo` parity is validated further, closing Sprint 8's
remaining data-model gaps deliberately (a real bill due-date/paycheck-date capture flow, a real
scheduled daily-digest notification), a real push/email notification provider, a real
discovery-provider credential (Sprint 6's `LIVE_DISCOVERY_VALIDATION` remains blocked), and a real
completion/cancellation status on saved concierge plans (Sprint 7's stale-plan alert currently
approximates this with a relevance-window heuristic).

## Explicitly not scheduled yet

Multi-user support, multi-currency, and any specific bank/institution integration beyond sandbox are
not placed on this roadmap — they should be scoped when they become concretely necessary.
