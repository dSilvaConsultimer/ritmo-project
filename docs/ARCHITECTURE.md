# Money Copilot — Architecture

## Repository layout

```
money-copilot/
  apps/
    ritmo/                  TanStack Start — THE PRODUCT UI (Sprint 8, see docs/RITMO.md). Ported
                             visually verbatim from the Founder-approved Lovable prototype; calls
                             app-services only from src/functions/ (server-only), never from a route
                             component or a client hook.
    web/                    Next.js App Router — now internal/debug only (Sprint 8), retired once
                             apps/ritmo reaches full parity. UI + API routes, thin — no direct
                             DB/provider access.
  packages/
    financial-engine/       The priority package: deterministic domain + calculations
    persistence/            Drizzle ORM + PGlite: schema, migrations, seed (Sprint 2)
    open-finance/            Provider abstraction + Pluggy adapter + MockProvider (Sprint 3)
    ai/                      Provider-neutral AIProvider abstraction + OpenAI adapter (Sprint 4)
    app-services/            Application/query service layer + AI tool/orchestration layer (Sprint 3-4)
    shared/                 Generic, non-financial cross-cutting utilities (id generation)
  docs/                     Canonical project memory (read this before every sprint)
```

Package manager: **pnpm workspaces**. Test runner: **Vitest** (every package except `shared`, which
has no logic of its own). Language: **TypeScript**, strict mode, ESM throughout.

## Why this split

`@money-copilot/financial-engine` is deliberately usable **without Next.js, an LLM, Open Finance, a
database, or internet access** — see NON-NEGOTIABLE constraint in `docs/PROJECT_STATE.md`. It has a
single runtime dependency (`@money-copilot/shared`, for a trivial id helper) and no framework
dependency at all. This means:

- It can be unit tested in isolation with no mocking of infrastructure.
- It can be reused by a future CLI, a future API server, a future background job, or a future LLM
  tool-calling layer, without dragging in React/Next.
- Each frontend app's job is reduced to *calling* the engine and *displaying* its output — it must
  never reimplement or duplicate a calculation. **Sprint 8 proved this with a second, independent
  frontend** (`apps/ritmo`, a different framework entirely — TanStack Start, not Next.js): it consumes
  the exact same `@money-copilot/app-services` surface as `apps/web`, with zero financial logic
  duplicated between them — see `docs/RITMO.md`.

`@money-copilot/shared` holds only generic, domain-agnostic utilities (currently: a branded `Id<T>`
type and a monotonic id generator for fixtures/tests). It intentionally does **not** hold financial
domain types — those belong in financial-engine, which is the single source of truth for the domain
model. This keeps the dependency graph one-directional: `{web, ritmo} → app-services → financial-engine
→ shared`.

## The financial-engine package, internally

```
packages/financial-engine/src/
  money/         Money type (integer cents) + safe arithmetic
  domain/        Domain models: Income, FixedExpense, VariableBudget, FinancialTransaction,
                 FinancialEffect, FinancialEvent, FinancialGoal, ProtectedPreference,
                 Recommendation, LifestyleScenario (+ LifestyleViability), Certainty,
                 FinancialProfile, ReconciliationLink, MerchantNormalizationRule, CategoryRule,
                 RecurringExpenseCandidate, InstallmentPlan, FinancialPosition (Sprint 2),
                 AlertPolicy + pure alert classification functions (Sprint 7)
  snapshot/      FinancialSnapshot: the core aggregate calculation (Safe-to-Spend, breakdown, etc.)
  simulation/    simulateExpense() and lifestyle comparison, built on top of a snapshot
  reporting/     Read models over transactions (category totals, uncategorized, etc.) (Sprint 2)
  fixtures/      The initial real-life test user fixture (profile, rules, transactions, etc.)
  index.ts       Public API surface (barrel export)
```

Dependency direction within the package: `money → domain → snapshot → simulation`, with
`reporting` depending only on `money`/`domain` (not `snapshot`), and `fixtures` depending on
everything to assemble the test user. Nothing flows backward — e.g. `domain` never imports from
`snapshot`.

## The persistence package, internally

```
packages/persistence/src/
  schema.ts        Drizzle table definitions (one per persisted domain concept)
  db.ts            createDatabase() — PGlite-backed drizzle client (in-memory or file-backed)
  migrate.ts       Applies versioned SQL migrations from ../migrations/
  mappers.ts       FinancialTransaction <-> row, FixedExpense <-> row, etc. (both directions)
  repositories.ts  Idempotent upserts + loadFinancialSnapshotInput() (DB -> domain reconstruction)
  seed.ts          Idempotent local seed (the founder's fixture data) + CLI entry point
packages/persistence/migrations/   Versioned SQL, generated by `drizzle-kit generate`
```

