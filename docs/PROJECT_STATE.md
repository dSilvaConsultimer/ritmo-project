# Money Copilot — Project State

**This file is the canonical persistent project memory.** Before every future sprint, read this
file, plus `docs/PRODUCT.md`, `docs/ARCHITECTURE.md`, `docs/FINANCIAL-ENGINE.md`,
`docs/ROADMAP.md`, and `docs/DECISIONS.md` (and, from Sprint 3 on, `docs/OPEN-FINANCE.md` for
provider-integration detail), in that order. This documentation is more authoritative than
assumptions carried over from a chat session. If a new request conflicts with a rule documented here:
identify the conflict, explain the existing rule, do not silently change it, implement the new
behavior only if it clearly supersedes the old decision, and record the change in
`docs/DECISIONS.md` (mark the old decision superseded, add a new one — never rewrite history).

Last updated: **2026-09-09, end of Sprint 4.5 (Pluggy live validation completed + fixture-id/bill-dedup hardening).**

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
    connects to or uses the Founder's real Santander/Nubank accounts — only seeded/mock/fixture data,
    or (Sprint 4.5) a Pluggy SANDBOX test connector. Live Pluggy sandbox validation itself is now
    COMPLETE (see "Integration status"), but this gate stays `false` regardless until a SEPARATE,
    explicit Founder/Product decision allows real personal accounts — sandbox validation passing is a
    precondition for that decision, not the decision itself.
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
live Pluggy sandbox validation COMPLETE; live OpenAI validation PARTIAL** (real credentials were used
throughout — three real, previously-untested bugs were found and fixed live: an OpenAI strict-schema
bug (DEC-043), a fixture-id-stability bug that also caused a real React rendering error (DEC-047),
and a bill-deduplication bug (DEC-048); the connection-recovery architectural gap DEC-046 identified
was also fixed and then validated by a second, successful sandbox Connect. OpenAI's actual scenario
calls remain blocked by an account-level `credit_balance_exhausted` error unrelated to this
engineering — see "Integration status" for the exact status of both). See the Sprint 4.5 final report
delivered to the founder for the full account; this file carries forward only what a future sprint
needs to know.

## Completed capabilities

**New in Sprint 4.5** (see `docs/DECISIONS.md` DEC-043–048, `docs/AI-COPILOT.md`, and
`docs/OPEN-FINANCE.md` for the full account):

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
- **Connection recovery hardening (architectural finding from the above)**: `onSuccess` is no longer
  the sole mechanism for discovering/persisting a `ProviderConnection` — Pluggy's own docs say it's
  not guaranteed to fire, and this sprint's live attempt proved that in practice.
  `recoverOrphanedConnection` (`packages/app-services/src/sync.ts`) deterministically re-attributes an
  orphaned Item to its owning `FinancialProfile` via the Item's own `clientUserId` (validated against
  a real known profile first), then runs it through the exact same `completeConnection` pipeline
  `onSuccess` uses. The existing webhook dispatcher now calls this instead of silently dropping an
  `item/*` event for an unknown `itemId`. Idempotent by construction — never duplicates a connection
  regardless of whether `onSuccess`, a webhook, or both eventually fire. See DEC-046 and
  `docs/OPEN-FINANCE.md`, "Connection recovery."
- 336 automated tests passing in the default suite (up from 288), plus 6 additional opt-in
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
- ~~Live Pluggy sandbox validation~~ — **COMPLETE as of Sprint 4.5** (see "Integration status"): a
  real sandbox Item was connected, synced, and reflected in the dashboard end to end. Moved out of
  this section; kept only historically relevant items below it.
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
- (Sprint 4.5) A `ProviderConnection` is never lost solely because the Connect widget's `onSuccess`
  callback failed to fire — `recoverOrphanedConnection` re-attributes the Item via its own
  `clientUserId`, validated against a real known `FinancialProfile` first.
- (Sprint 4.5) A connection is never duplicated regardless of whether `onSuccess`, a webhook, or both
  eventually report the same Item — `recoverOrphanedConnection` checks for an existing connection
  (profile-agnostic) before doing anything else, on top of DEC-023's existing DB-level guarantee.

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

