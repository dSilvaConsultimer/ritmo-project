# Money Copilot — Project State

**This file is the canonical persistent project memory.** Before every future sprint, read this
file, plus `docs/PRODUCT.md`, `docs/ARCHITECTURE.md`, `docs/FINANCIAL-ENGINE.md`,
`docs/ROADMAP.md`, and `docs/DECISIONS.md` (and, from Sprint 3 on, `docs/OPEN-FINANCE.md` for
provider-integration detail), in that order. This documentation is more authoritative than
assumptions carried over from a chat session. If a new request conflicts with a rule documented here:
identify the conflict, explain the existing rule, do not silently change it, implement the new
behavior only if it clearly supersedes the old decision, and record the change in
`docs/DECISIONS.md` (mark the old decision superseded, add a new one — never rewrite history).

Last updated: **2026-09-06, end of Sprint 4.5.**

---

## NON-NEGOTIABLE PRODUCT RULES

1. Financial calculations are deterministic application logic.
2. LLMs do not calculate or invent financial limits.
3. Monetary values must internally use integer cents. Never use floating-point arithmetic for money.
4. Credit cards are PAYMENT SOURCES, not financial expense categories. **Sprint 3 extends this to
   real provider data**: a bank/card transaction's `FinancialEffect` (not its raw sign) determines
   whether it's spending at all — verified against real Pluggy sign conventions, which differ by
   account type (see `docs/OPEN-FINANCE.md`, "Amount / sign mapping").
5. Protected expenses must never automatically be recommended for reduction.
6. BRL 1,000 monthly support to the user's mother is protected and non-negotiable.
7. Spending above the recommended amount is allowed. The system recalculates the plan instead of
   blocking or judging the user.