`@money-copilot/persistence` depends on `@money-copilot/financial-engine` (for domain types) and
`@money-copilot/shared`, but nothing depends on it in the other direction — `financial-engine` has
zero knowledge that persistence exists, preserving its "usable without a database" property (see
below). `loadFinancialSnapshotInput(db, profileId, asOfDate)` is the single function that proves the
roundtrip: it reconstructs a `FinancialSnapshotInput` from persisted rows that, fed through
`buildFinancialSnapshot`, reproduces the exact same Safe-to-Spend as the in-memory fixture — see
`packages/persistence/src/persistence.test.ts` and DEC-013/DEC-017 in `docs/DECISIONS.md`.

Why Drizzle + PGlite: see DEC-017. The web UI now DOES read from it, via `app-services` — see
"Application service layer (Sprint 3)" below and DEC-024 (which supersedes DEC-019).

## The open-finance package, internally (Sprint 3)

```
packages/open-finance/src/
  provider.ts       OpenFinanceProvider interface (provider-neutral — no Pluggy types here)
  mock-provider.ts  MockProvider — deterministic, no network, no credentials
  pluggy/
    client.ts       getPluggyClient() — cached PluggyClient singleton, server-only
    provider.ts     PluggyProvider implements OpenFinanceProvider, wraps pluggy-sdk
    mappers.ts      Pluggy payload -> canonical DTO (account/transaction/bill), incl. sign mapping
    status.ts       Pluggy ItemStatus -> generic ProviderConnectionStatus
    errors.ts       Pluggy SDK errors -> ProviderError taxonomy
    webhook.ts      Webhook payload types + idempotency-key extraction
    fixtures/       Sanitized, synthetic Pluggy-shaped test fixtures
```

Depends on `@money-copilot/financial-engine` (canonical DTOs) and `@money-copilot/shared`; the real
runtime dependency is the official `pluggy-sdk` npm package. **Nothing in `financial-engine` imports
from this package or knows Pluggy exists** — see NON-NEGOTIABLE (Sprint 3): "Pluggy must not leak
into the financial engine." Full account: `docs/OPEN-FINANCE.md`.

## The discovery package, internally (Sprint 6)

```
packages/discovery/src/
  provider.ts       LocalDiscoveryProvider interface, VenueCandidate, PriceEvidence, DiscoverySearchCriteria
  mock-provider.ts  MockDiscoveryProvider — deterministic, no network, obviously-synthetic venue data
```

Mirrors `open-finance`'s exact shape for real-world venue discovery instead of bank data. Depends only
on `@money-copilot/shared`. **Nothing in `financial-engine` imports from this package (or vice versa)
— this is what makes "external search must never determine Safe-to-Spend" an architectural guarantee,
not just a convention** (see DEC-065). No live provider exists yet (no credential configured — see
`docs/CONCIERGE.md`, "Live provider status"); adding one later is purely additive, exactly like
`PluggyProvider` was added alongside `MockProvider`. Full account: `docs/CONCIERGE.md`.

## The alerts/notifications modules, internally (Sprint 7)

```
packages/app-services/src/alerts/
  types.ts            Alert, AlertType, AlertStatus, AlertSeverity, AlertEvidence
  ranking.ts           AlertRankingPolicy + rankAlerts — deterministic dashboard prioritization
  alert-service.ts     evaluateAlerts(), upsertAlertEpisode, markAlertSeen/dismissAlert/reevaluateAlertContext

packages/app-services/src/notifications/
  types.ts            NotificationChannel/Status/Category/Preferences, quiet-hours evaluation
  provider.ts         NotificationProvider interface + MockNotificationProvider
  notification-service.ts   preferences CRUD, deliverAlertNotification, syncNotificationsForProfile
```