None open at end of Sprint 4.5. Five found and fixed across Sprints 3-4.5's own live/integration
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
4. (Sprint 4.5) Every fixture id except the profile id was `createId()`-generated, not stable across
   a fresh module evaluation — silently defeating `seed()`'s idempotency across dev-server restarts
   (and Next.js's separate RSC-vs-Route-Handler module registries) and piling up duplicate fixture
   rows, which in turn produced a real React "two children with the same key" console error (the
   duplicated "Beach trip budget unknown" warning). Fixed by making every fixture id a stable string
   literal, plus `vi.resetModules()`-based regression tests that reproduce the actual failure mode —
   see DEC-047. The React rendering itself was separately hardened too (composite `text:index` keys,
   `apps/web/app/lib/warning-key.ts`) so repeated-but-legitimate warnings never break rendering again
   regardless of the data layer.
5. (Sprint 4.5) `CreditCardBill` rows were duplicated on every repeat sync of the same connection —
   found via real Pluggy sandbox data. Fixed to match the existing idempotent-upsert pattern already
   used for transactions/payment sources — see DEC-048.

## Test status

**344 automated tests passing** in the default suite, zero failing, across six packages (up from
288 at end of Sprint 4), plus **6 additional opt-in live-OpenAI tests** that skip automatically
without `OPENAI_API_KEY` (never part of the default suite — see "Integration status"):

- `packages/financial-engine`: **126** (124 from earlier in Sprint 4.5, plus `stable-ids.test.ts` —
  DEC-047's `vi.resetModules()`-based fixture-id-stability regression test).
- `packages/ai`: **11** (unchanged from Sprint 4).
- `packages/open-finance`: **46** (unchanged from Sprint 3 — `MockProvider`'s `getConnection` gained
  an optional `clientUserId` lookup for connection-recovery testability, no behavior change for
  existing callers).
- `packages/persistence`: **22** (21 from earlier in Sprint 4.5, plus a `vi.resetModules()`-based
  cross-module-reset idempotent-seed regression test — the persistence-level half of DEC-047).
- `apps/web` (new test runner, Sprint 4.5): **4** (`warningKey`'s uniqueness/stability/no-content-
  loss properties — the regression test for the React duplicate-key bug this sprint's live validation
  surfaced).
- `packages/app-services`: **135** (Sprint 4's 86, plus Sprint 4.5: PT-BR mutation-guard explicit/
  hypothetical cases mirroring the brief's examples, PT-BR grounding pass/fail cases, a full PT-BR
  conversation-loop suite in `orchestrator.test.ts` (Safe-to-Spend regression, hypothetical-vs-
  explicit mutation gating, grounding fallback, independent-living question — all in Portuguese),
  `tool-schema-strict-mode.test.ts` asserting every one of the 16 tools' JSON Schemas satisfy OpenAI's
  strict-mode `required` constraint, `connection-recovery.test.ts`'s 10 tests covering the 6 required
  scenarios (onSuccess normally, frontend closes before onSuccess, webhook later confirms the Item,
  missing connection recovered, both onSuccess and webhook arrive in either order, repeated recovery
  stays idempotent) plus two defensive cases (no `clientUserId` reported; `clientUserId` matching no
  known profile), and a bill-deduplication regression test (DEC-048, syncing the same mock connection
  twice and asserting exactly one bill row persists) — plus 6 skipped-by-default live tests in
  `live-openai-smoke.test.ts`.

Run with `pnpm run test` from the repo root, or per-package with `--filter`.

## Integration status

**Pluggy sandbox: engineering complete, live validation COMPLETE.** A first attempt (below) found a
real architectural gap; a second sandbox Connect attempt, after hardening, succeeded end to end and
was independently verified against the live database and the running dashboard:

1. **Connect Token creation** — `POST /api/token` → HTTP 200 with a real sandbox `accessToken`.
2. **Real Connect flow through a sandbox test connector** — `ProviderConnection.connectorName =
   "Pluggy Bank"` (a Pluggy sandbox/test institution, never a real bank), `status: "CONNECTED"`.
3. **Account retrieval** — 2 real accounts imported ("GOLD Conta Corrente" checking, "PLUGGY UNICLASS
   MASTERCARD BLACK" credit card).
4. **Transaction retrieval** — multiple real sandbox transactions imported (NETFLIX.COM, SPOTIFY AB,
   SMART FIT ACADEMIA, a "Pagamento de boleto" checking-account debit, …), correctly deduplicated by
   `externalTransactionId` across repeated syncs (unlike bills — see DEC-048 below).
5. **Bill retrieval** — 2 real credit-card bills imported; found and fixed a duplication bug on
   repeat sync (DEC-048).
6. **Persistence + snapshot recalculation** — `GET /api/connections` and the dashboard's "Connected
   Accounts" section both show the real connection; `FinancialPosition` liquidity coverage changed
   from `UNKNOWN` to `PARTIAL` (real account balances now known); Safe-to-Spend recalculated to
   include the real imported data. The dashboard banner correctly switched from "DEMO / FIXTURE DATA"
   to "PROVIDER DATA CONNECTED (SANDBOX)".
7. **Card-payment/bill double-counting protection** — confirmed with real data: bills remain stored
   separately and are never summed into `FinancialSnapshot` (unchanged architecture). The sandbox
   dataset's own transactions didn't happen to include a "pay off this credit card from my checking
   account" transaction specifically, so the `CARD_PAYMENT` classification path itself is still only
   validated against fixtures/mocks, not real data — a residual, narrow gap, not a known failure.

**First attempt (for the record)**: real authentication and Connect Token creation succeeded, but the
Connect widget's `onSuccess` callback never reached `/api/connections` — no connection was persisted.
This directly motivated the connection-recovery hardening below (DEC-046) before the Founder retried.

**Architectural findings from this validation, all fixed and regression-tested**:
- **DEC-046**: `onSuccess` is no longer the sole mechanism for discovering/persisting a connection —
  the webhook dispatcher recovers an orphaned Item via its `clientUserId` if `onSuccess` never fires.
- **DEC-047**: every fixture id (except the profile id) was `createId()`-generated, not stable across
  a fresh module evaluation (a dev-server restart, or Next.js's separate RSC-vs-Route-Handler module
  registries — both observed live) — silently defeating `seed()`'s idempotency and piling up
  duplicate fixture rows on every restart. This was the actual cause of a React "two children with
  the same key" console error the Founder hit (the duplicated "Beach trip budget unknown" warning was
  real, not a rendering artifact) — see "Known bugs" and the web app fix below. Fixed by making every
  fixture id a stable literal.
- **DEC-048**: `CreditCardBill` rows were duplicated on every repeat sync of the same connection
  (unlike transactions/payment sources, nothing looked up an existing bill by external id first).
  Fixed to match the existing idempotent-upsert pattern.

**Known residual state**: the LOCAL DEV DATABASE used during this validation still contains the
duplicate fixture rows accumulated BEFORE the DEC-047 fix (7x copies of several fixture entities) —
the fix prevents any NEW duplication but does not retroactively clean up what already accumulated.
The real Pluggy-imported connection/accounts/transactions are unaffected (they were always keyed by
stable external ids). A `.data` wipe + fresh reseed + a new sandbox Connect would give a fully clean
baseline; this was left for the Founder to decide given it requires redoing the interactive step.

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

- Is the current amount-sign/effect mapping table (`docs/OPEN-FINANCE.md`) — now exercised against
  real sandbox data for the first time (Sprint 4.5) — producing semantically correct classifications,
  or should any of it be revisited? (Several CREDIT-direction credit-card transactions were classified
  `REFUND`; this was not manually cross-checked against Pluggy's own intended meaning for those
  specific sandbox fixture transactions.)
- Should old-debt installment match candidates get a lightweight accept/reject affordance before
  Sprint 5's full recommendation lifecycle UI, or wait?
- (Sprint 4.5) Does the OpenAI key's specific PROJECT have a $0 (or otherwise insufficient) budget
  limit separate from the organization's overall credit balance? This is the leading suspect for the
  persistent `credit_balance_exhausted` error even after credits were added at the org level.
- (Sprint 4.5) Does the Founder want the local dev database wiped and freshly reseeded (clearing the
  duplicate fixture rows accumulated before DEC-047's fix) before further local testing? This requires
  redoing the sandbox Connect step once more, so it was left as the Founder's call rather than done
  unilaterally.
- (Sprint 4) Should Sprint 5 (Recommendation Engine) happen before or after live OpenAI validation
  finally completes (Pluggy's is now done)?

## Next recommended sprint

**Sprint 5 — Recommendation engine with ACCEPT / MODIFY / REJECT / VERIFY lifecycle.** See
`docs/ROADMAP.md` for detailed scope. The AI copilot's tool layer (`packages/app-services/src/
copilot/`) and the `Recommendation` domain model (Sprint 1) are both already in place — Sprint 5's
job is the actual discovery logic, respecting `ProtectedPreference` and never resurfacing a rejected
recommendation absent material context change. Live Pluggy sandbox validation is now COMPLETE
(DEC-033/DEC-045/DEC-046 through DEC-048); live OpenAI validation remains PARTIAL and should complete
before or alongside Sprint 5 once the account-level billing question above is resolved. **Sprint 5
has explicitly not been started.**

## Risks

Carried forward from Sprint 2 (threshold drift, version currency, reconciliation false negatives —
now validated against real live Pluggy sandbox data as of Sprint 4.5, not just fixtures), plus:

- **(Sprint 4.5) Live OpenAI scenario validation still unexecuted**: the schema-level bug (DEC-043)
  is fixed and confirmed live, but no PT-BR scenario has actually completed against a real model
  response — `hasExplicitMutationIntent`'s and `groundResponseText`'s behavior against a live model's
  actual prose variety (as opposed to `MockAIProvider`-scripted text) remains unverified.
  `AIRequestLog` has similarly never recorded a real call's actual latency/token usage.
- **(Sprint 4.5) The amount-sign/effect mapping table was exercised against real sandbox data for the
  first time**, and produced plausible-looking results (e.g. `REFUND` for CREDIT-direction credit-card
  entries), but this was not manually cross-checked against Pluggy's own documentation of what each
  specific sandbox fixture transaction is meant to represent — see `docs/OPEN-FINANCE.md`, "Known
  provider limitations." The `CARD_PAYMENT` classification path specifically was not exercised by this
  particular sandbox dataset (it happened not to include a credit-card-bill-payment transaction).
- **(Sprint 4.5) Two-language maintenance burden**: the mutation-guard's pattern list must now be
  kept in sync across English and Portuguese — a behavior change in one language's patterns could
  silently not be mirrored in the other without a deliberate check.
- **(Sprint 4.5) The local dev database still contains pre-DEC-047 duplicate fixture rows** (7x
  copies of several entities, accumulated before the fix) — harmless to the fix's correctness going
  forward, but noisy for any further local testing until a `.data` wipe + reseed + fresh sandbox
  Connect is done (left as the Founder's call).
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
