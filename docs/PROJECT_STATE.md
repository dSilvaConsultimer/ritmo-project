# Money Copilot — Project State

**This file is the canonical persistent project memory.** Before every future sprint, read this
file, plus `docs/PRODUCT.md`, `docs/ARCHITECTURE.md`, `docs/FINANCIAL-ENGINE.md`,
`docs/ROADMAP.md`, and `docs/DECISIONS.md` (`docs/OPEN-FINANCE.md` from Sprint 3 on for
provider-integration detail, `docs/AI-COPILOT.md` from Sprint 4 on for the AI copilot layer,
`docs/RECOMMENDATIONS.md` from Sprint 5 on for the recommendation engine, `docs/CONCIERGE.md` from
Sprint 6 on for the concierge/discovery layer, and `docs/ALERTS-NOTIFICATIONS.md` from Sprint 7 on for
the alert/notification engine), in that order. This documentation is more authoritative than
assumptions carried over from a chat session. If a new request conflicts with a rule documented here:
identify the conflict, explain the existing rule, do not silently change it, implement the new
behavior only if it clearly supersedes the old decision, and record the change in
`docs/DECISIONS.md` (mark the old decision superseded, add a new one — never rewrite history).

Last updated: **2026-09-11, Sprint 8 complete; Sprint 9 IN PROGRESS (uncommitted).** Sprint 8's
Founder-approved Lovable prototype ("Ritmo") remains the live product UI: `apps/ritmo` (TanStack
Start), all six screens wired to the real `@money-copilot/app-services`/financial-engine/persistence
stack. See `docs/RITMO.md` for that architecture and `docs/DECISIONS.md` DEC-083 through DEC-086.

**Sprint 9 — Production Foundation, Authentication & Multi-User Isolation — IN PROGRESS.** Everything
below is real, implemented, and passing its own tests, but **uncommitted** (still sitting in the
working tree as of this update — HEAD is still the Sprint 8 commit) and has NOT had Founder visual
sign-off yet. Phase-by-phase status, confirmed by a state-recovery audit plus a follow-up fix-up pass
(this session):
- **Phase 0 (env/config foundation) — COMPLETE.** `@money-copilot/config` (`resolveAppEnvironment`,
  `requireEnv`, `assertDevOnlyFlagNotInProduction`). DEC-087.
- **Phase 1 (identity/database foundation) — COMPLETE, Postgres path unexercised against a live
  server.** Better Auth's identity tables (`user`/`session`/`account`/`verification`), driver-neutral
  `Database` type, `shouldUsePostgres`/`shouldSeedDatabase` environment gating, `reconciliation_links`
  profile-scoping migration. DEC-089/090/091/092/095/096. **No Neon/Postgres instance has ever been
  connected to this code — that exercise is Phase 6, not done.**
- **Phase 2 (IDOR/ownership hardening) — COMPLETE.** `packages/app-services/src/ownership.ts`'s
  `assertOwnedByProfile`, applied at every previously-vulnerable call site (connections,
  recommendations, alerts, concierge, AI conversations). A permanent two-profile adversarial suite
  (`two-profile-isolation.test.ts`) passes live. DEC-093/094.
- **Phase 3 (auth integration) — APPROVED, COMPLETE.** Real Better Auth server instance
  (Drizzle/Postgres adapter, email/password), real `/login`, `/cadastro`, `/recuperar-senha` UI wired
  to `better-auth/react`, real per-request server-side profile provisioning
  (`getCurrentProfileContext()`), a real adversarial test suite proving the security boundary is
  independent of router `beforeLoad`. Fail-closed `BETTER_AUTH_SECRET`/`BETTER_AUTH_URL` in
  staging/production (DEC-097); honest (non-fake-success) password recovery, gated on a
  transactional-email provider that does not exist yet (DEC-098, **still an open external
  dependency — see below**); Nitro build target matches DEC-090 (`node-server`, not Cloudflare
  Workers — DEC-099); `check-client-bundle.mjs` covers the Sprint 9 secret/package surface (DEC-100).
- **Phase 4 (onboarding + bank-connection UI/states) — APPROVED, COMPLETE.** Founder visual review
  PASSED. First-time flow: Sign up → Home's `beforeLoad` detects zero connections
  (real, server-resolved state, never a client flag — DEC-102) → `/onboarding` (Welcome, no skip in
  V1, a deliberate documented choice — DEC-102) → `/conectar-banco` (one dedicated screen, an internal
  state machine covering CONNECTING/AUTHENTICATING/SYNCING/CONNECTED/PARTIAL_DATA/RECONNECT_REQUIRED/
  TEMPORARY_ERROR — DEC-101) → real Pluggy Connect widget (`react-pluggy-connect`, the same widget
  `apps/web` already uses) → real `completeConnection`/sync-status polling → Home. `/mais`'s
  "Instituições conectadas" row now routes to `/conectar-banco` for connect/reconnect/manage — `/mais`
  itself is otherwise unchanged. SESSION_EXPIRED is a real Ritmo-styled screen
  (`/sessao-expirada`/`SessionExpiredScreen`), reached both from a root-level router error boundary and
  from every in-flight action in `conectar-banco.tsx` (DEC-102) — verified live against a corrupted
  session's actual server-thrown error, not assumed. Ownership: every new server function resolves
  `financialProfileId` via `getCurrentProfileContext()` and accepts none from the caller — a permanent
  adversarial suite (`connections.server.test.ts`) proves cross-user isolation and duplicate-connect
  protection against a real Better Auth session, a real (test) database, and a `MockProvider`
  registered under the real `"pluggy"` name. **Live-verified against the real Pluggy sandbox**
  (Connect Token creation succeeded against real sandbox credentials). **While validating this
  Phase, discovered and fixed a real Phase-3-introduced bug, unrelated to Phase 4 itself**: the
  `node-server` production build (DEC-099) crashed on every request because `apps/ritmo`'s own `zod`
  dependency (`^3.25.76`) didn't match what Better Auth 1.7.4 itself requires (`^4.5.4`) — fixed by
  upgrading (DEC-103). **Post-approval entry-flow fix (DEC-104)**: the Founder's own local browser was
  reaching `/onboarding` directly, skipping `/login` entirely — root cause was `apps/ritmo/.env.local`'s
  `DEV_AUTH_BYPASS=true` (a local dev convenience left on from before this fix-up), which made both the
  `beforeLoad` UX check and `getCurrentProfileContext()` skip real Better Auth and resolve to
  `DEMO_PROFILE_ID` (which honestly has zero connections, hence the onboarding redirect — Phase 4's own
  logic was correct given that false input). Fixed at the fault line: `DEV_AUTH_BYPASS` now defaults to
  `false`, documented in `.env.example` for the first time, and its bypass condition tightened to an
  explicit development/test allow-list (previously `!== production`, which would also have wrongly
  activated in staging). A new idempotent, real-Better-Auth-backed local test login
  (`teste@ritmo.local`/`RitmoTeste123!`, `apps/ritmo/src/functions/dev-seed.server.ts`,
  development/test only) lets this be re-tested repeatably. **The full entry state machine — no
  session → `/login`; session + no connection → `/onboarding`; session + connection → Home; logout →
  `/login` again, verified against a real `auth.api.signOut` — is now live-verified end to end.**
  **Phase 4 is fully approved and complete.**
- **Phase 5 (production hardening) — IMPLEMENTATION COMPLETE, pending Founder/architecture
  approval.** Not deployment — the hardening required BEFORE staging is provisioned. Rate limiting:
  one central, policy-driven, in-memory abstraction (`rate-limit.server.ts`, DEC-105) for AI
  burst/sustained and Open Finance action/poll limits (the Phase 4 1.5s SYNCING poll verified still
  unaffected); auth abuse protection reuses Better Auth's OWN built-in limiter (DEC-108, live-verified
  to actually 429 through the real HTTP handler — not a duplicate mechanism). AI cost protection: a
  real, previously-missing `max_output_tokens` ceiling added to `OpenAIProvider` (DEC-109). Security
  headers (CSP/clickjacking/MIME-sniffing/HSTS) applied to every response via `server.ts`'s existing
  wrapper, skipped only in development (DEC-110) — CSP honestly documents its one known gap
  (`'unsafe-inline'` for scripts, required by TanStack Start's own SSR hydration; not pretended solved).
  `apps/ritmo` now has its own Pluggy webhook receiver (DEC-111) — it had none before this phase.
  Structured logging with automatic secret redaction (DEC-106); the Phase 3 password-reset-link
  console-log risk fixed (DEC-107). `/api/health/live`, `/api/health/ready`, `/api/preflight` added
  (DEC-112/113). Bundle scan extended for the local dev test login's real credentials (DEC-114). A
  full audit found NO destructive schema operation exists anywhere in the codebase — structurally
  proven, not just asserted (DEC-115) — and produced a full BOOT_REQUIRED/FEATURE_REQUIRED/
  GO_LIVE_REQUIRED/OPTIONAL dependency classification (DEC-116). CORS/CSRF: audited, not changed —
  Better Auth's own defaults (trust only `baseURL`'s origin, real origin-check middleware) already
  satisfy the requirement. **120 tests now pass in `apps/ritmo` alone** (up from 82 after Phase 4's
  entry-flow fix). **Not yet Founder/architecture-reviewed.**