`Alert` is an APPLICATION-layer type (like `ConciergeSession`/`OutingPlan`, DEC-068) — its
`relatedEntityType`/`relatedEntityId` can point at a `SavedConciergePlan` (an app-services-only
concept), so it cannot live in `financial-engine`. The PURE classification math it's built on
(`evaluateSafeToSpendChange`, `evaluateEventPressure`, `evaluateLiquidityCoverageChange`,
`evaluateConnectionAttention`, `AlertPolicy`) DOES live in `financial-engine/src/domain/alert-*.ts`,
framework-free like everything else there — `alert-service.ts` assembles these into persisted
episodes, never reimplementing the arithmetic. `NotificationProvider` mirrors
`OpenFinanceProvider`/`LocalDiscoveryProvider`'s exact abstraction pattern; only `MockNotificationProvider`
exists (no real push/email provider is configured). Full account: `docs/ALERTS-NOTIFICATIONS.md`.

## Application service layer (Sprint 3)

```
packages/app-services/src/
  db.ts                       Singleton getDb() — creates/migrates/seeds one PGlite instance per process (globalThis-cached, DEC-052)
  queries.ts                  getFinancialSnapshot, getCategoryTotals, getConnections, getRecommendationsSummary, etc. — plain reads
  sync.ts                     createConnectToken, completeConnection, syncConnection, refetchTransactionsByExternalId
  recommendation-service.ts   evaluateRecommendations, evaluateRecommendationVerifications, accept/modify/rejectRecommendation (Sprint 5)
  discovery-provider-registry.ts  getDiscoveryProvider(name) — resolves "mock" (Sprint 6, mirrors provider-registry.ts)
  concierge/                  ConciergeIntent, OutingPlan, budget-fit-aware plan building/ranking, session persistence (Sprint 6)
  alerts/                     Alert, evaluateAlerts, upsertAlertEpisode, rankAlerts (Sprint 7)
  notifications/               NotificationPreferences/Delivery, deliverAlertNotification, syncNotificationsForProfile (Sprint 7)
  notification-provider-registry.ts  getNotificationProvider(name) — resolves "mock" (Sprint 7, mirrors discovery-provider-registry.ts)
  webhook.ts                  handleWebhookEvent — idempotent webhook dispatch
  provider-registry.ts        getProvider(name) — resolves "pluggy" | "mock" lazily
```

`recommendation-service.ts` is the Open-Finance-independent counterpart to `sync.ts` — it orchestrates
the pure `@money-copilot/financial-engine` recommendation functions (candidate generation, impact,
verification) against persisted state, exactly the same "application service" role `sync.ts` plays
for provider data. `syncConnection` calls into it after every successful import (DEC-060); nothing in
`recommendation-service.ts` imports `@money-copilot/open-finance` or knows about any specific
provider. See `docs/RECOMMENDATIONS.md`.

This is the boundary the Sprint 3 brief calls for: `UI -> application/query service ->
repositories/read models -> financial engine`. `apps/web` never imports `@money-copilot/persistence`
or `@money-copilot/open-finance` directly — only `@money-copilot/app-services`. This package has zero
Next.js dependency, so a future LLM tool layer (Sprint 4) can call the exact same functions
(`getFinancialSnapshot`, `simulateExpense` via `financial-engine`, etc.) without depending on Next.js
page/route components.

## The ai package, internally (Sprint 4)

```
packages/ai/src/
  domain/conversation.ts     Conversation, ConversationMessage, AIToolExecution, AIRequestLog
  provider/types.ts          AIProvider interface, AITurnItem, AIErrorCode, AIError
  provider/mock-provider.ts  MockAIProvider — every automated test uses this, no network
  provider/openai-provider.ts  OpenAIProvider — the ONLY file allowed to import the `openai` SDK
  model-config.ts            DEFAULT_OPENAI_MODEL + resolveOpenAIModel(env)
```

Depends only on `@money-copilot/shared` and the `openai` npm package (isolated to
`openai-provider.ts`). Nothing in `financial-engine` or `app-services`'s query/mutation layer imports
`openai` types directly — only `packages/app-services/src/copilot/*` depends on `@money-copilot/ai`,
and only to call the neutral `AIProvider` interface. Full account: `docs/AI-COPILOT.md`.

## The copilot tool/orchestration layer (Sprint 4)

```
packages/app-services/src/copilot/
  tools.ts                  The allowlist: Zod schemas + execute() bound to queries.ts/mutations.ts;
                             each tool may declare its own `extractFacts` inline (Sprint 7, DEC-081)
  mutation-guard.ts          hasExplicitMutationIntent() — deterministic, independent of LLM judgment
  facts.ts                   Deterministic FinancialFact extraction — checks a tool's own declared
                             `extractFacts` first, falling back to a legacy per-tool switch
  grounding.ts                Hallucination protection for monetary figures in assistant prose
  system-instructions.ts     Version-controlled system prompt
  conversation-service.ts    Persistence wrappers over @money-copilot/persistence
  orchestrator.ts             runCopilotTurn() — the bounded tool-calling loop
```

