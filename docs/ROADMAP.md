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

## Sprint 5 — Recommendation engine with ACCEPT / MODIFY / REJECT / VERIFY lifecycle

- Actual recommendation *discovery* (Sprint 1 only defined the data model in
  `domain/recommendation.ts`).
- Must respect `ProtectedPreference` (RULE #5, #11) and must not resurface `REJECTED`
  recommendations absent material context change.
- Verification against Sprint 3's imported transaction data.
- Likely also where the Sprint 3 old-debt installment-match candidates (`DEC-032`, never
  auto-applied) get an actual accept/reject UI flow, using the same lifecycle machinery.

## Sprint 6 — Financial concierge

- Budget-aware recommendations for restaurants, dates, shopping, travel — built on top of
  `simulateExpense` plus category-specific intent parsing from Sprint 4.

## Sprint 7 — Notifications, alerts, UX stabilization, production hardening

- Proactive alerts (e.g. "your beach trip is in 3 days and still has no budget set" — finally acting
  on the `UNKNOWN`-certainty warning mechanism built in Sprint 1).
- General production hardening: auth, error handling, observability, UX polish.

## Explicitly not scheduled yet

Multi-user support, multi-currency, and any specific bank/institution integration beyond sandbox are
not placed on this roadmap — they should be scoped when they become concretely necessary.