- **Phase 6 — split into 6A (staging preparation/plan) and 6B (real deployment/validation). 6A
  IN PROGRESS; 6B NOT STARTED.** No Neon database, no Railway (or other) deployment, no staging
  environment stood up, no external accounts created — **No real bank has been connected** under any
  of this Sprint 9 work (Pluggy sandbox only) — `REAL_PERSONAL_FINANCIAL_DATA_ALLOWED` remains
  `TRUE_PENDING_FOUNDER_APPROVAL`, unchanged by Sprint 9 so far. Phase 6A's code-side prerequisites are
  done: migrations are no longer applied on ordinary app boot (DEC-117, a real behavior change,
  superseding part of DEC-092/115 — see that entry) — `pnpm --filter @money-copilot/persistence run
  db:migrate:postgres` is now the one explicit, standalone command for staging/production migrations,
  intended as Railway's Pre-Deploy Command step; `/api/health/ready` now performs a real `select 1`
  round-trip rather than only constructing a lazy connection pool; `/api/preflight` is no longer
  publicly open in a live tier — gated behind a new optional `PREFLIGHT_SECRET` operational secret,
  unavailable (404) by default (DEC-118). **Phase 6A correction pass (same day)** closed six gaps a
  review found in the first draft: `DATABASE_URL` (pooled, app runtime) and `DATABASE_DIRECT_URL`
  (direct, migration-only) are now two distinct variables, never interchangeable (DEC-119) —
  `db:migrate:postgres` reads only the latter, fails clearly if it's missing even when `DATABASE_URL`
  is set. **Resend is implemented** (Founder's actual decision, not left pending) — a real, tested
  adapter (`email-resend.server.ts`) behind the unchanged DEC-098 boundary, gated on all three of
  `TRANSACTIONAL_EMAIL_PROVIDER=resend`/`RESEND_API_KEY`/`TRANSACTIONAL_EMAIL_FROM` being present
  (DEC-120) — no live Resend account required for any test to pass. The Pluggy webhook URL now
  actually derives from `BETTER_AUTH_URL` + `PLUGGY_WEBHOOK_SECRET` once those exist (DEC-121) — wired
  into `createConnectToken`, previously omitted. Node is pinned explicitly (`.nvmrc`, `engines.node
  = "26.x"` — the exact version this entire sprint was validated against, DEC-122). The build/migrate/
  start commands were verified live from the monorepo root: `pnpm --filter @money-copilot/ritmo run
  build` → `apps/ritmo/.output/server/index.mjs`; `pnpm --filter @money-copilot/persistence run
  db:migrate:postgres` fails clearly and quickly against both a missing `DATABASE_DIRECT_URL` and an
  unreachable host. The full Neon/Railway/Better-Auth/Pluggy-sandbox/webhook provisioning plan,
  corrected environment-variable matrix, and staging validation protocols (fresh-DB, upgrade-path,
  two-user isolation, AI, security) exist as a plan only — no external resource (Neon project, Railway
  service, Resend account) has been created.

**Open external dependencies, not engineering gaps (see DEC-116's full classification):** the
transactional-email provider decision is made (Resend, DEC-120) and fully implemented/tested — the
only remaining step is Resend-side (verifying a real sending domain in Resend's own dashboard, then
entering the real `RESEND_API_KEY`/`TRANSACTIONAL_EMAIL_FROM` in Railway), not a code gap. A real Neon
Postgres instance and a Railway (or equivalent) deployment are still required for Phase 6 — neither
has been provisioned. The explicit Pre-Deploy Command migration step DEC-115 recommended is now
implemented (`db:migrate:postgres`, DEC-117/119) and live-verified under both Node 26 and Node 24
(DEC-122/123) — not yet actually run against real infrastructure, since none exists yet.

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
    **Fully operational as of Sprint 5** — `assessVerification` deterministically confirms or
    disconfirms an ACCEPTED/MODIFIED recommendation against real imported transactions, with a
    separate `VerificationAssessment` ensuring insufficient evidence never falsely resolves either
    way. See `docs/RECOMMENDATIONS.md`, "Verification."
11. Rejected recommendations should not repeatedly return unless material context changes — the same
    principle governs rejected recurring-expense candidates (Sprint 2) and, in spirit, old-debt
    installment match candidates (Sprint 3, which are never even auto-confirmed in the first place —
    see rule 9-adjacent DEC-032). **Fully operational as of Sprint 5** for actual recommendations:
    `Recommendation.identityKey` is the single mechanism providing both suppression and
    material-change resurfacing — see `docs/RECOMMENDATIONS.md`, "Identity and idempotency."
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
20. **(Sprint 4.5) `REAL_PERSONAL_FINANCIAL_DATA_ALLOWED = TRUE_PENDING_FOUNDER_APPROVAL`** (raised
    from `false` — DEC-054/final Sprint 4.5 closure — after the Founder approved the live Pluggy
    sandbox validation result). This value means exactly two things and no more: (a) the Open Finance
    architecture has passed technical sandbox validation (real Connect → sync → snapshot pipeline,
    end to end, 3x-repeated-sync idempotency proven — see "Integration status"), so the product is
    now technically ELIGIBLE to receive real personal financial data; (b) no real personal institution
    (Santander, Nubank, or any other) may actually be connected until the Founder gives a SEPARATE,
    explicit approval to do so. No AI feature or sync path currently connects to or uses the Founder's
    real accounts — only seeded/fixture data or a Pluggy SANDBOX test connector. **Product's current
    recommendation is to wait for live OpenAI validation to also complete (see "Integration status")
    before the Founder gives that separate real-data approval, so the Founder's first real-data
    experience includes the working conversational copilot rather than a dashboard-only product.**
21. **(Sprint 4) A mutation tool only executes on the user's own explicit, decided action.**
    Hypothetical/exploratory language ("what if", "could I", "should I") must never result in a
    persisted financial change — enforced independently of the LLM's own judgment by
    `hasExplicitMutationIntent` (defense-in-depth, deterministically testable).
22. **(Sprint 4) Every AI-stated monetary figure must be traceable to a deterministic tool result or
    the user's own input.** An amount the model invents and cannot be traced is never silently shown
    as financial truth — `groundResponseText` enforces this, falling back to a deterministic template
    on failure.
23. **(Sprint 5) The LLM never invents a recommendation's eligibility, recurring amount, monthly/
    annual impact, effective date, transaction evidence, or verification result.** Every recommendation
    is discovered, calculated, and verified by `packages/financial-engine`; a MODIFY's target amount
    must be the user's own explicit figure, never a lower price the model suggests on its own.
    Accepting/modifying a recommendation never inflates current Safe-to-Spend — see
    `docs/RECOMMENDATIONS.md`.

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

pnpm workspace monorepo, now NINE packages/apps deep (Sprint 8 adds one new app, `apps/ritmo` — no
new package): `apps/ritmo` (TanStack Start, THE PRODUCT UI as of Sprint 8 — see `docs/RITMO.md`) and
`apps/web` (Next.js 16 App Router, now internal/debug only, retired once `apps/ritmo` reaches full
parity) both → `packages/app-services` (application/query service layer, the Sprint 4 AI tool/
orchestration layer `src/copilot/`, the Sprint 5 recommendation service, the Sprint 6 concierge module
`src/concierge/`, and the Sprint 7 alert/notification modules `src/alerts/`/`src/notifications/`, zero
Next.js OR TanStack dependency) → `packages/ai` (provider-neutral `AIProvider` + OpenAI adapter,
Sprint 4), `packages/open-finance` (provider abstraction + Pluggy adapter + MockProvider),
`packages/discovery` (provider-neutral `LocalDiscoveryProvider` + Mock provider, Sprint 6 — mirrors
`open-finance`'s shape for real-world venue data), and `packages/persistence` (Drizzle + PGlite) →
`packages/financial-engine` (zero framework/database/provider/AI/discovery dependencies, the priority
package — Sprint 8 adds one additive optional field, `FixedExpense.dueDayOfMonth?: number`, display-only,
never used in any calculation) → `packages/shared` (generic `Id`/id-generation only). Both `apps/web`
and `apps/ritmo` call `@money-copilot/app-services` directly — one source of truth for every
financial calculation, Safe-to-Spend, transaction, Open Finance, recommendation, alert, and AI
orchestration; `apps/ritmo`'s presentation adapters (`src/adapters/`) only ever reshape that data for
its ported-verbatim Lovable UI, never recompute it. Full detail: `docs/ARCHITECTURE.md`. Calculation
detail: `docs/FINANCIAL-ENGINE.md`. Provider integration detail: `docs/OPEN-FINANCE.md`. AI copilot
detail: `docs/AI-COPILOT.md`. Recommendation engine detail: `docs/RECOMMENDATIONS.md`. Concierge
detail: `docs/CONCIERGE.md`. Alerts/notifications detail: `docs/ALERTS-NOTIFICATIONS.md`. Ritmo UI
integration detail: `docs/RITMO.md`.

## Current sprint

**Sprint 8 — Ritmo (Lovable) UI integration. COMPLETE.** The Founder approved a Lovable-generated
prototype (`meu-ritmo-design`, product name "Ritmo") as the visual source of truth for Money
Copilot's consumer product UI, replacing `apps/web`'s developer dashboard as the surface end users
see. A new app, `apps/ritmo` (React 19, TanStack Start, Vite, Tailwind v4, shadcn/ui — the
prototype's own stack, copied in and never redesigned/simplified/"improved"), was built with a strict
architectural boundary: `apps/ritmo/src/functions/` (TanStack `createServerFn()` bodies) is the ONLY
layer allowed to import `@money-copilot/app-services`, enforced at the Vite plugin level in dev
(TanStack Start's native import-protection, configured by Lovable's own scaffold) and proven at
build time by a new automated check (`scripts/check-client-bundle.mjs`, scans the client-only build
output for `OPENAI_API_KEY`/`PLUGGY_CLIENT_SECRET` values/literals and server-only package names).
`apps/ritmo/src/adapters/` are pure presentation-reshaping functions — no I/O, no financial
calculation — between a server function's raw domain data and the UNCHANGED Lovable JSX. All six
screens (Home, Transações, Planejamento, Insights, Assistente, Mais) were migrated one at a time,
each verified against a pre-captured visual baseline (mobile + desktop, light + dark) before moving
to the next; `src/lib/mock.ts` (the prototype's static example data) was kept only through that
baseline checkpoint and is now deleted. A single profile-resolution seam,
`getCurrentProfileContext()`, is the only place `DEMO_PROFILE_ID` is referenced — explicitly not an
authentication implementation, but the seam a future sprint's real auth replaces with zero changes to
any adapter or route. The Assistente screen's chat is real, not scripted — it calls the SAME
OpenAI-backed `runCopilotTurn` orchestrator `apps/web`'s (UI-less) `/api/chat` route already used,
verified live with real, billed OpenAI calls. Nine data-model gaps were found where the mock implied
a fact the real engine doesn't know (a bill due-date, a paycheck date, a subscription plan, a
scheduled daily digest, an exact before/after simulation pair, etc.) — every one resolved by adapting
displayed COPY only, never by fabricating a number or changing the approved component's visual
result; see `docs/RITMO.md`, "Data-model gaps," for the full list and each resolution.
`FixedExpense.dueDayOfMonth?: number` was added as the one additive domain-model change (optional,
display-only, absent unless separately confirmed — never backfilled from the mock's placeholder
dates). Founder visual and product validation PASSED against the real running engine. Full monorepo
`typecheck`/`lint`/`test` green throughout (645 automated tests, up from 599). See `docs/RITMO.md`
for the complete architecture, verification record, and known limitations, and `docs/DECISIONS.md`
DEC-083 through DEC-086 (DEC-083 extends DEC-051's PGlite single-process rule to `apps/ritmo`;
DEC-084 is the `functions/`-not-`server/` import-protection finding; DEC-085 is a live timezone
off-by-one date-formatting bug; DEC-086 is the Assistente screen's simulation-card field mapping and
markdown-rendering fix).

**Sprint 7 — Alerts, notifications & product hardening. COMPLETE.** A deterministic alert engine
(`packages/financial-engine/src/domain/alert-policy.ts`/`alert-signal.ts` for pure classification,
`packages/app-services/src/alerts/` for the persisted `Alert` lifecycle) with an 8-type catalog
(`SAFE_TO_SPEND_MATERIAL_DROP`, `RECOMMENDATION_FAILED`/`VERIFIED`, `UPCOMING_EVENT_PRESSURE`/
`UNKNOWN_COST`, `LIQUIDITY_COVERAGE_DEGRADED`, `CONNECTION_NEEDS_ATTENTION`, `STALE_CONCIERGE_PLAN`) —
alert CREATION is 100% deterministic; the AI may only read/explain/mark-seen/dismiss/re-check an alert
that already exists (same "engine calculates, AI interprets" boundary as every prior sprint). A single
shared episode mechanism (`upsertAlertEpisode`) implements anti-spam/reuse/resolve/rearm for every
alert type at once; a persisted per-profile checkpoint plus a recovery-hysteresis baseline prevents both
retroactive-noise-on-bootstrap and flapping-at-the-threshold. In-app notification delivery
(`packages/app-services/src/notifications/`) is architecturally separate from alert state (never one
table), with a provider-neutral `NotificationProvider` abstraction (mirrors `OpenFinanceProvider`/
`LocalDiscoveryProvider`) — no real push/email provider exists yet
(`LIVE_EXTERNAL_NOTIFICATION_VALIDATION = NOT_CONFIGURED`). Connected Accounts UX was hardened
(Disconnect button, Reconnect flow for a troubled connection, and closing the Sprint 4.5
duplicate-Connect-click gap by disabling the button for the widget's entire open duration, not just the
token fetch). Discovery production safety was added (`MockDiscoveryProvider` can no longer be resolved
under `NODE_ENV=production`, closing a real gap where a production deployment with no live discovery
credential would otherwise silently show synthetic venues as real). A declarative, colocated
fact-extraction mechanism (`ToolDefinition.extractFacts`) was added specifically to end a FOURTH
recurrence of the "a new tool's monetary figure has no grounding extractor" bug class (DEC-055/062/074,
now DEC-081's fix). Live validation against the real running app, real OpenAI, and the real persisted
Pluggy sandbox connection from earlier sprints PASSED end to end and found one more real bug live —
DEC-082, a mutation-guard pattern that only matched the brief's own bare example phrasing, not natural
real usage — fixed with regression tests and re-verified live. See `docs/ALERTS-NOTIFICATIONS.md` and
`docs/DECISIONS.md` DEC-076 through DEC-082.

**Sprint 6 — Budget-aware concierge & real-world discovery. COMPLETE.** A new `@money-copilot/discovery`
package (mirroring Open Finance's exact abstraction pattern) plus `packages/app-services/src/concierge/`
combine the deterministic financial engine with real-world venue discovery, with a hard,
architecturally-enforced rule: the financial envelope is always resolved first, and external search
can never influence it (`@money-copilot/discovery` has zero dependency on
`@money-copilot/financial-engine`, and vice versa). Deterministic `evaluateBudgetFit` reuses the
existing SAFE/CAUTION/HIGH_IMPACT boundaries rather than inventing a second zone model; structured
`PriceEvidence` never treats a price as exact by default and never invents a `$`-to-BRL conversion;
multi-part plans (required + optional components) are combined with deterministic arithmetic, with an
unknown-priced optional component correctly producing an `UNKNOWN_COST` (not `SAFE`) combined fit;
ranking is centralized and budget-fit-dominant; discovery facts are grounded by construction (no
fragile regex-based name/rating/address verification); a strict privacy boundary ensures the discovery
provider only ever sees derived search constraints; and saving/selecting a plan is intent, never
spending (no `FinancialTransaction`; an explicit reservation reuses the existing `FinancialEvent`
mechanism). **No live discovery provider credential exists in this environment** — the running app
uses a deterministic mock provider; live validation covered the full envelope → intent → plans →
grounding → AI-explanation pipeline against real OpenAI, with only the external-venue-data step
mocked, and the exact Section 51 acceptance scenario PASSED end to end (correct envelope-first
ordering, party-size/payment-responsibility inference, plan arithmetic, budget-fit classification, no
fabricated data, `groundingStatus: PASSED`). Two real bugs were found live and fixed with regression
coverage: DEC-074 (a missing fact extractor for `getConciergeBudget` caused a correct answer to fail
grounding) and DEC-075 (a stale Sprint 4 system-instruction rule was suppressing the new discovery
tools). See `docs/CONCIERGE.md` for the full architecture and `docs/DECISIONS.md` DEC-065 through
DEC-075.

**Sprint 5 — Recommendation engine with ACCEPT / MODIFY / REJECT / VERIFIED / FAILED lifecycle.
COMPLETE** (unchanged by Sprint 6). Extended (not replaced) Sprint 1's `Recommendation` data model
into a full deterministic discovery/decision/verification system: candidate generation from confirmed
recurring discretionary spending (reusing `detectRecurringCandidates` unchanged), `ProtectedPreference`
evaluated before anything else, a centralized `RecommendationPolicy` (no hidden magic numbers), a
single `identityKey`-based mechanism that provides idempotency AND suppression AND material-change
resurfacing all at once, an append-only decision history, a `VerificationAssessment` kept separate
from lifecycle `status` so insufficient evidence never falsely resolves to VERIFIED/FAILED, full
Safe-to-Spend separation, a UI panel, and 5 AI tools with complete grounding coverage. See
`docs/RECOMMENDATIONS.md` and `docs/DECISIONS.md` DEC-056 through DEC-064.

**Sprint 4.5 — external-validation + PT-BR hardening pass on top of Sprint 4. FULLY CLOSED** (both
Pluggy and OpenAI portions APPROVED/PASSED; unchanged by Sprint 5). Eight real, previously-untested
bugs were found and fixed live: an OpenAI strict-schema bug (DEC-043), a fixture-id-stability bug
that also caused a real React rendering error (DEC-047, DEC-049 — two rounds), a bill-deduplication
bug (DEC-048), a connection-recovery architectural gap (DEC-046), a connection-deletion capability
gap (DEC-050), a Next.js RSC/Route-Handler database-singleton divergence bug (DEC-052), and a
grounding-coverage gap (DEC-055). A read-only diagnostic endpoint (`GET /api/debug/counts`,
dev-only-gated, DEC-053) was added specifically to let live validation inspect entity counts and
payment-source identities through the running application itself rather than a second process against
the file-backed PGlite database (forbidden — DEC-051). Both Safe-to-Spend numbers now in play — the
permanent fixture-only regression (BRL 2,171.11) and the live sandbox-connected runtime figure
(BRL 1,293.01) — are formally distinguished and reconciled component-by-component in DEC-054. See the
Sprint 4.5 final report delivered to the founder for the full account.

## Completed capabilities

**New in Sprint 8** (see `docs/DECISIONS.md` DEC-083 through DEC-086 and `docs/RITMO.md` for the
full account):

- **`apps/ritmo`, the new product UI**: React 19 + TanStack Start, ported visually verbatim from the
  Founder-approved `meu-ritmo-design` Lovable prototype — no redesign, simplification, or
  "improvement" of the approved visual result at any point.
- **All six screens wired to real data** (Home, Transações, Planejamento, Insights, Assistente,
  Mais): each screen's `functions/*.ts` server function calls the existing
  `@money-copilot/app-services` (same functions `apps/web` already used — zero duplicated business
  logic), and each screen's `adapters/*.ts` is a pure, unit-tested reshaping function with no I/O and
  no financial calculation.
- **Server/client security boundary, enforced twice**: TanStack Start's native import-protection
  plugin denies any client-context import from `apps/ritmo/src/functions/` at the Vite plugin level
  in dev; `scripts/check-client-bundle.mjs` proves it at build time by scanning the client-only
  output for `OPENAI_API_KEY`/`PLUGGY_CLIENT_SECRET` values/literals and server-only package names.
- **A single profile-resolution seam** (`getCurrentProfileContext()`) — the only place
  `DEMO_PROFILE_ID` is referenced anywhere in `apps/ritmo`, explicitly not an auth implementation but
  the seam a future real-auth sprint replaces with zero changes to any adapter or route.
- **Real AI chat on the Assistente screen** — calls the same `runCopilotTurn` orchestrator
  `apps/web`'s (UI-less) `/api/chat` route already used; no AI orchestration reimplemented. Verified
  live with real OpenAI calls, conversation persists across reloads.
- **`FixedExpense.dueDayOfMonth?: number`** (financial-engine, additive, optional, display-only,
  never used in any calculation) — the one domain-model change this sprint, plus a persistence
  migration (`0006_neat_virginia_dare.sql`) and a new `getFixedExpensesForProfile`/
  `getCategoryRuleCount` app-services query pair.
- **Nine data-model gaps found and resolved honestly** — every case where the Lovable mock implied a
  fact the real engine doesn't know was fixed by adapting displayed copy, never by fabricating a
  number or changing the approved component's visual result. Full list in `docs/RITMO.md`,
  "Data-model gaps."

**New in Sprint 7** (see `docs/DECISIONS.md` DEC-076–082 and `docs/ALERTS-NOTIFICATIONS.md` for the
full account):

- **Deterministic alert engine**: `AlertPolicy`/`DEFAULT_ALERT_POLICY` (financial-engine, every
  threshold centralized) + pure classification functions (`evaluateSafeToSpendChange`,
  `hasSafeToSpendRecovered`, `evaluateEventPressure`, `hasEventPassed`,
  `evaluateLiquidityCoverageChange`, `evaluateConnectionAttention`) + `Alert`/`evaluateAlerts`
  (app-services). 8-type catalog. Alert creation/severity is never decided by the AI.
- **One shared episode mechanism** (`upsertAlertEpisode`, DEC-077): reuse-if-still-true,
  resolve-if-now-false, create-only-if-no-non-terminal-row — implements anti-spam for every alert type
  at once. `Alert.transitions` is append-only, mirroring `Recommendation.decisionHistory`.
- **Bootstrap semantics + recovery hysteresis** (DEC-078): `AlertEvaluationCheckpoint` (one row per
  profile) suppresses retroactive alerting on a profile's first-ever evaluation for the two
  checkpoint-delta alert types only; a persisted episode baseline + hysteresis ratio prevents a
  Safe-to-Spend value oscillating at the threshold from flapping open/resolved every evaluation.
- **Notification layer, architecturally separate from alert state** (DEC-076/079):
  `NotificationDelivery`/`NotificationPreferences`/`NotificationProvider` (mirrors
  `OpenFinanceProvider`/`LocalDiscoveryProvider`) — `MockNotificationProvider` only;
  `LIVE_EXTERNAL_NOTIFICATION_VALIDATION = NOT_CONFIGURED`. Privacy mode (`GENERIC`/`AMOUNT_ALLOWED`)
  enforced at render time; quiet-hours evaluation exists but never suppresses IN_APP delivery itself.
- **Connected Accounts hardening** (DEC-080): a `DisconnectButton` (explicit confirm, idempotent) for
  the previously-missing UI over `disconnectConnection`; a "Reconectar" affordance (same `ConnectButton`
  flow, relabeled) for a `LOGIN_ERROR`/`USER_ACTION_REQUIRED`/`ERROR` connection; the Connect button now
  disables itself for the widget's ENTIRE open duration, closing the exact Sprint 4.5
  duplicate-connection-click gap.
- **Discovery production safety** (DEC-080): `getDiscoveryProvider` refuses `"mock"` under
  `NODE_ENV=production`; `concierge-service.ts` degrades to an honest `{discoveryUnavailable: true}`
  result instead of a crash or fabricated venues.
- **Declarative, colocated fact-extraction** (DEC-081): `ToolDefinition.extractFacts`, checked first by
  `extractFinancialFacts` before the legacy per-tool switch — ends a fourth recurrence
  (DEC-055/062/074) of "a new tool's monetary figure has no grounding extractor" for every NEW tool
  going forward, with zero migration risk to existing tools.
- **6 new AI tools + full grounding coverage**: `getAlerts`/`getAlertDetails`/
  `reevaluateAlertContext` (READ), `markAlertSeen`/`dismissAlert`/`updateNotificationPreference`
  (MUTATION, gated by `hasExplicitMutationIntent` extended with alert/preference language).
- **UI**: `AlertCenter.tsx` (severity-badged cards, mark-seen/dismiss, empty state "Nada precisa da sua
  atenção agora."), dashboard shows only the top-5 ranked active alerts
  (`packages/app-services/src/alerts/ranking.ts`'s `rankAlerts`).
- **Live validation: PASSED** end to end against the real running app, real OpenAI, and the real
  persisted Pluggy sandbox connection — a real material Safe-to-Spend drop via an ordinary chat
  interaction correctly created and later resolved/dismissed the right alerts, with grounding PASSED
  and Safe-to-Spend confirmed unchanged by alert actions. **One real bug found and fixed live**
  (DEC-082): a mutation-guard mark-seen pattern only matched the brief's own bare example phrasing, not
  a natural real message naming which alert — fixed, regression-tested, re-verified live.
- 599 automated tests passing in the default suite (up from 491 at end of Sprint 6), plus the same 7
  opt-in live-OpenAI tests.

**New in Sprint 6** (see `docs/DECISIONS.md` DEC-065–073 and `docs/CONCIERGE.md` for the full account):

- **`@money-copilot/discovery`** (new package): `LocalDiscoveryProvider` interface + deterministic
  `MockDiscoveryProvider` — mirrors `open-finance`'s exact abstraction pattern for real-world venue
  data. Zero dependency in either direction with `financial-engine` — the architectural guarantee
  behind "external search can never determine Safe-to-Spend."
  `packages/app-services/src/discovery-provider-registry.ts` mirrors `provider-registry.ts` exactly.
- **Financial-envelope-first, enforced architecturally** (DEC-065): every concierge entry point
  resolves `getSpendingEnvelopeForProfile` (Sprint 4, unchanged) before any discovery call;
  regression-tested that the search ceiling sent to the provider IS the envelope's own caution
  ceiling, and that an adversarial provider price cannot change `getSafeToSpend`'s own output.
- **`evaluateBudgetFit`** (`packages/financial-engine/src/simulation/budget-fit.ts`, DEC-066): reuses
  `SpendingEnvelope`'s existing two boundaries — no second zone model. Five zones
  (`WITHIN_RECOMMENDED`/`WITHIN_CAUTION`/`HIGH_IMPACT`/`EXCEEDS_LIMIT`/`UNKNOWN_COST`);
  `EXCEEDS_LIMIT` is the user's OWN explicit ceiling specifically and can never loosen a `HIGH_IMPACT`
  classification. Ranged costs get separate `minZone`/`maxZone` plus a conservative overall zone.
- **Structured `PriceEvidence`** (`packages/discovery/src/provider.ts`, DEC-067): six provenance-tagged
  shapes; `PRICE_LEVEL` never converts to a BRL amount in V1 (no documented mapping policy exists).
- **Concierge persistence type boundary** (DEC-068): `ConciergeSession`/`OutingPlan` are
  application-layer types (`app-services/src/concierge/types.ts`), never `financial-engine` domain
  types (they'd otherwise leak discovery concepts into the engine) — `packages/persistence` works with
  plain JSON-blob row shapes for the two new tables instead, with mapping done by
  `concierge-service.ts`.
- **Privacy boundary + external-data safety** (DEC-069): `DiscoverySearchCriteria` structurally cannot
  carry income/balance/debt/transaction history; a malicious venue description fed through a tool
  result is regression-tested to have zero effect on the system instructions sent to the AI provider
  or on grounding.
- **Discovery grounding by construction** (DEC-070): `DiscoveryFact` (separate from `FinancialFact`)
  is populated structurally from tool output, never written by the LLM — no fragile regex-based
  name/address/rating verification exists. Price-shaped discovery facts are merged into the SAME
  amount-checking pool `groundResponseText` already uses (the check only, never the response's
  `financialFacts` array).
- **Multi-part plans with deterministic arithmetic** (DEC-071): required-vs-optional power-set plan
  generation; any unknown-priced included component makes the combined total `null`
  (`UNKNOWN_COST`, never silently `SAFE`); `saveConciergePlan` never creates a `FinancialTransaction`;
  `reservePlanBudget` reuses the existing `createPlannedFinancialEvent` (Sprint 1/4) — no parallel
  reservation mechanism.
- **Budget-fit-dominant ranking** (`ConciergeRankingPolicy`, DEC-072): centralized, named weights;
  regression-tested that a lower-rated but within-budget venue outranks a higher-rated but
  HIGH_IMPACT one.
- **Stale financial context detection**: every `ConciergeSession` records its envelope snapshot;
  `reevaluateConciergePlan` flags `stale: true` the moment the envelope has changed since the plan was
  built.
- **6 new AI tools + full grounding coverage**: `getConciergeBudget`/`searchPlaces`/
  `buildConciergePlans`/`evaluateConciergePlan` (READ), `saveConciergePlan`/`reservePlanBudget`
  (MUTATION, gated by `hasExplicitMutationIntent` extended with plan-selection/reservation language in
  English and PT-BR). `getConciergeBudget`'s fact extractor (DEC-074) and a stale Sprint 4
  system-instruction rule that suppressed these tools entirely (DEC-075) were both real bugs found via
  live testing against the real model, not offline tests — both fixed, both regression-tested.
- **UI**: a read-only "Saved Concierge Plans" dashboard section, plus discovery-evidence cards in the
  chat panel.
- **`LIVE_DISCOVERY_VALIDATION = BLOCKED_BY_EXTERNAL_PROVIDER_CONFIGURATION`** (DEC-073): no Google
  Places/web-search/local-discovery credential exists in this environment (confirmed by inspecting
  `.env.example`/`.env.local` before choosing anything). The running app uses `MockDiscoveryProvider`
  by default; live validation covered the rest of the pipeline (envelope → intent → plans → grounding
  → AI explanation) against real OpenAI, running the brief's own Section 51 scenario end to end —
  **PASSED**, and along the way surfaced/fixed DEC-074 and DEC-075 (see "Current sprint" above).
- 489 automated tests passing in the default suite (up from 426 at end of Sprint 5), plus the same
  7 opt-in live-OpenAI tests (unchanged by Sprint 6).

**New in Sprint 5** (see `docs/DECISIONS.md` DEC-056–064 and `docs/RECOMMENDATIONS.md` for the full
account):

- **Deterministic recommendation candidate generation** (`generateRecommendationCandidates`,
  `packages/financial-engine/src/domain/recommendation-generation.ts`): reuses
  `detectRecurringCandidates` unchanged; a transaction is eligible only when `financialEffect ===
  "CONSUMPTION"`, categorized, not in a protected category, and not in the policy's default-excluded
  category list. `CANCEL_RECURRING_COST` only for HIGH confidence + a recognized cadence;
  everything else real becomes `REVIEW_RECURRING_COST` (never framed as guaranteed savings).
- **`ProtectedPreference` evaluated first, generically** (`protectedCategories`,
  `packages/financial-engine/src/domain/preference.ts`): resolves both `CATEGORY`-scoped and
  `EXPENSE`-scoped preferences to a category set, checked before any other filter. Regression-tested
  against the Founder's real family-support fixture with a transaction constructed to pass every
  OTHER filter, proving category protection works on its own.
- **`RecommendationPolicy`** (`recommendation-policy.ts`): every threshold (confidence minimums,
  evidence count, eligible financial effects, excluded categories, identity amount-bucket width,
  verification grace period, sync-staleness tolerance, reduction amount tolerance) centralized, named,
  documented, and passed as a plain parameter — never a scattered magic number.
- **Cadence-normalized impact calculation** (`recommendation-cadence.ts`, `recommendation-impact.ts`):
  `WEEKLY`/`MONTHLY`/`YEARLY`/`UNKNOWN` classification; a weekly/yearly charge is never multiplied as
  if monthly; `UNKNOWN` cadence never produces a monthly-equivalent figure at all.
  `computeReductionImpact` returns `null` (never zero/negative) when a target isn't actually less
  than the current amount.
- **One identity mechanism = idempotency + suppression + material-change resurfacing**
  (`Recommendation.identityKey`, unique per profile at the DB level, mirroring DEC-023's
  `ProviderConnection` pattern): repeated generation over unchanged data never duplicates a row; a
  REJECTED recommendation's identity never gets a new PENDING sibling (suppression); a genuinely
  different opportunity (price/cadence/merchant/type change) gets a NEW identity and becomes eligible
  again automatically — no separate resurfacing code exists or is needed.
- **Full lifecycle with append-only decision history**
  (`packages/app-services/src/recommendation-service.ts`): `acceptRecommendation`/
  `modifyRecommendation`/`rejectRecommendation`, each validating its own valid source statuses and
  appending a `RecommendationDecisionEvent` rather than overwriting history.
- **Safe-to-Spend separation**: accepting/modifying a recommendation never writes to any table
  `buildFinancialSnapshot` reads from — regression-tested directly. `getRecommendationsSummary`
  exposes three distinct, never-blended aggregates: potential (PENDING), accepted-expected
  (ACCEPTED/MODIFIED), and verified (VERIFIED) monthly savings.
- **Verification engine** (`assessVerification`,
  `packages/financial-engine/src/domain/recommendation-verification.ts`): a separate
  `VerificationAssessment` (`NOT_DUE`/`INCONCLUSIVE`/`CONFIRMED_SUCCESS`/`CONFIRMED_FAILURE`) keeps
  "insufficient evidence" from ever falsely resolving to VERIFIED/FAILED — only a CONFIRMED result
  transitions lifecycle status. Wired into `syncConnection` (idempotent — VERIFIED/FAILED are
  terminal and never re-evaluated) and into every homepage load.
- **UI**: a new "Recommendations" dashboard section (`RecommendationsPanel.tsx`) with
  Accept/Modify/Reject actions, an explicit no-external-cancellation disclaimer, and
  non-shaming status copy for rejected/failed outcomes.
- **5 new AI tools + full grounding coverage**: `getRecommendations`/`getRecommendationDetails`
  (READ), `acceptRecommendation`/`modifyRecommendation`/`rejectRecommendation` (MUTATION, gated by
  the same `hasExplicitMutationIntent` mechanism as every other mutation tool).
  `recommendationFacts` exposes every monetary field to grounding, added proactively per the Sprint
  4.5 lesson rather than discovered live.
- **4 real bugs found and fixed during implementation** (not simulated): a `daysBetween` date-parsing
  bug that silently defeated sync-staleness verification checks (DEC-061); real Pluggy sandbox
  NETFLIX.COM/SPOTIFY AB charges left permanently UNCATEGORIZED, invisible to this sprint's own
  headline example (DEC-063); `mutation-guard.ts` missing recommendation-decision language in both
  English and PT-BR, incorrectly blocking the brief's own example accept/reject phrases (DEC-064); and
  the Sprint 1 `Recommendation` shape being completely unwired (zero repository/mapper/seed code) —
  refactored in place rather than duplicated (DEC-056).
- 426 automated tests passing in the default suite (up from 354 at end of Sprint 4.5), plus the same
  7 opt-in live-OpenAI tests (unchanged, still passing when run live).

**New in Sprint 4.5** (see `docs/DECISIONS.md` DEC-043–054, `docs/AI-COPILOT.md`, and
`docs/OPEN-FINANCE.md` for the full account):

- **`globalThis` database singleton fix** (DEC-052): a real, twice-reproduced live bug — a
  successfully-persisted Pluggy connection was invisible on the RSC-rendered homepage even though
  `GET /api/connections` correctly reported it. Root cause: `getDb()` cached its DB-initialization
  promise on a plain module-level variable, which Next.js's Turbopack dev server does NOT treat as a
  single per-process singleton across its separate RSC/Route-Handler module "layers" — each layer got
  its own instance. Fixed by caching on `globalThis` instead (the same pattern used for the analogous
  Prisma-Client-in-Next.js-dev-mode issue). Verified live: RSC, Route Handlers, and the `app-services`
  layer all now resolve the identical running-process DB instance.
- **Read-only debug/diagnostics endpoint, hardened** (DEC-053): `GET /api/debug/counts`
  (`packages/app-services/src/queries.ts`'s `getEntityCounts` + the route) exposes entity counts and a
  non-sensitive payment-source audit (type/subtype/booleans only, never raw external ids or labels).
  Returns 404 in production BEFORE ever calling `getDb()` (regression-tested) — this only exists so
  live validation can inspect state through the already-running app rather than a second process
  against the PGlite file (DEC-051). Not linked from the UI; permanent, gated diagnostic tool.
- **Payment-source audit** (DEC-053): confirmed all 3 `PaymentSource`s present after the validated
  live sandbox connection are genuinely distinct — 1 pre-existing manually-entered fixture credit card
  (no provider, correctly excluded from liquidity) + 2 real, provider-backed Pluggy sandbox accounts
  (a checking account and a credit card, distinct external account ids). No duplicate mapping bug.
- **Safe-to-Spend dual-value reconciliation** (DEC-054): the permanent fixture-only regression
  (BRL 2,171.11 / 217,111 cents) and the live sandbox-connected runtime snapshot (BRL 1,293.01) are
  BOTH correct and BOTH permanent — they measure different things. The exact BRL 878.10 delta is
  fully explained by two snapshot components alone (`ACTUAL_SPENDING` +BRL 822.20 from real imported
  sandbox transactions, `DEBT_COMMITMENTS` +BRL 55.90 from one additional imported bill/installment
  plan) — every other component is byte-identical between the two snapshots. See DEC-054 for the full
  audit; neither number should ever be used to "correct" the other.
- **Connection deletion** (`disconnectConnection`, `DELETE /api/connections?connectionId=...`, DEC-050):
  a real live-testing scenario (two independent sandbox Connects both succeeding) needed a way to
  cleanly remove one connection and everything scoped to it, including reconciliation links that
  cross-reference a connection being kept — implemented using the existing repository layer only,
  never raw SQL, with 3 regression tests.
- **A second fixture-id instability** (DEC-049): `reconciliation_links` was NOT fully fixed by DEC-047
  — it still grew by one row per fresh-process seed run, because the fixture's reconciliation links
  are computed by calling the same general-purpose `findTransactionDuplicates`/
  `reconcileEventLineItems` functions a real sync uses, which generate a fresh id every call by
  design. Fixed by exporting `reconciliationLinkPairKey` and having `seed()` dedupe by content before
  upserting, exactly like a real sync already does. Caught only by extending the regression test to
  three resets with explicit per-entity assertions — the two-reset version happened not to catch it.
- **An operational lesson recorded, not a code bug** (DEC-051): running a standalone diagnostic script
  against the file-backed dev database WHILE the Next.js dev server also had it open corrupted the
  PGlite file irrecoverably (a hard WASM abort on every subsequent open, from any process). Recovered
  by wiping `.data` and rebuilding from migrations + the (now-fixed) seed — deterministic and
  complete for fixture data, but the real Pluggy-imported connection data from that session was lost
  and required one more live sandbox Connect. Documented as a hard rule: never run a second process
  against the same PGlite data directory while another one (dev server included) has it open.

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
- **Live OpenAI validation: PASSED (final)** — model availability confirmed (`gpt-5.6-terra`
  retrievable); after the Founder confirmed organization prepaid credit was available, all 7 PT-BR
  scenarios in `live-openai-smoke.test.ts` passed, stable across 3 consecutive live runs (see
  "Integration status"). Found and fixed one more real bug along the way, DEC-055: a
  grounding-coverage gap where `extractFinancialFacts` had never been wired up for several fields
  (and, for `getFinancialSnapshot`/`getLifestyleComparison`, entire tools) that were already correctly
  computed and correctly cited by the model — fixed with one shared `financialSnapshotFacts` helper
  plus a permanent offline regression (`facts.test.ts`).
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
- 349 automated tests passing in the default suite (up from 288 at end of Sprint 4), plus 6 additional
  opt-in live-OpenAI tests that skip automatically without a key (never part of the default suite —
  see "Test status" for the exact per-package breakdown).

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
  headroom); Sprint 5's actual discovery/decision engine covers RECURRING COSTS only — see
  `docs/RECOMMENDATIONS.md`, "Known limitations."
- **Old-debt reconciliation**: candidates are computed (`getInstallmentPlanMatchCandidates`) and
  exposed, but there is no UI/flow to act on one (accept/reject) — deliberately deferred (DEC-032).
  NOT bundled into Sprint 5 (which built a real, general accept/modify/reject/verify lifecycle for
  recurring-cost recommendations specifically) — reusing that same lifecycle machinery for old-debt
  candidates remains a candidate for a future sprint, not yet done.
- ~~Live Pluggy sandbox validation~~ — **COMPLETE as of Sprint 4.5** (see "Integration status"): a
  real sandbox Item was connected, synced, and reflected in the dashboard end to end. Moved out of
  this section; kept only historically relevant items below it.
- ~~Live OpenAI validation~~ — **COMPLETE as of Sprint 4.5** (see "Integration status"): all 7 PT-BR
  scenarios in `live-openai-smoke.test.ts` pass live, stable across 3 consecutive runs, after the
  Founder confirmed organization prepaid credit was available. Moved out of this section.
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
the fixture-only/demo path — Sprint 3 did not change this number, and Sprint 4 reconfirms it through
the AI copilot layer too: `getSafeToSpend` (both called directly and through a simulated chat turn in
`orchestrator.test.ts`) returns the identical 217,111 cents. **This is a PERMANENT regression figure,
distinct from and never overwritten by the Sprint 4.5 live sandbox-connected runtime figure
(BRL 1,293.01) — see DEC-054 for the full component-by-component reconciliation of the BRL 878.10
difference between them.** A future session must never "fix" `snapshot.test.ts`'s 217,111-cent
assertions to match a live runtime observation — they measure deliberately different things (pure
fixture data vs. fixture data plus whatever real sandbox data happens to be connected at the time).

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
- (Sprint 4.5, DEC-051; extended Sprint 8, DEC-083) PGlite (the embedded, file-backed local dev
  database) has no built-in arbitration for a second OS process opening the same data directory
  concurrently — a standalone script run while the dev server was also running corrupted the file
  irrecoverably. Sprint 8 added a second application (`apps/ritmo`) capable of opening this same
  database, so the rule now explicitly covers never running `apps/web` and `apps/ritmo` dev servers
  concurrently against the same data directory (see `docs/RITMO.md`). No code fix exists for this
  yet, only a documented hard rule (never do that) — a real client-server Postgres for local dev, or
  a "maintenance mode" toggle the app itself enforces, would remove the risk entirely but remains out
  of scope.
- (Sprint 8) `apps/ritmo`'s Assistente screen's "Simulação" card data (the real `simulateExpense`
  tool's output) is only available in the response of the turn that produced it — it is not
  separately persisted, so it does not reappear next to older messages after a page reload. An
  honest consequence of never fabricating a fact not currently in hand, not a bug — see
  `docs/RITMO.md`, "Assistente: real AI chat, not a scripted demo."
- (Sprint 8) `docs/RITMO.md`'s data-model gaps #3 (two Insights mock examples with no engine
  equivalent: week-over-week spending pace, a positive "planned event still fits" confirmation) and
  #6 (Planejamento's "Linha do mês" timeline has almost no real dated facts to show — no `Income`
  pay-date, no confirmed `FixedExpense` due-days for most fixture rows) remain open product gaps, not
  Sprint 8 bugs — closing them requires either a real pay-date/due-date capture flow or a
  positive-confirmation alert type, both deliberately deferred.
- (Sprint 4.5, DEC-050) No UI "Disconnect" button exists yet for `disconnectConnection` — only the
  `DELETE /api/connections?connectionId=...` endpoint. Low-risk, natural follow-up.
- (Sprint 4.5, DEC-053) `GET /api/debug/counts` is gated only by `process.env.NODE_ENV`, since no
  real authentication/authorization layer exists anywhere in the product yet (pre-Founder-approval,
  sandbox-only). This is correct and sufficient for the current local-development-only product, but
  before any real production deployment exists, this route (and any future diagnostic route) must be
  re-evaluated against whatever real auth layer is built then — a `NODE_ENV` check is not itself an
  authorization system.
- (Sprint 6, DEC-073) No live discovery provider exists — the running app uses
  `MockDiscoveryProvider` by default, so the concierge feature currently only ever surfaces
  obviously-synthetic venues in a real (non-test) session. Provisioning a product-owned places/
  local-search API credential and implementing one live `LocalDiscoveryProvider` adapter is required
  before this feature has any real user-facing value — see `docs/CONCIERGE.md`, "Live provider
  status," for the exact infrastructure needed.
- (Sprint 6) `PRICE_LEVEL` price evidence never contributes a numeric cost estimate (no documented
  `$`-to-BRL mapping policy exists) — a venue with only price-level evidence is treated identically to
  one with no price evidence at all. Acceptable for V1 (never inventing a number beats a wrong one),
  but worth a deliberate policy decision once real provider data is available to calibrate against.
- (Sprint 6) No distance/travel-time ranking factor exists — V1 ranks by neighborhood/location-text
  match only. Deliberate (the brief explicitly says not to implement a routing engine unless a live
  provider actually supplies coordinates), but a real gap once live discovery data exists.
- (Sprint 7) No real push/email notification provider exists — `MockNotificationProvider` only; see
  `docs/ALERTS-NOTIFICATIONS.md`, "External notification provider status."
- (Sprint 7) `STALE_CONCIERGE_PLAN`'s relevance-window heuristic stands in for a real plan
  completion/cancellation status that doesn't exist on `SavedConciergePlan` yet — see
  `docs/ALERTS-NOTIFICATIONS.md`, "Known limitations."
- (Sprint 7) No background scheduler exists (by design, matching DEC-031's precedent for sync) — alert
  evaluation runs after every sync and on every homepage load; a future scheduler calling
  `evaluateAlerts`/`syncNotificationsForProfile` directly is purely additive.

## Known bugs

None open at end of Sprint 4.5. Seven found and fixed across Sprints 3-4.5's own live/integration
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
6. (Sprint 4.5) DEC-047's fixture-id fix was incomplete: `reconciliation_links` still grew by one row
   per fresh-process seed run, since those links are computed via the same general-purpose functions
   a real sync uses (fresh id every call, by design) and `seed()` had no content-based dedup guard for
   them the way a real sync already does. Fixed by exporting `reconciliationLinkPairKey` and applying
   the same dedup in `seed()` — see DEC-049.
7. (Sprint 4.5) A real, successfully-persisted Pluggy connection was invisible on the RSC-rendered
   homepage (still showing "DEMO / FIXTURE DATA") even though `GET /api/connections` correctly
   reported it as `CONNECTED` — reproduced twice, live. Root cause: `getDb()` cached its
   DB-initialization promise on a plain module-level variable, which Next.js's Turbopack dev server
   does not treat as one true singleton across its separate RSC/Route-Handler module "layers." Fixed
   by caching on `globalThis` instead — see DEC-052.

## Test status

**645 automated tests passing** in the default suite, zero failing, across nine packages/apps (up
from 599 at end of Sprint 7, 491 at end of Sprint 6), plus the same **7 opt-in live-OpenAI tests**
(unchanged by Sprint 8, still skip automatically without `OPENAI_API_KEY`).

- `apps/ritmo`: **43** (new, Sprint 8) — adapter-only unit tests (no component/DOM tests): Home's
  formatting/due-day/insight-fallback cases, Transações' Hoje/Ontem/Esta-semana grouping and
  `UNCATEGORIZED`-sentinel localization, Planejamento's honest-timeline/never-fabricate-a-percentage
  cases, Insights' evidence-grounded detail sentences and severity→tone mapping, Assistente's
  message-role mapping and inline-markdown bold parsing, and Mais' honest quiet-hours/plan-free
  copy.
- `packages/app-services`: **295** (up from 293) — Sprint 8 adds `getFixedExpensesForProfile`'s and
  `getCategoryRuleCount`'s tests (2 new; everything else unchanged by Sprint 8).
- `packages/persistence`: **38** (up from 37) — Sprint 8 adds `FixedExpense.dueDayOfMonth`'s
  round-trip test (present vs. absent, Safe-to-Spend unaffected beyond the new expense amounts).
- `packages/discovery`: **6** (unchanged).
- `packages/financial-engine`: **196** (up from 171) — `alert-signal.test.ts`'s 25 tests
  (`evaluateSafeToSpendChange`'s relative/absolute/deficit-crossing/no-baseline cases,
  `hasSafeToSpendRecovered`'s hysteresis, `evaluateEventPressure`'s far/comfortable/pressuring/
  unknown-cost/already-started cases, `hasEventPassed`, `evaluateLiquidityCoverageChange`'s
  degrade/unchanged/improve/no-baseline cases, `evaluateConnectionAttention`'s transient/repeated/
  stale/healthy/disconnected cases).
- `packages/ai`: **11** (unchanged).
- `packages/open-finance`: **46** (unchanged).
- `packages/persistence`: **37** (up from 29) — `alert-repository.test.ts`'s 8 tests (alert row
  round-trip; episode identity finds the LATEST row, not just any row; listing; checkpoint upsert is
  one row per profile; notification preferences/deliveries round-trip).
- `apps/web`: **10** (up from 6) — `api/alerts/route.test.ts`'s 4 tests (missing input rejected;
  markAlertSeen/dismissAlert wired correctly; an unknown alert id returns 404, never a raw error).
- `packages/app-services`: **293** (up from 222) — `alerts/alert-service.test.ts`'s 21 tests (material-
  drop create/reuse/dismiss/seen/resolve/rearm, idempotency, recommendation FAILED/VERIFIED, event
  pressure/unknown-cost/passed-resolves, liquidity coverage degrade/unchanged/restore including the
  "permanently-UNKNOWN demo profile never alerts" case, connection health transient/repeated/recovery,
  stale concierge plan create/resolve/outside-window, protected-preference language check),
  `notifications/notification-service.test.ts`'s 12 tests (preferences defaults/update, delivery
  idempotency, category-disabled suppression, dismissed/resolved never delivered, quiet hours never
  suppress IN_APP, GENERIC vs AMOUNT_ALLOWED payload rendering), `discovery-provider-registry.test.ts`'s
  3 tests (production refusal, non-production/test success, test-injected-provider escape hatch),
  `orchestrator-alerts.test.ts`'s 8 tests (read tools never mutate; explicit PT-BR mark-seen/dismiss/
  preference-change mutate exactly once; hypothetical PT-BR dismiss language does not mutate; grounding
  passes on the alert's own evidence and fails on an invented amount; never suggests reducing the
  protected family-support commitment), plus `mutation-guard.test.ts`'s 12 additional Sprint 7 cases
  (including the DEC-082 live-bug regression), `tools.test.ts` updated for the 6 new alert tools, and
  `facts.test.ts`'s 4 Sprint 7 regression tests (getAlerts/getAlertDetails/markAlertSeen/dismissAlert/
  reevaluateAlertContext all expose their evidence amounts via the new declarative `extractFacts`
  mechanism; a non-monetary alert type correctly exposes zero facts) — plus the same 7
  skipped-by-default live tests in `live-openai-smoke.test.ts`.

Run with `pnpm run test` from the repo root (covers `packages/*` and `apps/*`), or per-package with
`--filter`.

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

**Final validated state (APPROVED by the Founder, end of Sprint 4.5)**: the local dev database was
fully wiped and rebuilt from migrations + the (now-fixed) seed after the residual duplicate-fixture-
row state above was found, and one fresh live sandbox Connect was completed against that clean
baseline. The `getDb()` singleton-divergence bug (DEC-052) was found and fixed during this final
round — the connection was persisted correctly on the first attempt every time; the dashboard simply
wasn't showing it until that fix landed. Final, Founder-approved counts, proven stable across three
repeated `POST /api/sync` calls against the single connection (`transactionsCreated: 0` every time,
`errors: []` every time):

| Entity | Count | Notes |
|---|---|---|
| `ProviderConnection` | 1 | `status: CONNECTED`, connector "Pluggy Bank" (sandbox) |
| `PaymentSource` | 3 | audited distinct (DEC-053) — 1 fixture card + 2 real Pluggy accounts |
| `FinancialTransaction` | 47 | stable across all 3 syncs |
| `CreditCardBill` | 2 | stable across all 3 syncs (DEC-048 dedup holds) |
| `InstallmentPlan` | 2 | stable across all 3 syncs |
| `ReconciliationLink` | 30 | stable across all 3 syncs (1 `CONFIRMED`, rest LOW-confidence candidates) |
| Economic consumption total | BRL 7,248.14 | stable across all 3 syncs |

`FinancialPosition.coverage`: `PARTIAL`. Plan Safe-to-Spend and liquidity-aware Safe-to-Spend both
BRL 1,293.01 (see DEC-054 for the full reconciliation against the permanent BRL 2,171.11 fixture
regression). Independent-living comparison: BRL 368.01 (delta -BRL 925.00). Warnings: exactly 3, no
duplicates. Dashboard banner correctly reads "PROVIDER DATA CONNECTED (SANDBOX)" — never presented as
real money. No orphaned data (no delete/disconnect operation occurred in this final round).

No Belvo, no real (non-sandbox) bank connections, no WhatsApp — all correctly out of scope for
Sprint 1–4.5.

**OpenAI: engineering complete, live validation PASSED (final, Sprint 4.5).** A real `OPENAI_API_KEY`
was used throughout Sprint 4.5. `client.models.retrieve("gpt-5.6-terra")` succeeded, confirming the
configured model exists and is reachable with this key (model availability check PASSED). The first
real `generate()` call surfaced a genuine bug (DEC-043, now fixed): OpenAI's strict function-calling
mode rejected the tool schemas because optional arguments were missing from each schema's `required`
array — fixed and confirmed live. PT-BR deterministic hardening (mutation-guard, grounding) is
complete and was tested against `MockAIProvider` first. Actual generation calls then returned
`credit_balance_exhausted` — an organization-level prepaid-credit exhaustion (a DIFFERENT error from,
and never to be conflated with, `project_spend_limit_exceeded`/`organization_spend_limit_exceeded`,
per the Founder's own correction of an earlier, incorrect diagnosis) — and validation was correctly
left blocked rather than retried, per explicit Founder instruction, until the Founder confirmed
billing was fixed.

**Once the Founder confirmed organization prepaid credit was available, validation resumed and
PASSED**: all 7 scenarios in `live-openai-smoke.test.ts` succeeded — basic response; tool call +
the 217,111-cent Safe-to-Spend regression grounded in PT-BR; a specific affordability question
(`simulateExpense`); a vague outing-budget question ("Hoje vou sair com uma garota... talvez motel")
answered via `getSpendingEnvelope` without inventing a dinner/motel price; hypothetical language
correctly recording no transaction; explicit language correctly recording one; and the
independent-living comparison (`getLifestyleComparison`) — confirmed stable across 3 consecutive live
runs (model phrasing varies call to call, so this, not one pass, is what confirms it). **A real bug
was found and fixed along the way (DEC-055), not a hallucination**: 3 of the 7 scenarios initially
failed grounding because `extractFinancialFacts` had never been wired up for several fields
(`DailyGuidance.monthlySafeToSpendRemaining`, `SpendingEnvelope.protectedSavingsStatus.target`) and
two entire tools (`getFinancialSnapshot`, `getLifestyleComparison`) that the model was correctly
citing — the model's answers were correct the whole time; grounding had nothing to check them against.
Fixed with one shared `financialSnapshotFacts` helper covering every salient `FinancialSnapshot` field
at once, plus a permanent offline regression (`facts.test.ts`). No model change, no API key change, no
Financial Engine change, and no Pluggy integration change were made or needed — exactly as instructed.

**Sprint 7 alerts/notifications: live validation PASSED**, run against the SAME real running app, real
OpenAI, and the real, already-persisted Pluggy sandbox connection from earlier sprints (no new
institution connected). Sequence: dashboard loaded with zero alerts (bootstrap correctly suppressed
retroactive noise for a profile with real pre-existing sandbox data) → a real chat interaction
("Gastei R$ 800 hoje com um conserto emergencial do carro.") recorded a manual transaction, dropping
Safe-to-Spend from R$1.293,01 to R$493,01 → the next dashboard load correctly created exactly one
`SAFE_TO_SPEND_MATERIAL_DROP` alert and correctly surfaced a genuinely-stale `STALE_CONCIERGE_PLAN`
alert for a plan saved during an earlier Sprint 6 live session (real historical data) → "Tenho algum
alerta?" listed both correctly → "Por que você está me avisando sobre o Safe-to-Spend?" cited the exact
figures with `groundingStatus: PASSED` → mark-seen and dismiss both succeeded → repeating the dismiss
request correctly found nothing left to act on (idempotent) → two further dashboard reloads produced
zero duplicate alerts → a final Safe-to-Spend check confirmed R$493,01 unchanged by any alert action.
**One real bug was found and fixed live (DEC-082)**: the mark-seen mutation-guard pattern
(`/\bmarc(a|ar|ado|o|ou) como (visto|vista|lido|lida)\b/i`) required "marcar" and "como visto" to be
adjacent, matching only the brief's own bare example — a real message naming which alert
("Pode marcar o alerta do Safe-to-Spend como visto.") was rejected as `MUTATION_NOT_EXPLICIT` even
though intent was unambiguous. Fixed by widening the pattern to allow an object phrase in between,
with permanent regression tests using the exact live-failing phrasing; re-verified live afterward with
`markAlertSeen: SUCCESS`. This is the fourth sprint in a row a mutation-guard gap was found only
through live phrasing rather than offline tests written against the same narrow brief examples (see
DEC-064, DEC-075).

**Sprint 8 Ritmo UI: Founder visual and product validation PASSED.** Each of the six screens was
verified against a pre-captured visual baseline (mobile 412×915 and desktop 1440×900, both light and
dark theme) before its data wiring began, then re-verified after — no unapproved visual difference
was found; the only differences accepted were the pre-approved copy reframings documented in
`docs/RITMO.md`, "Data-model gaps." The Assistente screen's real chat was verified with real, billed
OpenAI calls (kept deliberately few — two, for this sprint), including a real bug found and fixed
live: the model's `**bold**` markdown was rendering as literal asterisks in the plain-`<p>` chat
bubble (no markdown renderer existed) — fixed with a small, targeted inline bold-span parser, never a
general markdown library. `check-client-bundle.mjs` was run clean against a real production build
both before and after the Assistente screen introduced the first real `OPENAI_API_KEY` usage in
`apps/ritmo`. The Founder gave final approval with the real engine connected — Sprint 8 is complete.

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
- (Sprint 4.5, resolved) Both live validations have now passed and both `docs/ROADMAP.md`-relevant
  release gates (Pluggy technical eligibility, OpenAI live validation) are satisfied — nothing further
  blocks Sprint 5 from a validation standpoint. The remaining real-data decision (connecting an actual
  Santander/Nubank account) still requires a SEPARATE, explicit Founder approval per the
  `TRUE_PENDING_FOUNDER_APPROVAL` release gate — that is a product decision, not an engineering one.
- Should old-debt installment match candidates get a lightweight accept/reject affordance before
  Sprint 5's full recommendation lifecycle UI, or wait?

## Next recommended sprint

**Sprint 9 is IN PROGRESS (see the top of this file for full phase status) — currently uncommitted,
Phases 0–5 approved/complete, Phase 6A (staging preparation/plan) code-side complete, Phase 6B (real
deployment) PAUSED (not started) in favor of the Founder Local Live Bank Pilot (DEC-124) — a
Phase-6B-adjacent, entirely local detour, not a Phase 6B substitute.** The Pre-Deploy Command migration
step DEC-115 recommended is implemented and tested under both Node 26 and Node 24 (DEC-117/119/123).
Resend is selected and implemented (DEC-120) — no provider decision remains. `DATABASE_URL`/
`DATABASE_DIRECT_URL` are correctly split (DEC-119); the Pluggy webhook URL derivation is wired in and
now explicitly staging/production-only (DEC-121/124); Node is pinned to `24.x`, the validated LTS line
(DEC-123, superseding DEC-122's Node 26 pin). Remaining Phase 6B work is entirely on the Founder's
side: verify a sending domain in Resend, then provision Neon + Railway directly in their own UIs (never
pasting secrets into chat) following Phase 6A's exact checklist, after which Phase 6B (real staging
deployment and the fresh-DB/upgrade-path/two-user/AI/security validation protocols already written) can
begin.

**Founder Local Live Bank Pilot (DEC-124, code-side complete, no real bank connected yet):** an explicit
`OPEN_FINANCE_MODE` axis (`sandbox` default everywhere; `live` only when `APP_ENV=development` AND
`OPEN_FINANCE_MODE=live` AND `FOUNDER_LIVE_BANK_PILOT=true` are ALL set —
`open-finance-mode.server.ts`) lets the Founder personally pilot Ritmo against their own real bank via
Pluggy Live while the app keeps using local PGlite — no Neon, no Railway, no public webhook, no
deployment. The Connect widget's sandbox/live behavior is now caller-derived (`ConnectWidget`'s
`includeSandbox` prop, previously hardcoded); a new `requestManualSyncHandler`/`requestManualSync`
action reuses the existing `syncConnection` pipeline for on-demand refresh (no webhook can reach
localhost); `resolveWebhookUrl` now explicitly never builds a URL outside staging/production. The Bank
Connection screen shows a dev-only "Banco real — piloto local" indicator and a non-destructive
data-isolation warning when Live mode is active on a profile that already has connections. This
implementation deliberately STOPPED short of connecting any real bank — the Founder enters real Pluggy
credentials into their own `apps/ritmo/.env.local` and performs the first real Connect consent
manually.

Deferred from Sprint 8, still relevant once Sprint 9 reaches Phase 4+: retiring `apps/web` once
`apps/ritmo` parity is validated further, closing the remaining Sprint 8 data-model gaps deliberately
(a real bill due-date/paycheck-date capture flow, a real scheduled daily-digest notification, the two
Insights example categories with no engine equivalent yet), a real push/email notification provider
(currently `NOT_CONFIGURED`), a real discovery-provider credential (Sprint 6's
`LIVE_DISCOVERY_VALIDATION = BLOCKED_BY_EXTERNAL_PROVIDER_CONFIGURATION` is still unresolved), and a
real completion/cancellation status on `SavedConciergePlan` (Sprint 7's `STALE_CONCIERGE_PLAN` alert
currently approximates this with a relevance-window heuristic).

## Risks

Carried forward from Sprint 2 (threshold drift, version currency, reconciliation false negatives —
now validated against real live Pluggy sandbox data as of Sprint 4.5, not just fixtures), plus:

- **(Sprint 4.5, resolved)** Live OpenAI scenario validation is now complete: all 7 PT-BR scenarios
  passed live, confirmed stable across 3 runs. `hasExplicitMutationIntent`'s and
  `groundResponseText`'s behavior against real model prose (not just `MockAIProvider`-scripted text)
  is now verified — the latter's coverage gap (DEC-055) was found and fixed as part of this. Kept here
  only as a pointer for any future session that sees an older reference to this as "unexecuted."
  `AIRequestLog` has now recorded real calls' actual latency/token usage for the first time.
- **(Sprint 4.5) The amount-sign/effect mapping table was exercised against real sandbox data for the
  first time**, and produced plausible-looking results (e.g. `REFUND` for CREDIT-direction credit-card
  entries), but this was not manually cross-checked against Pluggy's own documentation of what each
  specific sandbox fixture transaction is meant to represent — see `docs/OPEN-FINANCE.md`, "Known
  provider limitations." The `CARD_PAYMENT` classification path specifically was not exercised by this
  particular sandbox dataset (it happened not to include a credit-card-bill-payment transaction).
- **(Sprint 4.5) Two-language maintenance burden**: the mutation-guard's pattern list must now be
  kept in sync across English and Portuguese — a behavior change in one language's patterns could
  silently not be mirrored in the other without a deliberate check. **(Sprint 7 update)** Live
  validation found a fourth real pattern-coverage gap in a fourth domain (DEC-082, after DEC-064's
  recommendation language and DEC-075's system-instruction staleness) — every sprint that adds new
  mutation vocabulary should specifically test phrasing that NAMES the object in between the verb and
  any fixed trailing phrase, not just the brief's own bare illustrative examples.
- **(Sprint 4.5, resolved)** The local dev database's pre-DEC-047 duplicate fixture rows were cleared
  by a full `.data` wipe + reseed + fresh sandbox Connect during this sprint's final validation round
  (see "Integration status," "Final validated state") — no longer a live risk, kept here only as a
  pointer for any future session that sees an odd historical reference to "7x duplicate rows."
- **(Sprint 4.5, DEC-053)** `GET /api/debug/counts` is gated on `NODE_ENV` only, since no real
  auth layer exists yet — correct for the current pre-production product, but must be revisited before
  any real production deployment (see "Technical debt").
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