This is the layer that turns "the engine calculates, AI interprets" from an aspiration (Sprint 1-3)
into an enforced boundary: the model's only capability is calling a named, schema-validated tool that
itself calls a `queries.ts`/`mutations.ts` function, which calls `financial-engine`. No path exists
for the model to reach Drizzle or `financial-engine` internals directly. Full account:
`docs/AI-COPILOT.md`.

## Module resolution note (important for future sprints)

Relative imports inside `financial-engine` and `shared` use **extensionless paths**
(`from "../domain/expense"`, not `from "../domain/expense.js"`). Both packages compile under
`moduleResolution: "Bundler"`. An earlier version of this codebase used explicit `.js` extensions
(the standard Node ESM convention for TypeScript-authored `.ts` sources), which is what `tsc`, and
Vitest, resolve correctly — but Next.js 16's Turbopack, when consuming these packages directly as
TypeScript source via `transpilePackages`, failed to resolve `.js`-suffixed relative imports back to
their `.ts` files ("Module not found"). Extensionless relative imports resolve correctly across all
three toolchains (tsc, Vitest, Turpoback via Next). See DEC-006 in `docs/DECISIONS.md`. If a future
sprint reintroduces a bundler or changes this convention, re-verify all three toolchains.

## How the web app consumes the engine (updated, Sprint 3)

`apps/web/next.config.mjs` declares:

```js
transpilePackages: [
  "@money-copilot/financial-engine",
  "@money-copilot/shared",
  "@money-copilot/persistence",
  "@money-copilot/open-finance",
  "@money-copilot/ai",
  "@money-copilot/app-services",
]
serverExternalPackages: ["@electric-sql/pglite", "pluggy-sdk"]
```

The first list tells Next.js to run these workspace packages' TypeScript source through its own
build pipeline (they ship as source only, no compiled output). The second keeps `@electric-sql/pglite`
(compiled WASM) and `pluggy-sdk` (Node-only HTTP/JWT internals) as real, unbundled `node_modules` at
runtime — bundling either was judged riskier than treating them as external.

`apps/web/app/page.tsx` is an **async React Server Component** that calls `@money-copilot/app-services`
functions (`getFinancialSnapshot`, `getConnections`, etc.) directly at render time — never
`@money-copilot/persistence` or Drizzle directly (see "Application service layer" above). It sets
`export const dynamic = "force-dynamic"` — without this, Next.js statically prerenders the page at
build time (observed directly: the built route showed `○ Static` before this was added), which would
freeze DB-backed content as of the build and never reflect a later sync.

API routes (`apps/web/app/api/*/route.ts`) are the only other server-side surface:
`/api/token` (Connect Token creation), `/api/connections` (list + complete a new connection),
`/api/sync` (manual sync trigger), `/api/webhook` (Pluggy webhook ingestion), and (Sprint 4)
`/api/chat` (send/receive AI copilot messages — the only route that reads `OPENAI_API_KEY` and
constructs an `OpenAIProvider`). Each is a thin wrapper calling one `app-services` function — no
business logic lives in a route handler.

## How the Ritmo app consumes the engine (Sprint 8)

`apps/ritmo` needs no `transpilePackages`-equivalent configuration at all — Vite resolves
workspace-linked TypeScript source (`@money-copilot/app-services`'s `main`/`types` point directly at
raw `src/index.ts`) out of the box, unlike Next.js's Turbopack. This was confirmed as the very first
implementation step (a spike) before any screen was built.

Where `apps/web` calls `app-services` from a React Server Component, `apps/ritmo` calls it from a
TanStack Start `createServerFn()` — same idea (server-only, request-time, direct function call, no
HTTP hop to a second API surface), different framework's mechanism for it. The boundary is stricter
here: only files under `apps/ritmo/src/functions/` may import `@money-copilot/app-services`, enforced
by TanStack Start's native import-protection Vite plugin in dev (any client-context import from a
`server/`-pattern path is a hard build error) and proved at build time by
`apps/ritmo/scripts/check-client-bundle.mjs`, which scans the client-only build output for
`OPENAI_API_KEY`/`PLUGGY_CLIENT_SECRET` and server-only package names. `apps/ritmo/src/adapters/` is
a presentation-only layer between a server function's raw domain data and the (visually unchanged,
Lovable-sourced) route JSX — pure functions, no I/O, no financial calculation. Full detail, including
the profile-resolution seam and every data-model gap this introduced: `docs/RITMO.md`.