8. Future events must affect Safe-to-Spend BEFORE they occur.
9. Unknown future-event budgets must NEVER silently be interpreted as zero — this now also covers
   installment plans with an incomplete schedule, a `FinancialPosition` with unknown liquidity, and
   (Sprint 3) incomplete account **coverage** (a subset of connected accounts is never presented as
   the user's complete financial picture).
10. Accepted future recommendations must eventually be verifiable against imported financial data.
    Real imported data now exists (Sprint 3) but no recommendation-discovery engine does yet (Sprint
    5) — this rule remains modeled, not operational.
11. Rejected recommendations should not repeatedly return unless material context changes — the same
    principle governs rejected recurring-expense candidates (Sprint 2) and, in spirit, old-debt
    installment match candidates (Sprint 3, which are never even auto-confirmed in the first place —
    see rule 9-adjacent DEC-032).
12. Manual transactions and later Open Finance imported transactions must eventually support
    deduplication. **Fully implemented and exercised against real-provider-shaped data in Sprint 3**
    — see `docs/OPEN-FINANCE.md`, "Manual + provider reconciliation."
13. The system must support simulation of future lifestyles without modifying real financial data.
14. Independent-living simulation must be possible before the user actually moves out.
15. The product should optimize around the life the user wants, not blindly minimize every expense.
16. The system should distinguish: actual data, estimated data, confirmed future data, unknown data.
17. Financial uncertainty must be visible instead of hidden.
18. **(Sprint 3) Pluggy — or any provider — must not leak into `packages/financial-engine`.** The
    engine remains usable without Pluggy, Open Finance, Next.js, a database, or network access. All
    provider-specific logic lives in `packages/open-finance`, behind the `OpenFinanceProvider`
    interface.
19. **(Sprint 4) The LLM never calculates or invents financial values.** It interprets intent,
    extracts structured data, chooses which allowlisted tool to call, explains deterministic
    results, asks clarifying questions, and communicates uncertainty — nothing more. All math
    originates from `packages/financial-engine` via the `packages/app-services/src/copilot/tools.ts`
    allowlist.
20. **(Sprint 4) `REAL_PERSONAL_FINANCIAL_DATA_ALLOWED = false` remains in effect.** No AI feature
    connects to or uses the Founder's real Santander/Nubank accounts — only seeded/mock/fixture data
    — until live Pluggy sandbox validation passes (still pending; see "Integration status").
21. **(Sprint 4) A mutation tool only executes on the user's own explicit, decided action.**
    Hypothetical/exploratory language ("what if", "could I", "should I") must never result in a
    persisted financial change — enforced independently of the LLM's own judgment by
    `hasExplicitMutationIntent` (defense-in-depth, deterministically testable).
22. **(Sprint 4) Every AI-stated monetary figure must be traceable to a deterministic tool result or
    the user's own input.** An amount the model invents and cannot be traced is never silently shown
    as financial truth — `groundResponseText` enforces this, falling back to a deterministic template
    on failure.

These are enforced today by: `Money` (rule 3), `PaymentSource`/`FinancialEffect` +
`pluggy/mappers.ts`'s direction-from-`type`-not-sign mapping (rule 4, 18), `FixedExpense.protected` +
`ProtectedPreference` (rules 5–6), `simulateExpense` never throwing/blocking (rule 7),
`domain/event.ts` + `domain/installment.ts` (rule 8), `Certainty.UNKNOWN` handling +
`FinancialPosition.coverage` (rules 9, 16, 17), `domain/reconciliation.ts` +
`findTransactionDuplicates` exercised against Pluggy-shaped fixtures (rule 12),
`LifestyleScenario` simulation never mutating input (rules 13–14), the `copilot/tools.ts` allowlist +
`AIProvider`/`OpenAIProvider` isolation (rules 19, 20), `hasExplicitMutationIntent` (rule 21), and
`groundResponseText`/`buildFallbackResponseText` (rule 22). Rule 10 remains modeled but not
operational (no discovery engine).

---

## Product objective

Answer "Can I afford to do this without damaging the rest of my financial plan?" — not a backward-
looking expense tracker. Primary current user goal: become financially ready to live independently.
Full detail: `docs/PRODUCT.md`.

## Current architecture

pnpm workspace monorepo, now six packages deep: `apps/web` (Next.js 16 App Router, DB-backed via
`app-services`, plus `/api/chat`) → `packages/app-services` (application/query service layer AND the
Sprint 4 AI tool/orchestration layer, `src/copilot/`, zero Next.js dependency) → `packages/ai`
(provider-neutral `AIProvider` + OpenAI adapter, Sprint 4), `packages/open-finance` (provider
abstraction + Pluggy adapter + MockProvider), and `packages/persistence` (Drizzle + PGlite) →
`packages/financial-engine` (zero framework/database/provider/AI dependencies, the priority package)
→ `packages/shared` (generic `Id`/id-generation only). Full detail: `docs/ARCHITECTURE.md`.
Calculation detail: `docs/FINANCIAL-ENGINE.md`. Provider integration detail: `docs/OPEN-FINANCE.md`.
AI copilot detail: `docs/AI-COPILOT.md`.

## Current sprint

**Sprint 4.5 — external-validation + PT-BR hardening pass on top of Sprint 4. Engineering complete;
both live validations PARTIAL** (real credentials were available and used this time — a real,
previously-untested bug was found and fixed live, see DEC-043 — but neither validation reached a
fully-passing live scenario run; see "Integration status" below for the exact blockers, both of which
require a Founder action, not a code fix). See the Sprint 4.5 final report delivered to the founder
for the full account; this file carries forward only what a future sprint needs to know.

## Completed capabilities

**New in Sprint 4.5** (see `docs/DECISIONS.md` DEC-043–045 and `docs/AI-COPILOT.md` for the full
account):

- Fixed a real, live-discovered bug: every optional AI tool argument is now `.nullable().default(
  null)` instead of plain Zod `.optional()` — OpenAI's strict function-calling mode rejects any tool
  schema where a `properties` key is missing from `required`, which is exactly what `.optional()`
  produces. Added a permanent, fully offline regression test (`tool-schema-strict-mode.test.ts`) that
  would have caught this without any live API call.
- PT-BR (Brazilian Portuguese) hardening: `hasExplicitMutationIntent`/`containsHypotheticalLanguage`
  now recognize Portuguese explicit-action and hypothetical phrasing (including the pronoun-dropping
  Portuguese grammar allows, e.g. "Poderia reservar...?" with no "eu"); the system prompt
  (`SYSTEM_INSTRUCTIONS_V2`) now explicitly instructs the assistant to respond in the user's own
  language; `groundResponseText` was confirmed (and regression-tested) to already be language-agnostic.
- Live OpenAI validation: model availability confirmed (`gpt-5.6-terra` retrievable); actual scenario
  calls blocked by `429 credit_balance_exhausted` even after credits were added — reported, not
  retried further, no model changed (see "Integration status").
- Live Pluggy sandbox validation: real authentication + Connect Token creation succeeded live; the
  interactive Connect-widget step did not result in a persisted connection on this app's side —
  reported, no real account/transaction/bill data was imported (see "Integration status").
- 326 automated tests passing in the default suite (up from 288), plus 6 additional opt-in
  live-OpenAI tests that skip automatically without a key (never part of the default suite).

**New in Sprint 4** (see `docs/DECISIONS.md` DEC-034–042 and `docs/AI-COPILOT.md` for the full
account):

- `@money-copilot/ai`: provider-neutral `AIProvider` interface (`AITurnItem`, `AIToolDefinition`,
  `AIGenerateResult`), `MockAIProvider` (deterministic, used by every automated test),
  `OpenAIProvider` (Responses API, official `openai` SDK v7.10.0, the ONLY file allowed to import
  it), `AIErrorCode` taxonomy + `AIError`, `resolveOpenAIModel()` (default `gpt-5.6-terra`).
- Conversation persistence: `conversations`/`conversation_messages`/`ai_tool_executions`/
  `ai_requests` tables (migration `0002_right_spirit.sql`) — the application, not any AI provider,
  owns history; verified by reconstructing full history from the DB across independent provider
  instances.
- A 16-entry tool allowlist (`packages/app-services/src/copilot/tools.ts`): 12 READ/SIMULATION tools
  (`getFinancialSnapshot`, `getSafeToSpend`, `getSafeToSpendBreakdown`, `getFinancialPosition`,
  `getLifestyleComparison`, `getGoalStatus`, `getSpendingEnvelope`, `getDailyGuidance`,
  `simulateExpense`, `getUpcomingFinancialEvents`, `getCategoryBudgetStatus`,
  `getRecentSpendingSummary`) + 4 MUTATION tools (`recordManualTransaction`,
  `createPlannedFinancialEvent`, `updatePlannedFinancialEvent`, `replanAfterExpense`), each with a
  strict Zod schema and server-side validation.
- `hasExplicitMutationIntent` (`copilot/mutation-guard.ts`): deterministic, regex-based
  explicit-vs-hypothetical mutation gate, independent of the model's own judgment.
- Financial fact grounding: `FinancialFact[]` extraction per tool (`copilot/facts.ts`) +
  `groundResponseText`/`buildFallbackResponseText` (`copilot/grounding.ts`) — an AI-invented,
  untraceable monetary amount is replaced with a deterministic fallback rather than shown as truth.
- New pure `financial-engine` functions: `getSpendingEnvelope`, `getDailyGuidance`,
  `replanAfterExpense`, `getGoalStatus`, `getCategoryBudgetStatus` — see `docs/FINANCIAL-ENGINE.md`.
- Bounded tool-calling loop (`runCopilotTurn`, `MAX_TOOL_ITERATIONS = 6`) with per-call error
  handling (unregistered tool, invalid arguments, skipped mutation, tool execution failure) that
  never crashes the whole turn; only an `AIProvider`-level failure (auth/rate-limit/timeout)
  propagates as a normalized `AIError`.
- Chat UI (`apps/web/app/components/ChatPanel.tsx`) + `/api/chat` route (POST to send, GET to
  reload history), quick-action buttons, deterministic fact cards rendered separately from narrative
  text, `AI_CONFIGURATION_ERROR` (not a silent stub) when `OPENAI_API_KEY` is absent.
- 288 automated tests passing (124 financial-engine + 11 ai + 46 open-finance + 21 persistence + 86
  app-services — see exact breakdown in "Test status").

**Carried forward from Sprint 1–2** (see `docs/DECISIONS.md` DEC-001–021): `Money`; domain model;
`FinancialSnapshot`/Safe-to-Spend/`SafeToSpendBreakdown`; `simulateExpense`; `FinancialEffect`
classification; merchant normalization + categorization; recurring-candidate detection;
`InstallmentPlan`; reconciliation/deduplication; `FinancialProfile`; `FinancialPosition`/liquidity;
tri-state lifestyle viability; persistence (Drizzle + PGlite) with idempotent seed; the founder's
enriched fixture (7 September transactions, old debt as an `InstallmentPlan`).

**New in Sprint 3:**

- `OpenFinanceProvider` interface (`createConnectionToken`, `getConnection`, `listAccounts`,
  `listTransactions`, `listBills`, `syncConnection`, `deleteConnection`) — `packages/open-finance`.
- `PluggyProvider`: real Pluggy REST contract (auth, Connect Token, accounts, cursor-paginated
  transactions, bills) via the official `pluggy-sdk` npm package, verified against Pluggy's own SDK
  source and reference Next.js quickstart (fetched from GitHub, not assumed from prior knowledge).
- `MockProvider`: fully deterministic, no network, no credentials — powers tests and would power a
  credential-free demo.
- A documented, tested amount-sign/`FinancialEffect` mapping per account kind — see
  `docs/OPEN-FINANCE.md`'s mapping table. Direction comes from Pluggy's `type` field, never from the
  sign of `amount` (which Pluggy documents inconsistently across account types).
- `ExternalAccountInput`/`ExternalBillInput` DTOs + `PaymentSource` extended with optional
  provider/balance/credit-card fields (DEC-022) + `CreditCardBill` domain type (never fed into
  snapshot math).
- `ProviderConnection` + `SyncRun` domain types; `ProviderError` taxonomy (8 codes).
- Full connect → sync → snapshot pipeline (`@money-copilot/app-services`): idempotent connection
  creation (DB unique constraint + app-level check, DEC-023), account/transaction/bill import
  through the **unchanged** Sprint 2 normalization/categorization/reconciliation pipeline, installment
  metadata mapping, non-duplicating repeated-sync reconciliation (pair-key dedup).
- Idempotent webhook processing (`webhook_events` keyed by provider `eventId`) — `transactions/
  created` triggers a full incremental sync, `transactions/updated` triggers a **targeted** re-fetch
  by id (a real bug found and fixed during this sprint's own testing — see DEC-027).
- `transactions/deleted` → `REVERSED` tombstone (never hard-deleted).
- `FinancialPosition.coverage` (`COMPLETE`/`PARTIAL`/`UNKNOWN`) derived from connected accounts —
  only provider-synced accounts count (DEC-022/DEC-028).
- Old-debt installment reconciliation candidates (`matchInstallmentPlans`) — never auto-applied
  (DEC-032).
- New persistence tables: `provider_connections`, `sync_runs`, `webhook_events`, `bills`; extended
  `payment_sources`/`financial_positions`/`installment_plans`; a second migration verified to apply
  forward onto an existing Sprint-2-shaped database (`migration.test.ts`).
- Web app: DB-backed dashboard (`export const dynamic = "force-dynamic"`, DEC-024), "Connected
  Accounts" section with a real Pluggy Connect widget (`react-pluggy-connect`), manual "Refresh /
  sync" button, sync-run developer view, DEMO/FIXTURE vs. PROVIDER DATA banner. Four API routes
  (`/api/token`, `/api/connections`, `/api/sync`, `/api/webhook`) — each a thin wrapper over one
  `app-services` function.
- `.env.example` documenting every Sprint 3 environment variable, no secrets committed.
- 185 automated tests passing (105 financial-engine + 46 open-finance + 13 persistence + 21
  app-services — see exact breakdown in "Test status").

## Partially completed capabilities

- **Recommendation lifecycle**: still model-only (Sprint 1/2 state unchanged) — real imported data
  now exists to eventually verify against, but no discovery engine exists yet (Sprint 5). Sprint 4's
  `replanAfterExpense` deliberately exposes only deterministic facts (compensation required, category
  headroom), never an optimization suggestion of its own — that remains Sprint 5's job.
- **Old-debt reconciliation**: candidates are computed (`getInstallmentPlanMatchCandidates`) and
  exposed, but there is no UI/flow to act on one (accept/reject) — deliberately deferred (DEC-032),
  likely bundled into Sprint 5's recommendation lifecycle UI.
- **Live Pluggy sandbox validation**: PARTIAL as of Sprint 4.5 — real authentication and Connect
  Token creation succeeded live; the interactive Connect-widget step did not persist a connection on
  this app's side, so no real account/transaction/bill data was imported (see "Integration status").
  All engineering is complete and contract-tested against `MockProvider`/injected fakes/sanitized
  fixtures regardless.
- **Live OpenAI validation**: PARTIAL as of Sprint 4.5 — the configured model was confirmed
  available and a real, previously-untested schema bug was found and fixed live (DEC-043), but actual
  scenario calls are blocked by `429 credit_balance_exhausted` even after credits were added (see
  "Integration status"). All AI engineering is complete and tested against `MockAIProvider` regardless.
- **Scheduled/automatic sync**: intentionally not built (DEC-031) — only webhook-driven and manual
  sync exist.
- **Chat UI**: usable, single-active-conversation, not final visual polish — see
  `docs/AI-COPILOT.md`, "Known limitations." No streaming yet.
- **Real-world concierge**: not implemented (Sprint 6) — `getSpendingEnvelope` gives an overall
  budget for an outing, but no restaurant/hotel/product/travel search exists; the assistant says so
  explicitly rather than inventing a recommendation.

## Financial/business rules

See "NON-NEGOTIABLE PRODUCT RULES" above, `docs/FINANCIAL-ENGINE.md` for the exact calculation each
rule maps to, and `docs/OPEN-FINANCE.md` for how real provider data is translated into those rules'
inputs.

## UX rules

- The user is never blocked from spending (rule 7).
- Uncertainty must always be shown alongside any monetary total whose confidence/coverage isn't full
  — extended in Sprint 3 to liquidity coverage (never claim `liquidityAwareSafeToSpend` reflects the
  user's complete financial picture when `coverage !== "COMPLETE"`).
- **Never make sandbox data look like real money** (Sprint 3 brief's explicit instruction) — the
  DEMO/FIXTURE vs. PROVIDER DATA banner is the current mechanism; Pluggy's own sandbox connectors are
  clearly test/fake institutions, not real banks.
- No design polish attempted in Sprint 1–3 — the web UI's explicit purpose is validation/debugging.

## Confirmed user requirements (the fixture, as given by the founder)

Unchanged from Sprint 2 (see prior version of this file / `docs/DECISIONS.md` DEC-011/DEC-013 for
the full account) — PJ gross revenue BRL 15,000; taxes BRL 870; housing BRL 1,600; mother support
BRL 1,000 (protected); car BRL 2,715; old card debt ~BRL 1,400/month (now an `InstallmentPlan`,
unknown schedule); life insurance BRL 360; gym BRL 150; footvolley BRL 155; food target BRL 1,500;
protected savings target BRL 2,000; rodeo event; beach trip Sept 25–27 (unknown budget);
independent-living delta BRL 925/month. **Safe-to-Spend remains BRL 2,171.11 (217,111 cents)** for
the fixture/demo path — Sprint 3 did not change this number, and Sprint 4 reconfirms it through the
AI copilot layer too: `getSafeToSpend` (both called directly and through a simulated chat turn in
`orchestrator.test.ts`) returns the identical 217,111 cents.

## Current assumptions (need eventual confirmation from the founder)

- Everything carried forward from Sprint 2 (caution threshold, viability thresholds, TypeScript 6.x
  pin) remains unconfirmed/unresolved — see prior entries in `docs/DECISIONS.md`.
- The amount-sign/`FinancialEffect` mapping table (`docs/OPEN-FINANCE.md`) is a best-effort heuristic
  built from Pluggy's documentation and SDK source, **not validated against real sandbox data** — the
  founder connecting a real sandbox institution (once credentials exist) is the first real test of
  this mapping's accuracy.
- `normalizePluggyError`'s HTTP-status-to-code mapping is similarly unverified against real Pluggy
  error responses.
- No automatic/scheduled sync exists (DEC-031) — is manual + webhook-only sufficient once real
  sandbox/production use begins, or does a later sprint need a scheduled fallback?
- `hasExplicitMutationIntent`'s keyword patterns (Sprint 4) are a best-effort English-language
  heuristic, not validated against the Founder's actual real-world phrasing — worth revisiting once
  real usage is observed.
- The BRL currency-amount regex in `groundResponseText` (Sprint 4) has not been validated against a
  live model's actual prose variety (only against `MockAIProvider`-scripted text) — a live OpenAI
  validation pass should specifically check it doesn't produce false grounding failures on normal
  phrasing.

## Protected behaviors

Everything carried forward from Sprint 2, plus:

- A card bill payment, a transfer, a fee, and a refund are classified via `FinancialEffect` derived
  from the provider's own `type` field (never guessed from raw amount sign) — tested per account kind
  in `packages/open-finance/src/pluggy/mappers.test.ts`.
- A provider-derived installment schedule never silently replaces the founder's manual ~BRL
  1,400/month old-debt estimate — every match is a `CANDIDATE`, regardless of confidence (DEC-032).
- A duplicate connection for the same real-world Item is prevented both at the app level
  (`findProviderConnection` before create) and the database level (unique constraint, DEC-023).
- A duplicate webhook delivery (same `eventId`) is a no-op (`claimWebhookEvent`'s
  `INSERT ... ON CONFLICT DO NOTHING`).
- A deleted-by-provider transaction is marked `REVERSED`, never hard-deleted.
- (Sprint 4) A mutation tool never executes unless `hasExplicitMutationIntent` confirms the
  triggering user message contained a decided action — independent of whatever the model itself
  decided to call.
- (Sprint 4) An AI-stated monetary figure that cannot be traced to a tool result or the user's own
  input is never shown as-is — `groundResponseText` replaces it with a deterministic fallback.
- (Sprint 4) `OPENAI_API_KEY` is never sent to the browser, logged, persisted, or included in an
  `AIRequestLog` row.

## Rejected approaches

Carried forward from Sprint 1–2, plus (Sprint 3):

- **A separate `Account` entity** — `PaymentSource` extended in place instead (DEC-022, extends
  DEC-009).
- **Auto-applying a HIGH-confidence old-debt installment match** — every match stays a `CANDIDATE`
  regardless of confidence; the brief's conservative instruction and the lack of live data to
  validate the heuristic both argued against auto-apply (DEC-032).
- **A fabricated webhook signature scheme** — Pluggy documents no signature mechanism; protection is
  an unguessable shared secret in the webhook URL instead, explicitly documented as URL-obscurity,
  not cryptographic verification (DEC-030, `docs/OPEN-FINANCE.md`).
- **Using a date-filtered sweep for `transactions/updated` webhooks** — initially implemented this
  way, then corrected after a failing integration test revealed it misses status changes (e.g.
  PENDING → POSTED) on transactions older than the sync cutoff; replaced with a targeted re-fetch by
  external id, matching Pluggy's own reference pattern (DEC-027).
- **Counting manual (non-provider) payment sources toward liquidity coverage** — initially
  implemented this way, then corrected after a failing test showed it made a zero-connections profile
  report `PARTIAL` coverage instead of the honest `UNKNOWN` (DEC-022's consequence).
- **A scheduled/polling sync job** — explicitly out of scope per the brief ("do NOT create an abusive
  high-frequency polling scheduler"); webhook + manual sync only (DEC-031).
- **(Sprint 4) Silently falling back to `MockAIProvider` in production when `OPENAI_API_KEY` is
  missing** — considered and rejected; `/api/chat` returns an explicit `AI_CONFIGURATION_ERROR`
  instead, so it's never ambiguous whether an AI response is real (DEC-042). `MockAIProvider` remains
  a test utility only.
- **(Sprint 4) Trusting the model's own judgment as the sole gate for mutation tools** — considered
  and rejected in favor of the independent, deterministic `hasExplicitMutationIntent` check, per the
  brief's explicit "defense-in-depth" instruction (DEC-038).
- **(Sprint 4) `previous_response_id`-based conversation continuation** — considered (it's the
  simpler OpenAI-native mechanism) and rejected in favor of fully reconstructing history from
  persisted `ConversationMessage` rows on every call, so the application (not OpenAI) owns
  conversation history and a future provider swap loses nothing (DEC-036).

## Technical debt

Carried forward from Sprint 1–2 (web UI/DB drift risk — now mitigated somewhat, since the UI *does*
read from the DB as of this sprint; `reconciliation_links` has no `financialProfileId` column, still
global across profiles — harmless with one profile, needs a migration before multi-profile support),
plus:

- No CRUD UI for old-debt installment match candidates (`getInstallmentPlanMatchCandidates` exists,
  nothing acts on it yet).
- `normalizePluggyError` and the sign/effect mapping table are unverified against real Pluggy
  responses/data (see "Current assumptions").
- No automatic/scheduled sync (by design, DEC-031, but worth tracking as a real limitation for
  production readiness).
- No streaming in the chat UI yet (Sprint 4) — acceptable for this sprint's scope, but worth
  revisiting for perceived latency once live OpenAI usage begins.
- `hasExplicitMutationIntent`'s keyword patterns and the grounding regex are both best-effort
  heuristics, not exhaustively validated against real model output (see "Open questions").
- No conversation summarization/pruning exists yet — a very long conversation would grow its
  reconstructed history and token usage linearly; not a problem yet, but worth watching (DEC-036's
  consequence).
- (Sprint 4.5) The mutation-guard's pattern list is now maintained in two languages (English and
  Portuguese) with no shared test harness enforcing parity between them — see "Risks."

## Known bugs

None open at end of Sprint 4.5. Three found and fixed across Sprints 3-4.5's own live/integration
testing (all are process/design corrections, documented as decisions rather than silent fixes):

1. The incremental sync's date-filtered fetch would miss a status update (PENDING → POSTED) on an
   older transaction — fixed by adding a targeted re-fetch-by-id path used specifically for
   `transactions/updated` webhooks (DEC-027).
2. Liquidity coverage counted manual (non-synced) payment sources, incorrectly reporting `PARTIAL`
   coverage for a profile with zero real connections — fixed by filtering to provider-synced accounts
   only (DEC-022's consequence).
3. (Sprint 4.5) Every AI tool with an optional argument failed against the real OpenAI API with
   `400 invalid_function_parameters` — OpenAI's strict function-calling mode requires every
   `properties` key to appear in `required`, which plain Zod `.optional()` does not produce. Fixed by
   converting every optional tool argument to `.nullable().default(null)`, plus a permanent offline
   regression test (`tool-schema-strict-mode.test.ts`) — see DEC-043.

## Test status

**326 automated tests passing** in the default suite, zero failing, across five packages (up from
288 at end of Sprint 4), plus **6 additional opt-in live-OpenAI tests** that skip automatically
without `OPENAI_API_KEY` (never part of the default suite — see "Integration status"):

- `packages/financial-engine`: **124** (unchanged from Sprint 4).
- `packages/ai`: **11** (unchanged from Sprint 4).
- `packages/open-finance`: **46** (unchanged from Sprint 3).
- `packages/persistence`: **21** (unchanged from Sprint 4).
- `packages/app-services`: **124** (Sprint 4's 86, plus Sprint 4.5: PT-BR mutation-guard explicit/
  hypothetical cases mirroring the brief's examples, PT-BR grounding pass/fail cases, a full PT-BR
  conversation-loop suite in `orchestrator.test.ts` (Safe-to-Spend regression, hypothetical-vs-
  explicit mutation gating, grounding fallback, independent-living question — all in Portuguese), and
  `tool-schema-strict-mode.test.ts` asserting every one of the 16 tools' JSON Schemas satisfy OpenAI's
  strict-mode `required` constraint) — plus 6 skipped-by-default live tests in
  `live-openai-smoke.test.ts`.

Run with `pnpm run test` from the repo root, or per-package with `--filter`.

## Integration status

**Pluggy sandbox: engineering complete, live validation PARTIAL.** Real
`PLUGGY_CLIENT_ID`/`PLUGGY_CLIENT_SECRET` were used in Sprint 4.5. Real authentication and Connect
Token creation both succeeded (`POST /api/token` → HTTP 200 with a real sandbox `accessToken`, via the
running app against the real Pluggy API). The Founder reported completing the interactive Connect
widget, but the dev server's request log shows no corresponding `POST /api/connections` call, and
`GET /api/connections` still returns an empty list — no connection was persisted, and no account/
transaction/bill data was imported. Likely cause: the widget's `onSuccess` callback fires only once
Pluggy's own success confirmation appears and the widget closes on its own — closing the tab/window
right after submitting sandbox test credentials (before that confirmation) would not trigger it.
**Next attempt should**: open the currently-running dev server's page, click "Connect institution,"
choose a sandbox/test connector only (never a real institution), and keep the widget open until it
explicitly shows success and closes itself; then confirm `GET /api/connections` shows a new row
before considering the flow complete. Once a connection actually persists, the remaining validation
steps are: account retrieval, transaction retrieval, persistence, and snapshot recalculation — per
the original checklist, still unexecuted.

No Belvo, no real (non-sandbox) bank connections, no WhatsApp — all correctly out of scope for
Sprint 1–4.5.

**OpenAI: engineering complete, live validation PARTIAL.** A real `OPENAI_API_KEY` was used in
Sprint 4.5. `client.models.retrieve("gpt-5.6-terra")` succeeded, confirming the configured model
exists and is reachable with this key. The first real `generate()` call surfaced a genuine bug (DEC-
043, now fixed): OpenAI's strict function-calling mode rejected the tool schemas because optional
arguments were missing from each schema's `required` array. After the fix, every scenario call
still returns `429 credit_balance_exhausted` — this persisted even after the Founder added credits to
the account and after a wait, and was deliberately NOT retried further, with no model changed and no
new key created, per explicit instruction. This looks like a billing/quota issue specific to the
OpenAI account or the project this key belongs to (OpenAI supports a project-level spend budget
independent of the organization's overall credit balance — worth checking specifically in the OpenAI
dashboard under the key's project, not just the org-level billing page) rather than a code issue.
None of the 6 written PT-BR smoke-test scenarios (basic response, tool call + grounding regression,
affordability question, hypothetical-vs-explicit mutation gating, independent-living question) have
run to completion yet.

## Open questions

Carried forward from Sprint 2 (caution threshold, viability thresholds, protected savings target
methodology), plus:

- When can the Founder obtain Pluggy sandbox credentials, and is he willing to complete a real
  Connect flow through a Pluggy sandbox test connector once they're available (a short, one-time
  interactive step)?
- Is the current amount-sign/effect mapping table (`docs/OPEN-FINANCE.md`) good enough to trust with
  a real sandbox connector's data, or should it be revisited once real transactions are observed?
- Should old-debt installment match candidates get a lightweight accept/reject affordance before
  Sprint 5's full recommendation lifecycle UI, or wait?
- (Sprint 4.5) Does the OpenAI key's specific PROJECT have a $0 (or otherwise insufficient) budget
  limit separate from the organization's overall credit balance? This is the leading suspect for the
  persistent `credit_balance_exhausted` error even after credits were added at the org level.
- (Sprint 4.5) Was the Pluggy Connect flow the Founder completed actually run against this app's own
  `/api/token`-issued Connect Token (via the running dev server's widget), or through some other
  means (e.g. Pluggy's own dashboard tooling)? A retry against the app's own UI, keeping the widget
  open to its own success confirmation, is the next step either way.
- (Sprint 4) Should Sprint 5 (Recommendation Engine) happen before or after live Pluggy sandbox
  validation finally lands, given both remain pending?

## Next recommended sprint

**Sprint 5 — Recommendation engine with ACCEPT / MODIFY / REJECT / VERIFY lifecycle.** See
`docs/ROADMAP.md` for detailed scope. The AI copilot's tool layer (`packages/app-services/src/
copilot/`) and the `Recommendation` domain model (Sprint 1) are both already in place — Sprint 5's
job is the actual discovery logic, respecting `ProtectedPreference` and never resurfacing a rejected
recommendation absent material context change. Live Pluggy sandbox validation and live OpenAI
validation both remain PARTIAL (DEC-033, DEC-045) and should be completed before or alongside
Sprint 5 once the two open blockers above are resolved. **Sprint 5 has explicitly not been started.**

## Risks

Carried forward from Sprint 2 (threshold drift, version currency, reconciliation false negatives —
now somewhat validated by real Pluggy-shaped fixture testing, though not live data), plus:

- **(Sprint 4.5) Live OpenAI scenario validation still unexecuted**: the schema-level bug (DEC-043)
  is fixed and confirmed live, but no PT-BR scenario has actually completed against a real model
  response — `hasExplicitMutationIntent`'s and `groundResponseText`'s behavior against a live model's
  actual prose variety (as opposed to `MockAIProvider`-scripted text) remains unverified.
  `AIRequestLog` has similarly never recorded a real call's actual latency/token usage.
- **(Sprint 4.5) Live Pluggy data validation still unexecuted**: the amount-sign/effect mapping table
  and the card-payment/bill double-counting protection remain validated only against documentation-
  derived fixtures, never an observed real sandbox payload — see `docs/OPEN-FINANCE.md`.
- **(Sprint 4.5) Two-language maintenance burden**: the mutation-guard's pattern list must now be
  kept in sync across English and Portuguese — a behavior change in one language's patterns could
  silently not be mirrored in the other without a deliberate check.
- **Unvalidated provider mapping**: the sign/effect mapping table and error-code mapping are built
  from documentation and SDK source, not observed real data. A real sandbox connection could reveal a
  transaction shape the current keyword heuristics misclassify — see `docs/OPEN-FINANCE.md`, "Known
  provider limitations," for exactly where to extend the heuristics if that happens.
- **Global reconciliation links**: `reconciliation_links` has no `financialProfileId` column — a
  latent scalability gap, harmless today (one profile), but must be fixed before multi-profile
  support (would need a migration).
- **No automatic sync**: staleness between real provider updates and what the dashboard shows is
  only resolved by a webhook firing or a manual click — acceptable for sandbox/demo use, revisit
  before any real production deployment.