Both `apps/web` and `apps/ritmo` are capable of opening the same file-backed PGlite database — see
"Persistence" below and DEC-051/DEC-083 in `docs/DECISIONS.md` for the resulting single-process rule.

## Persistence (Sprint 2, extended Sprint 3)

`@money-copilot/persistence` provides the persistence layer: Drizzle ORM schema + versioned SQL
migrations + an idempotent seed script, running against PGlite (an embedded, WASM-compiled Postgres)
— no hosted database or credentials required for local dev or automated tests. Every persisted table
carries a `financial_profile_id` (see DEC-014) even though there is exactly one local profile and no
authentication yet, so introducing real auth later doesn't require redesigning the schema. Sprint 3
adds `provider_connections`, `sync_runs`, `webhook_events`, and `bills` tables, plus new columns on
`payment_sources`/`financial_positions`/`installment_plans` — all via a second migration
(`migrations/0001_...sql`), verified to apply forward onto an existing Sprint-2-shaped database (see
`packages/persistence/src/migration.test.ts`).

The web app now reads from this database at request time via `@money-copilot/app-services` (DEC-024,
superseding DEC-019's earlier caution) — see "Application service layer" above. **Sprint 8** added a
second app (`apps/ritmo`) that reads/writes the same way — PGlite has no built-in arbitration for two
OS processes opening the same file-backed data directory concurrently (DEC-051), so the hard rule
(never run `apps/web` and `apps/ritmo` dev servers concurrently against the same data directory) now
explicitly covers both apps (DEC-083). Each app's default `MONEY_COPILOT_DB_PATH` resolves relative
to its own `cwd`, so today they write to two different physical files rather than corrupting a shared
one — but never override that variable to point both at one file while both might run at once.

## Enforcing "the engine calculates, AI interprets" in code (Sprint 4)

Every user-facing number (Safe-to-Spend, recommended limit, projected savings, impact classification)
is produced by a pure function in `financial-engine` that takes explicit typed input and returns
explicit typed output. The Sprint 4 AI layer calls these functions (via the `copilot/tools.ts`
allowlist) and templates their output into natural language — it never computes a number itself.
Two independent mechanisms enforce this in practice, not just by convention: (1) the tool allowlist
is the model's ONLY capability — it cannot reach `financial-engine` or Drizzle directly; (2)
`copilot/grounding.ts` checks every monetary figure in the model's draft prose against the
deterministic facts actually computed that turn, and replaces the response with a deterministic
template if the model stated an amount that isn't traceable to a tool result or the user's own input.
Code review for AI-touching changes should specifically check that no arithmetic on `Money` happens
outside `packages/financial-engine`, and that no new tool bypasses Zod validation. Full account:
`docs/AI-COPILOT.md`.

## Production hardening cross-cutting layer (Sprint 9 Phase 5)

`apps/ritmo/src/functions/` gained a small set of framework-agnostic, `.server.ts`-suffixed utility
modules that every other server function/route composes with, rather than each reimplementing its own
version:

- `rate-limit.server.ts` — one policy-driven, in-memory limiter (`checkRateLimit`), used by AI
  (`assistente.server.ts`) and Open Finance action (`connections.server.ts`) protection. Process-local
  by design — no Redis this phase (docs/DECISIONS.md DEC-105).
- `logger.server.ts` — structured JSON logging with automatic secret redaction (by field name AND
  value shape) and a distinct `audit` severity for security/product-sensitive events (DEC-106).
- `security-headers.server.ts` — CSP/clickjacking/MIME-sniffing/HSTS, applied once in `server.ts`'s
  existing response wrapper (DEC-110).
- `health.server.ts` / `preflight.server.ts` — operational readiness and deploy-time config
  validation (DEC-112/113).

None of these live in a shared package (`@money-copilot/app-services` etc.) — they're specific to
`apps/ritmo`'s own request/response lifecycle (TanStack Start's `server.ts` entry, its own routes), not
domain logic `apps/web` would also need. Auth-specific abuse protection is the one exception routed
differently: it uses Better Auth's own built-in rate limiter (`auth.server.ts`'s `rateLimit` option),
not this custom one — see docs/DECISIONS.md DEC-108 for why.
