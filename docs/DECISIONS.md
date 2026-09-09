# Money Copilot — Decision Log

Append-only. When a decision changes, mark the old one `Status: Superseded by DEC-XXX` and add a
new entry — never rewrite history in place.

---

### DEC-001

**Date:** 2026-09-05
**Context:** Sprint 1 needed a monorepo layout that keeps the financial domain logic reusable
outside of any specific app/framework, per the founder's brief.
**Decision:** Use pnpm workspaces with `apps/web` (Next.js App Router) and `packages/financial-engine`
+ `packages/shared`. `financial-engine` has zero framework dependencies.
**Rationale:** The financial core is the product's most valuable and most safety-critical asset. It
must be independently testable and reusable by future non-web surfaces (CLI, API server, LLM
tool-calling layer) without dragging in React/Next/a database.
**Status:** Accepted.
**Consequences:** `apps/web` depends on `packages/financial-engine`; the reverse must never happen.

---

### DEC-002

**Date:** 2026-09-05
**Context:** Money must never use floating-point arithmetic (NON-NEGOTIABLE RULE #3).
**Decision:** `Money` is a branded `{ cents: number }` object. `fromCents` rejects non-integers.
`fromReais(x)` is the only entry point for decimal input and rounds exactly once
(`Math.round(x * 100)`); it exists only for literal constants and user-typed decimal parsing, never
for chaining computed values.
**Rationale:** Integer cent arithmetic is exact under IEEE754 double precision for all realistic
monetary values; floating reais arithmetic is not (e.g. `0.1 + 0.2 !== 0.3`).
**Status:** Accepted.
**Consequences:** Every domain type stores `Money`, never a raw `number` reais value. Tests assert
no floating-point drift (`money.test.ts`).

---

### DEC-003

**Date:** 2026-09-05
**Context:** Rule #4 requires credit cards to be payment sources, not expense categories, to avoid
double counting (e.g. Nubank bill counted once as "Credit Card Expense" and again via its
categorized underlying purchases).
**Decision:** `FinancialTransaction.category` describes what the money was for; `paymentSource`
(a separate `PaymentSource` object with `type: CREDIT_CARD | DEBIT | ...`) describes how it was
paid. The initial fixture explicitly demonstrates this: Nubank → iFood dinner → category "Food".
**Rationale:** Conflating the two causes systematic double counting once real Open Finance
transaction imports arrive (Sprint 3) — the credit card bill total and its underlying purchases
would both appear as "expenses."
**Status:** Accepted.
**Consequences:** The engine never sums `PaymentSource` amounts as expenses. A future recommendation
or reporting feature must group by `category`, not by `paymentSource`, when computing "spend by
category."

---

### DEC-004

**Date:** 2026-09-05
**Context:** Rule #9 requires unknown future budgets (e.g. the beach trip) to never be silently
treated as zero, but also requires no false precision.
**Decision:** Model uncertainty as a `Certainty` enum (`ACTUAL | CONFIRMED | ESTIMATED | UNKNOWN`)
attached to every commitment. When `UNKNOWN`, `amount` is `null` and the item is excluded from
numeric sums but its label is collected into `unknownLabels`, a warning is generated, and snapshot
`confidence` degrades to `LOW`.
**Rationale:** Excluding-and-flagging is more honest than defaulting to zero (which reads as "this
costs nothing") or defaulting to an arbitrary placeholder amount (which reads as false precision).
Making the gap visible via `confidence` + `warnings` satisfies both constraints without inventing a
number that doesn't exist yet.
**Status:** Accepted.
**Consequences:** Any snapshot consumer (the web UI, and later a conversational layer) must surface
`confidence` and `warnings` alongside any monetary total — never present Safe-to-Spend as a bare
number when `confidence !== "HIGH"`.

---

### DEC-005

**Date:** 2026-09-05
**Context:** The three-zone spending model (SAFE / CAUTION / HIGH_IMPACT) needs a boundary between
"acceptable stretch" and "material impact" that is financially meaningful and adjustable.
**Decision:** Classify by `compensationRequired` (how much of the protected savings target would be
eaten by this spend) against a named, overridable `SpendPolicy.cautionCompensationRatio` (default
0.15 = 15% of the savings target), rather than classifying directly off the requested amount vs. the
recommended limit.
**Rationale:** Anchoring to actual goal impact (not just "how far over the recommended number") means
the classification stays meaningful even when the safe-to-spend number itself is small or negative.
Keeping the ratio as an explicit policy parameter (not a hardcoded constant inside the calculation)
lets a future sprint tune or personalize it without touching the snapshot/domain model.
**Status:** Accepted.
**Consequences:** `simulateExpense` takes an optional `SpendPolicy` argument; `DEFAULT_SPEND_POLICY`
is exported for callers that don't need to customize it.

---

### DEC-006

**Date:** 2026-09-05
**Context:** The web app's production build (Next.js 16 / Turbopack) failed with "Module not found"
/ "module has no exports at all" for every relative import in `financial-engine/src/index.ts` and
its subdirectory barrels, even though `tsc` and Vitest resolved the same files without issue.
**Decision:** Removed explicit `.js` extensions from all relative imports/exports within
`packages/financial-engine` and `packages/shared` (e.g. `from "../domain/expense.js"` →
`from "../domain/expense"`).
**Rationale:** `tsc` (with `moduleResolution: "Bundler"`) and Vitest both support the Node-ESM
convention of writing `.js` in a `.ts` source file's relative import and resolving it back to the
`.ts` file. Next.js 16's Turbopack, when consuming these workspace packages as raw TypeScript source
via `transpilePackages` (see DEC-001), did not apply that remapping and failed to resolve every such
import, cascading into "no exports at all" errors for the whole barrel file. Extensionless relative
imports resolve correctly across `tsc`, Vitest, and Turbopack simultaneously.
**Status:** Accepted.
**Consequences:** Contributors must use extensionless relative imports inside `financial-engine` and
`shared`. If a future sprint swaps in a different bundler or ships compiled `.js` output instead of
raw `.ts` source to consumers, re-verify this convention still resolves correctly in all toolchains
before assuming it's still needed.

---

### DEC-007

**Date:** 2026-09-05
**Context:** Sprint 1's stated tech stack (TypeScript, Next.js App Router, pnpm, Vitest) was
specified without pinned versions, and the actual current-day latest stable releases at
implementation time were substantially newer than what might be assumed from older training data
(e.g. TypeScript 7, Next.js 16, React 19, ESLint 10).
**Decision:** Used the latest stable versions available on the npm registry at implementation time,
with one exception: TypeScript was pinned to the latest **6.x** (`6.0.3`), not the newer `7.0.2`,
because `typescript-eslint@8.69.0` (the only version available) explicitly does not yet support
TypeScript 7.
**Rationale:** Favor current, actively-maintained tooling over assumptions from stale training data,
except where a direct compatibility constraint (linting) requires stepping back one major version.
**Status:** Accepted.
**Consequences:** A future sprint should periodically check whether `typescript-eslint` has added
TypeScript 7 support and, if so, evaluate upgrading. Do not assume version numbers mentioned in any
chat history or prior planning documents are still current — check the registry.

---

### DEC-008

**Date:** 2026-09-05
**Context:** Sprint 1's fixture needed a concrete "as of" date to make the rodeo (partially already
paid) and beach trip (Sept 25–27, unknown budget) events temporally coherent within the same month.
**Decision:** Set `FIXTURE_AS_OF_DATE = "2026-09-05"`, matching the real current date at
implementation time, with the rodeo dated the following day (2026-09-06) and the beach trip Sept
25–27, 2026.
**Rationale:** Keeps the fixture's "today" aligned with reality at the time it was built, and keeps
the already-paid-ticket / confirmed-transport / estimated-drinks / unknown-trip-budget scenario
internally consistent (26 days remaining in the month at fixture "today").
**Status:** Partially superseded by DEC-020 (rodeo date corrected to 2026-09-04 in Sprint 2).
**Consequences:** This date is a fixture constant, not derived from `Date.now()` — the engine itself
is date-agnostic and takes `asOfDate` as an explicit input everywhere. A future sprint replacing the
fixture with real user data will supply its own `asOfDate`.

---

## Sprint 2 decisions

### DEC-009

**Date:** 2026-09-05
**Context:** The Sprint 2 brief asked for an "Account / financial container where useful" alongside
`PaymentSource`.
**Decision:** No separate `Account` entity is introduced in Sprint 2. `PaymentSource` (Nubank credit
card, checking account, cash, PIX, etc.) doubles as the container a transaction belongs to.
**Rationale:** Until a real Open Finance provider (Sprint 3) needs to distinguish "the card" from
"the account that pays the card's bill," a second entity would be pure ceremony — every Sprint 2
transaction has exactly one payment source and no need to group multiple payment sources under one
account. Keeps the schema and domain model smaller, consistent with "do not over-engineer
persistence yet" (carried forward from Sprint 1).
**Status:** Accepted.
**Consequences:** `financial_transactions.payment_source_id` is the only "where did this happen"
foreign key. If Sprint 3's provider model needs a real account/card distinction, add an `Account`
table then and backfill — this is an additive change, not a breaking one.

---

### DEC-010

**Date:** 2026-09-05
**Context:** Sprint 1 defined lifestyle-comparison viability as a boolean,
`isIndependentLivingViable = projectedSavings >= 0`, and flagged it in `docs/PROJECT_STATE.md` as an
unconfirmed placeholder. The Sprint 2 brief explicitly asked to replace it with a tri-state read,
without introducing arbitrary income-percentage thresholds.
**Decision:** Replaced the boolean with `LifestyleViability = "UNSUSTAINABLE" | "FRAGILE" |
"SUSTAINABLE"` (`domain/scenario.ts`, `classifyLifestyleViability`): UNSUSTAINABLE when projected
savings go negative; FRAGILE when non-negative but below the configured protected-savings target;
SUSTAINABLE when the target is fully preserved. `LifestyleComparisonResult.isIndependentLivingViable`
no longer exists — replaced by `currentViability`/`independentViability`.
**Rationale:** A boolean collapses "barely scraping by" and "comfortably on track" into the same
"viable" bucket, which is exactly the false precision RULE #17 warns against. The tri-state uses only
the already-configured `FinancialGoal.monthlySavingsTarget` — no new hardcoded percentage.
**Status:** Accepted. Supersedes the Sprint 1 boolean definition.
**Consequences:** Any caller of `compareLifestyles` (currently only `apps/web/app/page.tsx`) must be
updated — done as part of this sprint. No backward-compatibility shim was kept, per project
convention of changing code directly rather than aliasing.

---

### DEC-011

**Date:** 2026-09-05
**Context:** Sprint 1 modeled the founder's existing ~BRL 1,400/month credit-card debt as a flat
`FixedExpense` with `category: "Debt"`. The Sprint 2 brief introduced `InstallmentPlan` and requires
distinguishing debt settlement from fresh consumption, and requires "old debt affects cashflow but
not current category consumption" to be provable.
**Decision:** The old debt is now a single `InstallmentPlan` (`installmentAmount` BRL 1,400,
`certainty: ESTIMATED`, `installmentNumber`/`totalInstallments`: both `null` — the real schedule is
unknown) instead of a `FixedExpense`. `FinancialSnapshot.commitments.debtCommitments` is a new bucket
sourced from active installment plans; `fixed` no longer includes it.
**Rationale:** This is the real fixture's only naturally-incomplete installment schedule — using it
(rather than only a synthetic example) exercises "handle incomplete installment data" against a real
number the founder gave us, per RULE #9/#16/#17.
**Status:** Accepted.
**Consequences:** This reclassification is **revenue-neutral**: `fixed` (738,000 → 598,000 cents) plus
the new `debtCommitments` (140,000 cents) still sum to the original 738,000 — `committedTotal`, and
therefore Safe-to-Spend, is unaffected by this specific change (see DEC-013 for what *did* change the
number). `FixedExpense.category === "Debt"` is no longer a modeled convention; any *future* debt
without an installment structure would still need a home — likely back on `FixedExpense` — but no
such case exists in Sprint 2's data.

---

### DEC-012

**Date:** 2026-09-05
**Context:** The Sprint 2 brief distinguishes the "Financial Plan" (monthly income/commitments) from
"Financial Position / Liquidity" (actual cash/balances), noting a user can have a healthy plan with
low cash, or a large balance that's already committed.
**Decision:** Introduced `FinancialPosition` (`domain/position.ts`): `asOf`, `cashBalance`,
`cardOutstandingBalance`, `otherLiabilities`, each a `CertainAmount`, plus `source`.
`computeLiquidityAwareSafeToSpend(planSafeToSpend, position)` returns the more conservative of the
plan figure and `cashBalance - cardOutstanding - otherLiabilities`, or `null` (never a fabricated
number) when `cashBalance` itself is `UNKNOWN`. `FinancialSnapshot.liquidity` carries this
alongside the existing plan-only `safeToSpend`.
**Rationale:** `min(plan, liquidity)` elegantly covers both failure modes the brief named in one
formula, without a special case for either. Returning `null` rather than falling back to the plan
number keeps RULE #17 intact — an unknown balance must never be presented as if it were a real cash
figure.
**Status:** Accepted.
**Consequences:** The Sprint 2 fixture supplies no `FinancialPosition` (real balances aren't known
yet), so `snapshot.liquidity.liquidityAwareSafeToSpend` is `null` and a warning is always present in
the fixture's output. This is intentional and tested (`domain/position.test.ts`,
`snapshot.test.ts`).

---

### DEC-013

**Date:** 2026-09-05
**Context:** The Sprint 2 brief explicitly required not assuming Sprint 1's reported Safe-to-Spend
(BRL 2,478.90) was correct just because Sprint 1 produced it, and to reconcile it deterministically.
**Decision:** Sprint 1's BRL 2,478.90 was **mathematically correct for Sprint 1's own (narrower)
input** — it is not a bug fix. Sprint 2 adds five newly-known real transactions (Mineiros Dog BRL
26.00, Adega do Rai BRL 55.50, OXXO BRL 40.78, TikTok Shop BRL 173.02, PagSeguro BRL 12.49 — total
BRL 307.79 = 30,779 cents) that Sprint 1 simply didn't have data for, plus the revenue-neutral debt
reclassification in DEC-011. The new figure is **BRL 2,171.11** (217,111 cents) =
247,890 − 30,779. The rodeo ticket transaction (also newly added, BRL 476.10) is reconciled against
the pre-existing rodeo event line item (`domain/reconciliation.ts`,
`reconcileEventLineItems`) and therefore contributes to `actualSpending` exactly once, via the event
— not twice.
**Rationale:** The brief's own instruction: "identify the previous calculation issue, fix it... OR
if correct, document why." This is the "document why, and explain what data changed" case. A
regression test (`snapshot.test.ts`, "Sprint 1 -> Sprint 2 Safe-to-Spend reconciliation") pins the
exact arithmetic (`247_890 - 30_779 === 217_111`) so this number cannot silently drift again without
a visible test failure demanding a new decision entry.
**Status:** Accepted.
**Consequences:** `docs/PROJECT_STATE.md`'s Confirmed User Requirements section is updated to BRL
2,171.11. Any external reference to the old BRL 2,478.90 figure (verbal, prior chat context, etc.)
is now stale and should be corrected against this decision, not treated as ground truth.

---

### DEC-014

**Date:** 2026-09-05
**Context:** The Sprint 2 brief required a `FinancialProfile`/owner concept so future authentication
doesn't require redesigning every table, while explicitly avoiding unnecessary PII and avoiding real
auth in Sprint 2.
**Decision:** `FinancialProfile { id, label, createdAt }` — no email, no personal identifiers. Every
persisted table carries a `financial_profile_id` foreign key. Sprint 2 ships exactly one fixture
profile (`fixtures/profile.ts`, `fixtureProfile`).
**Rationale:** Minimal PII, maximal forward-compatibility: adding real auth later is "point every
future session's queries at the authenticated user's existing profile id" rather than a schema
migration touching every table.
**Status:** Accepted.
**Consequences:** There is no login, no session, no per-user isolation enforced at the database
level yet (a single-profile assumption is baked into `seed.ts` and the web UI) — acceptable for
Sprint 2's single local user, must be revisited before any multi-user deployment.

---

### DEC-015

**Date:** 2026-09-05
**Context:** The Sprint 2 brief listed "TransactionClassification" as a concept to persist alongside
`FinancialTransaction`.
**Decision:** Classification (`financialEffect`, `category`, `subcategory`, `certainty`) is stored as
columns directly on the `financial_transactions` row — no separate classification table or history.
**Rationale:** Sprint 2 has exactly one current classification per transaction and no requirement yet
to track how a classification changed over time (e.g. re-categorized after a rule change). A
separate table with no history requirement would just be an extra join for no benefit.
**Status:** Accepted (documented simplification).
**Consequences:** If a future sprint needs classification *history* (e.g. "this was Food, a rule
change moved it to Food/Fast Food last week"), that's an additive new table — this decision doesn't
block it, it just means Sprint 2 doesn't build it before it's needed.

---

### DEC-016

**Date:** 2026-09-05
**Context:** The Sprint 2 brief listed both `InstallmentPlan` and `Installment` (individual
occurrences) as concepts to persist.
**Decision:** Only the aggregate `InstallmentPlan` is persisted/modeled in Sprint 2. Individual future
`Installment` rows (one row per due date) are not materialized; `summarizeFutureInstallmentCommitments`
derives the 30/90-day projection arithmetically from the plan's amount and known/unknown schedule
instead.
**Rationale:** Per-occurrence rows only pay off once something needs to track individual due dates
independently (e.g. marking installment #4 as paid vs. #5 as still pending, on a schedule with actual
calendar due dates) — Sprint 2's data (including the real old-debt plan) has no known due-date
schedule to materialize in the first place. Building the row-per-installment model now would be
speculative.
**Status:** Accepted (documented simplification, consistent with "do not over-engineer persistence
yet").
**Consequences:** A future sprint that needs to mark a specific installment as paid, or that
receives a real provider schedule with due dates, should add an `installments` child table then —
straightforward additive change, not a redesign of `InstallmentPlan` itself.

---

### DEC-017

**Date:** 2026-09-05
**Context:** Sprint 2 required a persistence layer targeting eventual PostgreSQL/Supabase, with no
hosted credentials required for local dev or automated tests.
**Decision:** `@money-copilot/persistence` uses Drizzle ORM (`drizzle-orm`, `drizzle-kit`) with
PGlite (`@electric-sql/pglite`) — an embedded, WASM-compiled Postgres — as the driver
(`drizzle-orm/pglite`). Migrations are plain versioned SQL files generated by `drizzle-kit generate`
into `packages/persistence/migrations/`, applied via `drizzle-orm/pglite/migrator`. Tests use an
in-memory PGlite instance (`new PGlite("memory://")`); the CLI seed script uses a file-backed one
under `.data/`.
**Rationale:** PGlite speaks real Postgres SQL/wire semantics (so schema and migrations carry over to
hosted Postgres/Supabase later essentially unchanged) while requiring zero network access, zero
Docker, and zero credentials — satisfying the brief's constraint directly. Drizzle is the brief's
own stated preference and keeps the schema as plain, readable TypeScript.
**Status:** Accepted.
**Consequences:** `pnpm --filter @money-copilot/persistence run db:generate` regenerates migrations
after schema changes; `db:seed` runs the idempotent seed against a local file-backed database. When
Sprint 3+ points this at real Postgres/Supabase, only `createDatabase`'s driver wiring should need to
change — the schema, migrations, and repository code are already Postgres-shaped.

---

### DEC-018

**Date:** 2026-09-05
**Context:** The Sprint 2 brief reconfirmed that the 15% CAUTION threshold (DEC-005) is accepted only
as a temporary, configurable `SpendPolicy` default — not a universal financial rule — and that future
personalization may change it.
**Decision:** No change to the mechanism from DEC-005. This entry records the founder/product
reconfirmation explicitly, per the brief's instruction to record it as a new decision rather than
silently leaving it implicit.
**Status:** Accepted (reconfirms DEC-005; does not supersede it).
**Consequences:** None beyond DEC-005's — `DEFAULT_SPEND_POLICY.cautionCompensationRatio` remains
0.15, still swappable per-call via `simulateExpense`'s optional `policy` argument.

---

### DEC-019

**Date:** 2026-09-05
**Context:** Wiring the web UI to read live from `@money-copilot/persistence` (PGlite) was considered,
so the demo UI would prove the full stack (DB → snapshot → page) rather than just the in-memory
fixture.
**Decision:** The web UI continues to render from the in-memory `@money-copilot/financial-engine`
fixture, exactly as in Sprint 1 — it does not read from the database at request time.
**Rationale:** PGlite ships compiled WASM, and `runMigrations` resolves its SQL files via
`import.meta.url`-relative paths — both interact with Next.js/Turbopack's production bundling in
ways that are practically unverifiable without a real deployment target, and a failure there would be
a silent runtime break in exactly the demo screen meant to build confidence. The persistence layer is
already fully proven end-to-end by `packages/persistence/src/persistence.test.ts` (a DB-loaded
snapshot reproduces the exact fixture-based Safe-to-Spend, 217,111 cents, byte-for-byte). The Sprint
2 brief's own UI section says its purpose is "validation and debugging," not final product
integration — that validation is satisfied by the test suite.
**Status:** Accepted.
**Consequences:** `apps/web` has no runtime dependency on `@money-copilot/persistence` or PGlite.
Wiring the live UI to the database is explicitly deferred — flagged in `docs/PROJECT_STATE.md` as a
near-term, well-understood follow-up (likely bundled into Sprint 3 alongside the real provider
integration, which will need a live-data-backed UI anyway).

---

### DEC-020

**Date:** 2026-09-05
**Context:** DEC-008 recorded the rodeo event as dated 2026-09-06. Sprint 2's brief states the rodeo
ticket transaction occurred on 2026-09-04, and the reconciliation logic
(`reconcileEventLineItems`) matches a transaction to an event by date proximity (≤3 days) — the event
and its already-paid transaction should agree on when it happened.
**Decision:** Corrected the rodeo event's `startDate`/`endDate` to `2026-09-04`, matching the actual
transaction date.
**Rationale:** DEC-008's 2026-09-06 was never based on a specific founder-provided fact — Sprint 1
had no separate transaction record to check it against. Sprint 2's real transaction data
(2026-09-04, per the brief) is the authoritative source; keeping the event a day or two off from its
own reconciled transaction would be a needless, easily-avoided inconsistency in the fixture.
**Status:** Accepted. Supersedes the specific date in DEC-008 (which remains correct on every other
point, including *why* 2026-09-05 was chosen as `FIXTURE_AS_OF_DATE`).
**Consequences:** None to the calculated numbers — only the event's date fields changed; all
`Money` amounts are unaffected. Days-remaining-in-month math is keyed off `FIXTURE_AS_OF_DATE`
(2026-09-05), not the event date, so this correction doesn't ripple into `daysRemainingInMonth`.

---

### DEC-021

**Date:** 2026-09-05
**Context:** Manual verification of `pnpm --filter @money-copilot/persistence run db:seed` (the CLI
seed script, run against a file-backed PGlite store) showed the work completing correctly and
quickly — but the Node process did not exit afterward, hanging indefinitely (reproduced: re-running
seed against an already-seeded on-disk store printed "Seed complete" within under a second but the
process itself stayed alive until killed).
**Decision:** The CLI entry point (`seed.ts`, `main()`) now calls `process.exit(process.exitCode ??
0)` explicitly in a `.finally()` after `main()` settles, instead of letting the process exit
naturally.
**Rationale:** PGlite's WASM instance appears to keep at least one handle/timer alive on a
file-backed store even after all queries complete, which prevents Node's event loop from draining on
its own. This only affects the CLI script's own process lifecycle — it has no bearing on
correctness (every automated test uses an in-memory PGlite instance via Vitest's own process
lifecycle and was unaffected) and no bearing on the actual seeded data (verified identical before and
after this fix).
**Status:** Accepted.
**Consequences:** `pnpm db:seed` now exits promptly on both a fresh and an already-seeded store. If a
future sprint sees this recur elsewhere (e.g. a long-running server process using file-backed PGlite
directly), investigate whether PGlite exposes an explicit `.close()`/shutdown API rather than relying
on `process.exit`.

---

## Sprint 3 decisions

### DEC-022

**Date:** 2026-09-05
**Context:** Sprint 3 needs richer account data (balance, credit-card metadata, external provider
identifiers, sync timestamps) than Sprint 2's minimal `PaymentSource { id, label, type }`. DEC-009
had already rejected a separate `Account` entity as unneeded ceremony.
**Decision:** `PaymentSource` is extended in place with optional fields (`subtype`, `provider`,
`externalAccountId`, `connectionId`, `currency`, `balance`, `creditCard`, `certainty`,
`lastSyncedAt`) rather than introducing a parallel `Account` entity. A manually-entered Sprint 1/2
payment source remains valid with none of these set.
**Rationale:** This is additive and backward-compatible (every new field is optional), keeps DEC-009's
reasoning intact (still one entity, not two), and avoids a migration that would need to reconcile two
overlapping concepts. `PaymentSource` genuinely doubles as "the account/financial container" now,
which is exactly what DEC-009 anticipated a real provider would eventually require.
**Status:** Accepted. Extends DEC-009 (does not supersede it — no separate Account entity exists).
**Consequences:** Liquidity/coverage computations (`buildFinancialPositionFromAccounts`) must only
consider payment sources with `provider` set — a manual, non-synced payment source was never
expected to carry balance data and must not depress coverage to `PARTIAL` when zero real accounts are
actually connected (discovered via a failing test during this sprint; see `app-services/queries.ts`,
`resolvePosition`).

---

### DEC-023

**Date:** 2026-09-05
**Context:** Sprint 3 requires avoiding duplicate provider connections for the same real-world
institution Item (RULE: "avoid duplicate provider connections where possible").
**Decision:** `provider_connections` has a database-level unique constraint on
(`financialProfileId`, `provider`, `externalConnectionId`). The application layer additionally checks
via `findProviderConnection` before creating a new row (`completeConnection`), so the common case
never even reaches the constraint — the constraint is the last-resort guarantee, not the primary
mechanism.
**Rationale:** Belt-and-suspenders: the app-level check handles the expected case cheaply and
idempotently; the DB constraint prevents a duplicate even under a race or a future code path that
forgets to check first.
**Status:** Accepted.
**Consequences:** Tested directly (`provider-repositories.test.ts`): a genuine duplicate insert
attempt rejects at the database level.

---

### DEC-024

**Date:** 2026-09-05
**Context:** DEC-019 (Sprint 2) deliberately kept the web UI reading from the in-memory fixture,
citing risk in bundling PGlite/WASM and migration-file path resolution inside Next.js's production
build. Sprint 3 explicitly requires "the web application must no longer depend on the Sprint 1
in-memory fixture for its main financial dashboard."
**Decision:** The dashboard now reads from the database via `@money-copilot/app-services` (an
application/query-service layer — see docs/ARCHITECTURE.md). `next.config.mjs` adds
`@money-copilot/persistence`, `@money-copilot/open-finance`, and `@money-copilot/app-services` to
`transpilePackages`, and marks `@electric-sql/pglite` and `pluggy-sdk` as `serverExternalPackages`
(kept as real `node_modules` at runtime rather than bundled). The homepage additionally sets
`export const dynamic = "force-dynamic"` — without it, Next.js statically prerendered the page at
build time (verified: the built output showed `○` static for `/` before this was added), which would
have frozen the dashboard's DB-backed content as of the build, never reflecting a later sync.
**Rationale:** The risk DEC-019 flagged did not materialize once actually attempted — build and
production-server smoke tests both succeeded (verified via `next build` + `next start` + curl,
including a real GET/POST round trip against `/api/connections`, `/api/token`, and `/api/webhook`).
Sprint 3's real provider integration also needs a live-data UI regardless (per DEC-019's own note that
this was "likely bundled into Sprint 3").
**Status:** Accepted. Supersedes DEC-019.
**Consequences:** `apps/web` now depends on `@money-copilot/persistence`/`@money-copilot/open-finance`
transitively through `@money-copilot/app-services`. Fixtures remain for tests and as the seed source
(`packages/persistence/src/seed.ts` still seeds from the same `@money-copilot/financial-engine`
fixture data) — see docs/PROJECT_STATE.md, "remaining fixture dependencies."

---

### DEC-025

**Date:** 2026-09-05
**Context:** Sprint 3 required choosing and integrating a first real Open Finance provider, while
keeping the financial engine provider-independent (NON-NEGOTIABLE: "Pluggy must not leak into the
financial engine").
**Decision:** Pluggy is the first provider, implemented as `PluggyProvider` in the new
`@money-copilot/open-finance` package, behind an `OpenFinanceProvider` interface
(`createConnectionToken`, `getConnection`, `listAccounts`, `listTransactions`, `listBills`,
`syncConnection`, `deleteConnection`). A `MockProvider` implementing the same interface ships
alongside it — fully deterministic, no network, no credentials — enabling the entire
connect→sync→snapshot pipeline to be exercised in tests and local demos without a real Pluggy
sandbox account. The real Pluggy REST API contract (auth flow, endpoint shapes, pagination, webhook
payloads) was verified against Pluggy's own `pluggy-sdk`/`pluggy-node` SDK source and official
`quickstart` reference implementation (fetched from GitHub), not assumed from prior knowledge.
**Rationale:** The `OpenFinanceProvider` interface is the entire boundary — `financial-engine` only
ever sees the canonical DTOs (`ExternalAccountInput`, `ExternalTransactionInput`, `ExternalBillInput`)
these adapters produce, never a Pluggy response type. Using the official `pluggy-sdk` npm package
(rather than hand-rolling HTTP calls) gets its built-in API-key caching (a ~2h JWT, checked for
expiry before re-authenticating) and cursor-based pagination helper (`fetchAllTransactions`) for free,
reducing the surface area for a mapping mistake.
**Status:** Accepted.
**Consequences:** No live sandbox credentials were available in this environment
(`PLUGGY_CLIENT_ID`/`PLUGGY_CLIENT_SECRET` unset) — `PluggyProvider` is contract-tested against an
injected fake client (`PluggyApiClient`) and sanitized fixture payloads, not a real Pluggy sandbox
call. See docs/PROJECT_STATE.md, "Live sandbox validation status."

---

### DEC-026

**Date:** 2026-09-05
**Context:** Pluggy reports its own `category`/`categoryId` on transactions. NON-NEGOTIABLE (Sprint
3): provider categories must not override the product's deterministic categorization.
**Decision:** The provider's category is preserved as `providerCategory` on the canonical
transaction, entirely separate from our own `category`/`subcategory` fields, which are always
computed by `domain/category.ts`'s deterministic rule engine (see Sprint 2, DEC unchanged).
`providerCategory` is not read by any calculation and not used as an input to categorization in
Sprint 3.
**Rationale:** Keeps a single source of truth for the product's budgeting categories while not
discarding potentially-useful provider evidence for a future sprint (e.g. as a suggested-rule input
to a human reviewing uncategorized transactions).
**Status:** Accepted.
**Consequences:** A future sprint could use `providerCategory` as a suggestion signal when a human is
asked to create a new categorization rule — not implemented in Sprint 3.

---

### DEC-027

**Date:** 2026-09-05
**Context:** Webhook deliveries must be processed idempotently, and must not be trusted as a complete
payload (NON-NEGOTIABLE, Sprint 3).
**Decision:** `webhook_events.id` IS the provider's own `eventId` — claiming an event is a single
`INSERT ... ON CONFLICT DO NOTHING`, and a zero-row result means "already processed," handled without
any additional bookkeeping (`claimWebhookEvent`). Every handled event type re-fetches canonical data
from the provider rather than trusting the webhook body: `transactions/created` triggers a full
date-filtered `syncConnection`; `transactions/updated` triggers a **targeted** re-fetch by external
transaction id (`refetchTransactionsByExternalId`), not the date-filtered sweep.
**Rationale:** The targeted-refetch split for `transactions/updated` was not the original design —
integration testing during this sprint caught that a date-filtered sweep (`since:
lastSuccessfulSyncAt`) silently misses a status change (e.g. PENDING -> POSTED) on a transaction
whose own `date` predates the cutoff, even though the change itself is recent. This matches Pluggy's
own reference implementation, which calls `fetchAllTransactions(accountId, { ids: transactionIds })`
for update events specifically, never a date sweep.
**Status:** Accepted.
**Consequences:** Any future webhook-triggered import must ask "does this event's payload identify
specific ids, or just an account/time window?" and pick the matching re-fetch strategy — never assume
one sweep strategy covers every event type.

---

### DEC-028

**Date:** 2026-09-05
**Context:** Sprint 3 requires FinancialPosition to expose whether the connected accounts represent
*complete* coverage of the user's real liquidity, and must not silently treat a subset of connected
accounts as the whole picture.
**Decision:** `FinancialPosition.coverage: "COMPLETE" | "PARTIAL" | "UNKNOWN"` — COMPLETE only when
every discovered account (of those actually considered) reports a known balance; PARTIAL when some
do and some don't; UNKNOWN when there are no accounts at all. `computeLiquidityAwareSafeToSpend`
downgrades its own confidence to at most `PARTIAL` whenever coverage isn't `COMPLETE`, even if the
arithmetic itself would otherwise look fully resolved. Manually-entered (non-provider) payment
sources are excluded from this calculation entirely (see DEC-022's consequence).
**Rationale:** "Coverage of the accounts we know about" is the only honest claim the system can make
— it cannot know how many total accounts the user has in real life. Excluding manual payment sources
avoids the false signal of "PARTIAL forever" for a profile that has categorization-only payment
sources but zero real connected accounts.
**Status:** Accepted.
**Consequences:** `docs/FINANCIAL-ENGINE.md` and the web UI's liquidity stat now speak of "coverage"
as a distinct concept from certainty.

---

### DEC-029

**Date:** 2026-09-05
**Context:** Pluggy's `transactions/deleted` webhook reports that a transaction the provider
previously reported no longer exists (e.g. it was voided before settling). NON-NEGOTIABLE: "do not
hard-delete financial audit history without thought."
**Decision:** A deleted-by-provider transaction is marked `status: "REVERSED"` (`markTransactionReversed`)
— the row is preserved, never hard-deleted. `buildFinancialSnapshot` already excludes `REVERSED`
transactions from `actualSpending` (a Sprint 2 mechanism, exercised here for the first time by a real
provider event).
**Rationale:** Reuses an existing mechanism rather than inventing a new tombstone state; preserves
audit history; the financial snapshot already stops treating a `REVERSED` transaction as active
consumption with zero new snapshot logic required.
**Status:** Accepted.
**Consequences:** None to existing behavior — this is Sprint 2's `REVERSED` status finally reachable
via a real (simulated) provider event, not a new concept.

---

### DEC-030

**Date:** 2026-09-05
**Context:** NON-NEGOTIABLE (Sprint 3): "do not persist full raw provider payloads by default,"
"redact sensitive provider payload fields from logs," "never log CLIENT_SECRET/API key/Connect
Token/bank credentials."
**Decision:** `ExternalTransactionInput.raw` (an optional field carrying the original provider
payload) exists in the DTO for interactive debugging only — the persistence mapping layer
(`draftTransactionFromExternalInput`, `packages/persistence`) never reads or stores it. Webhook
payloads are summarized to `{event, eventId, itemId?, accountId?, transactionCount?}`
(`summarizeWebhookPayload`) before being written to `webhook_events.payloadSummary` — the full raw
webhook body is never persisted. `getPluggyClient` throws a `ProviderError` mentioning only env
variable *names*, never values, when credentials are missing.
**Rationale:** Directly implements the brief's retention policy without needing a separate
configuration flag — the narrow/sanitized shape is simply the only shape that exists past the
adapter boundary.
**Status:** Accepted.
**Consequences:** If a future sprint needs full raw-payload replay for debugging a mapping bug, it
must add an explicit, clearly-labeled opt-in store — never silently widen `payloadSummary` back into
a full payload dump.

---

### DEC-031

**Date:** 2026-09-05
**Context:** NON-NEGOTIABLE (Sprint 3): "do NOT create an abusive high-frequency polling scheduler,"
but also "the application must also support a manual synchronization command/button so local
development does not depend entirely on webhook delivery."
**Decision:** Sprint 3 ships exactly two sync triggers: webhook-driven (`/api/webhook` ->
`handleWebhookEvent`) and manual (`/api/sync`, a "Refresh / sync" button in the Connected Accounts
UI). No scheduled/polling sync job exists.
**Rationale:** Matches the brief's explicit preference for provider-driven synchronization, while the
manual button covers local development (and any real webhook delivery failure) without introducing a
recurring background job this early. `syncConnection`'s adapter-agnostic design means a future
scheduled-sync sprint can add a cron-style trigger without changing the pipeline itself.
**Status:** Accepted.
**Consequences:** In production, staleness is only resolved by a webhook firing or a human clicking
"Refresh / sync" — no automatic periodic refresh. Acceptable for Sprint 3's sandbox-only scope; revisit
before any real production deployment.

---

### DEC-032

**Date:** 2026-09-05
**Context:** Sprint 3 requires that a provider-derived installment schedule never silently replaces
the founder's manual ~BRL 1,400/month old-debt estimate, "only high-confidence deterministic evidence
may replace the estimate automatically... otherwise flag for human review."
**Decision:** `matchInstallmentPlans` (Sprint 2 code, extended in Sprint 3 usage) NEVER returns
`status: "CONFIRMED"` for an installment-plan match — every match, regardless of confidence (HIGH
requires a shared `paymentSourceId` and amounts within 5%; MEDIUM is amounts within 15% alone), is a
`"CANDIDATE"`. No code path in `@money-copilot/app-services` auto-applies a match (e.g. by marking the
manual plan `COMPLETED`).
**Rationale:** Given no live sandbox data to validate the matching heuristic's real-world precision,
and the brief's explicit conservative instruction, the safest choice for Sprint 3 is: surface every
match as a candidate, apply none automatically. `getInstallmentPlanMatchCandidates` exposes them for
a human (or a future sprint's more confident logic) to act on.
**Status:** Accepted.
**Consequences:** A future sprint that wants automatic replacement for HIGH-confidence matches must
make that an explicit, separate, documented decision — not a change to `matchInstallmentPlans`'s
default behavior.

---

### DEC-033

**Date:** 2026-09-05
**Context:** Live Pluggy sandbox credentials (`PLUGGY_CLIENT_ID`/`PLUGGY_CLIENT_SECRET`) were not
available in this environment.
**Decision:** All Sprint 3 engineering (provider abstraction, Pluggy adapter, mapping/sign logic,
sync pipeline, webhook handling, DB-backed UI) was completed and verified via automated tests
(`MockProvider`, injected fake `PluggyApiClient`, sanitized Pluggy-shaped fixtures) and manual
build/server smoke tests. Live sandbox validation (a real `POST /auth`, `POST /connect_token`, and an
actual Pluggy Connect flow) was NOT executed.
**Rationale:** Per the Sprint 3 brief's own instruction: "If provider credentials are not available:
finish ALL implementation and automated provider-contract tests... Do not incorrectly mark the entire
engineering sprint blocked if only the external live validation requires credentials."
**Status:** Accepted.
**Consequences:** Reported as `ENGINEERING COMPLETE / LIVE SANDBOX VALIDATION PENDING`. The Founder
must supply real Pluggy sandbox credentials (`.env.example` documents the exact variables) for a
follow-up live validation pass — see docs/PROJECT_STATE.md, "Open questions."


---

### DEC-034

**Date:** 2026-09-05
**Context:** Sprint 4 introduces the project's first LLM integration. The brief is explicit that the
LLM must never calculate financial values, and that the app must be able to change AI providers
later without touching business logic.
**Decision:** Introduced `@money-copilot/ai` with a provider-neutral `AIProvider` interface
(`generate(options): Promise<AIGenerateResult>`) operating entirely on plain, vendor-neutral types
(`AITurnItem`, `AIToolDefinition`, `AIGenerateResult`). `OpenAIProvider` is the only file in the
repository permitted to import from the `openai` npm package; `MockAIProvider` is a fully
deterministic, no-network implementation used by every automated test.
**Rationale:** Mirrors the Sprint 3 precedent (`OpenFinanceProvider` isolating Pluggy) — the same
"provider behind an interface, mock for tests, real adapter isolated" shape that has already proven
itself once in this codebase.
**Status:** Accepted.
**Consequences:** A future `AnthropicProvider` (or any other) implements the same interface with zero
changes required in `app-services` or `apps/web`. Code review for AI-touching changes should check
that no new file outside `openai-provider.ts` imports the `openai` SDK.

---

### DEC-035

**Date:** 2026-09-05
**Context:** Sprint 4 requires choosing an initial production AI provider and a default model.
**Decision:** OpenAI is the first `AIProvider` implementation, using the Responses API (not Chat
Completions) via the official `openai` npm package (v7.10.0), with default model `gpt-5.6-terra`
(GPT-5.6 family, mid tier), configurable via the `OPENAI_MODEL` environment variable through a single
`resolveOpenAIModel()` function — no model name string is duplicated anywhere else in the codebase.
**Rationale:** The brief specified OpenAI, the Responses API (confirmed via direct inspection of the
`openai-node` SDK source and README as the actively developed primary interface, function calling and
structured outputs included), and `gpt-5.6-terra` as the default model explicitly.
**Status:** Accepted.
**Consequences:** No auto-escalation to a different model exists yet — a future sprint that wants
that must make it an explicit, separate, documented decision.

---

### DEC-036

**Date:** 2026-09-05
**Context:** The brief requires that Money Copilot, not any AI provider, own conversation history, so
the application can switch providers later without losing continuity or depending on
provider-hosted state.
**Decision:** `Conversation`/`ConversationMessage` are persisted in `packages/persistence`
(`conversations`/`conversation_messages` tables). Every turn reconstructs the FULL prior message
history from these rows into `AITurnItem[]` and sends it to the provider on every call — OpenAI's
`previous_response_id` continuation mechanism is deliberately NOT used as the primary conversation
mechanism.
**Rationale:** A provider-hosted "conversation" would make Money Copilot's chat history contingent on
staying with that one provider forever, and would violate the "app-owned data" pattern already
established for financial data.
**Status:** Accepted.
**Consequences:** Slightly larger request payloads as history grows (mitigated by only sending the
persisted messages for one conversation, never all conversations or all financial data — see
DEC-039). A future sprint may add summarization if a conversation grows very long; not needed yet.

---

### DEC-037

**Date:** 2026-09-05
**Context:** The LLM must never directly query the database or call `financial-engine` internals —
its only capabilities must be explicit, named, and validated.
**Decision:** Introduced a 16-entry tool allowlist (`packages/app-services/src/copilot/tools.ts`),
each with a strict Zod argument schema (converted to JSON Schema via `z.toJSONSchema` for the
provider), a `kind` (`READ` or `MUTATION`), and an `execute()` bound to an existing
`queries.ts`/`mutations.ts` function. `findTool(name)` returns `undefined` for anything not on the
list; the orchestrator records that as a rejected, audited call rather than silently ignoring or
crashing.
**Rationale:** The brief's explicit non-negotiable: "the LLM must never directly query Drizzle/DB
tables or call financial-engine internals arbitrarily — only invoke allowlisted tools."
**Status:** Accepted.
**Consequences:** Adding a new AI capability always means adding a new tool definition with a
schema and an `execute()`, never expanding what the model can do implicitly.

---

### DEC-038

**Date:** 2026-09-05
**Context:** The brief distinguishes READ/SIMULATION tools (safe to execute without confirmation)
from STATE-CHANGING tools (must only execute on the user's own explicit, decided action — never a
hypothetical question).
**Decision:** Implemented `hasExplicitMutationIntent(text)` (`copilot/mutation-guard.ts`) as a
deterministic, regex-based check applied to the ORIGINAL triggering user message, independent of
whether the model itself decided to call a mutation tool. It returns `false` whenever a hypothetical
marker is present ("what if", "could I", "should I", "would I", "how much should", ...) and `true`
only when an explicit-action marker is also present ("I spent", "record", "reserve", "add it",
"confirm", ...) with no hypothetical marker. Ambiguous text (neither pattern) is treated as NOT
explicit.
**Rationale:** Trusting only the LLM's own judgment about intent would make the mutation policy
untestable and non-deterministic — a defense-in-depth, independently verifiable second check was
explicitly requested by the brief.
**Status:** Accepted.
**Consequences:** A small set of English-language keyword patterns will not catch every possible
phrasing of intent (see docs/AI-COPILOT.md, "Known limitations") — biased deliberately toward the
safe failure mode (skip a legitimate action) over the unsafe one (persist an unintended one).

---

### DEC-039

**Date:** 2026-09-05
**Context:** The brief requires data minimization: never send the user's entire transaction history
or entire financial dataset to the LLM by default.
**Decision:** `getRecentSpendingSummary` is explicitly bounded (default 7 days, max 90 — enforced by
its Zod schema). No tool or conversation-history reconstruction step ever sends more than the current
conversation's own persisted messages plus whatever a specific tool call's result returns.
**Rationale:** Matches the brief's explicit instruction and keeps both privacy exposure and token
cost bounded and predictable.
**Status:** Accepted.
**Consequences:** A question requiring a long look-back (e.g. "what did I spend over the last year")
is not yet well served — a future sprint could add a bounded, explicitly-requested longer window if
a real need arises, without changing the default.

---

### DEC-040

**Date:** 2026-09-05
**Context:** The brief requires protection against the LLM stating a financial amount it invented
rather than one produced by a tool.
**Decision:** Implemented `groundResponseText()` (`copilot/grounding.ts`): every BRL-shaped amount
found in the model's draft response text is checked against the set of amounts present in this
turn's deterministic `FinancialFact[]` (extracted per-tool by `extractFinancialFacts`) union any
amount the user themselves typed. Any amount not traceable to either causes grounding to fail, and
the response is replaced by `buildFallbackResponseText()` — a deterministic, template-rendered list
of the facts actually available.
**Rationale:** The brief's explicit instruction, scoped deliberately narrow ("do not over-engineer
general NL verification — protect only important monetary values") rather than building general
natural-language fact verification.
**Status:** Accepted.
**Consequences:** Only BRL currency-shaped figures are checked — a non-monetary factual claim in the
narrative is not verified. This was judged an acceptable, explicitly-scoped limitation.

---

### DEC-041

**Date:** 2026-09-05
**Context:** `REAL_PERSONAL_FINANCIAL_DATA_ALLOWED` was established in prior sprints as the gate on
connecting the Founder's real bank accounts, pending live Pluggy sandbox validation.
**Decision:** This gate remains `false` through Sprint 4. The AI copilot is engineered and tested
exclusively against the seeded fixture / `MockProvider` data — no code path in Sprint 4 connects to
or reads from a real Santander/Nubank account, regardless of the AI layer landing.
**Rationale:** Sprint 4's brief explicitly reconfirms this gate is unrelated to AI engineering
readiness — AI engineering may proceed fully while live bank data remains blocked on a separate,
still-pending validation step (DEC-033).
**Status:** Accepted (reconfirms DEC-033's gate, does not supersede it).
**Consequences:** No behavior change; recorded so a future sprint doesn't mistake AI-layer completion
for permission to connect real accounts.

---

### DEC-042

**Date:** 2026-09-05
**Context:** The brief requires normalized AI error handling and that the deterministic dashboard
keep working even when AI is unavailable or unconfigured.
**Decision:** Defined an `AIErrorCode` taxonomy (`AI_CONFIGURATION_ERROR`,
`AI_AUTHENTICATION_ERROR`, `AI_RATE_LIMITED`, `AI_PROVIDER_UNAVAILABLE`, `AI_TIMEOUT`,
`AI_INVALID_TOOL_ARGUMENTS`, `AI_TOOL_EXECUTION_FAILED`, `AI_GROUNDING_FAILED`, `AI_UNKNOWN_ERROR`)
and mapped OpenAI SDK error classes onto it in `OpenAIProvider`. `/api/chat` returns
`AI_CONFIGURATION_ERROR` (HTTP 503) when `OPENAI_API_KEY` is absent, rather than silently
substituting `MockAIProvider` as an unannounced production fallback. The rest of the dashboard
(`apps/web/app/page.tsx`) has no dependency on the AI layer and is unaffected either way.
**Rationale:** Silently degrading to a mock assistant in production would make it unclear to the
Founder whether AI responses are real; an explicit configuration error is more honest and matches the
brief's "never expose... unnecessary request metadata" while still being clear about the failure.
**Status:** Accepted.
**Consequences:** `MockAIProvider` is understood repo-wide as a test utility only, never a disguised
runtime fallback — a future sprint changing that must make it an explicit, separate decision.


---

### DEC-043

**Date:** 2026-09-06
**Context:** Sprint 4.5's live OpenAI validation immediately surfaced a real, previously-untested
bug: every tool call to the real Responses API failed with `400 invalid_function_parameters` —
"'required' is required to be supplied and to be an array including every key in properties." Plain
Zod `.optional()` fields (used throughout `packages/app-services/src/copilot/tools.ts` for every
optional tool argument) are correctly translated by `z.toJSONSchema()` into a JSON Schema that omits
the optional key from `required` — which is exactly what OpenAI's strict function-calling mode
rejects. `MockAIProvider`-based tests never caught this because they never actually send a tool's
JSON Schema anywhere; only a live call exercises OpenAI's schema validator.
**Decision:** Every optional tool argument was converted from `.optional()` to
`.nullable().default(null)`. This keeps the property listed in `required` (satisfying OpenAI's
validator — the model sends an explicit `null` instead of omitting the key) while `.default(null)`
keeps `schema.parse({})`-style call sites (our own tests, and any future internal caller) working
without needing to pass every field explicitly. Added a permanent, fully offline regression test
(`tool-schema-strict-mode.test.ts`) asserting every tool's generated JSON Schema lists every
`properties` key in `required` — this would have caught the bug without any live API call.
**Rationale:** This is exactly the class of bug live validation exists to catch (see Sprint 4's own
"Live OpenAI validation" pending-item framing) — a real constraint of the actual provider contract
that no amount of `MockAIProvider`-based testing could have exposed, since the mock never serializes
a tool definition through OpenAI's schema validator.
**Status:** Accepted.
**Consequences:** Any future new tool argument must default to `.nullable().default(null)` rather
than `.optional()` — the new regression test enforces this automatically for every tool, present and
future, so this constraint no longer depends on a human remembering it.

---

### DEC-044

**Date:** 2026-09-06
**Context:** Sprint 4.5 explicitly calls for PT-BR (Brazilian Portuguese) conversational hardening —
the Founder and the product's real target users write in Portuguese, not English.
**Decision:** Extended `hasExplicitMutationIntent`/`containsHypotheticalLanguage`
(`mutation-guard.ts`) with a parallel set of Portuguese hypothetical/explicit-action patterns
(discovered during this work: Portuguese frequently drops the subject pronoun — "Poderia
reservar...?" means "Could [I] reserve...?" with no "eu" — patterns were written to match the verb
alone, not "eu poderia"/"poderia eu"). Added an explicit language-matching instruction to the system
prompt (`SYSTEM_INSTRUCTIONS_V2`: "respond in the same language the user writes in"). Confirmed
`groundResponseText`'s currency-amount grounding is already language-agnostic (it only pattern-matches
BRL-shaped numbers, never words) and added PT-BR regression tests proving this explicitly rather than
leaving it merely assumed.
**Rationale:** The brief's explicit Sprint 4.5 scope items 2-4 ("PT-BR conversational validation and
hardening," "PT-BR explicit-vs-hypothetical mutation validation," "financial monetary grounding
validation"). Doing this as deterministic, offline, `MockAIProvider`-based tests (rather than only as
live-model prose, which is non-deterministic) gives permanent regression protection independent of
any specific model's actual phrasing.
**Status:** Accepted.
**Consequences:** The mutation-guard's pattern list now needs to be maintained in two languages going
forward; a future third language would follow the same pattern (a parallel block of regexes, tested
against concrete example sentences, never a general grammatical rule).

---

### DEC-045

**Date:** 2026-09-06
**Context:** Sprint 4.5 attempted live validation of both external providers using the Founder's real
development credentials (OpenAI and Pluggy sandbox), added to `apps/web/.env.local` by the Founder
directly — never pasted into the conversation.
**Decision:** OpenAI live validation is PARTIAL: the configured model (`gpt-5.6-terra`) was confirmed
to exist and be retrievable via `client.models.retrieve`, and the schema bug (DEC-043) was found and
fixed via a live call, but every actual `generate()` call returns `429 credit_balance_exhausted` even
after the Founder added credits and a wait — this was not retried further, no model was changed, and
no new key was created, per explicit instruction. Pluggy live validation is PARTIAL: real
authentication and Connect Token creation both succeeded live (`POST /api/token` → HTTP 200 against
the real Pluggy sandbox API), but the interactive Connect-widget step the Founder reported completing
did not reach this application's `/api/connections` endpoint — the dev server's request log shows no
such call, and `GET /api/connections` still returns an empty list. No account/transaction/bill data
was imported; Sprint 4.5 scope items 6-7 (validating real Pluggy data shapes and sign semantics,
double-counting protection against real data) remain unexecuted.
**Rationale:** Per the brief's own instruction and the precedent set by DEC-033: report exactly, do
not fabricate a validation result, and do not mark engineering blocked when only an external
credential/action is outstanding.
**Status:** Accepted, follow-up (1) below SUPERSEDED by the Founder's own correction — kept here
unedited per project convention (never rewrite history); see the correction note.
**Consequences:** Reported as `ENGINEERING COMPLETE / LIVE OPENAI VALIDATION PARTIAL — BILLING ISSUE
/ LIVE PLUGGY VALIDATION PARTIAL — CONNECT STEP DID NOT PERSIST`. Two concrete follow-ups are owed to
the Founder: (1) check whether the OpenAI project this key belongs to has its own $0 budget/spend
limit independent of the organization's overall credit balance (a common source of this exact error
even with credits present at the org level), and (2) retry the Pluggy Connect widget, keeping it open
until it shows its own success confirmation and closes on its own, rather than closing the tab/window
once sandbox credentials are submitted.

**Correction (2026-09-09, from the Founder directly):** Follow-up (1) above misdiagnoses the error.
`credit_balance_exhausted` is specifically an organization-level PREPAID-CREDIT exhaustion — a
different error from, and never to be conflated with, `project_spend_limit_exceeded` or
`organization_spend_limit_exceeded` (spend-LIMIT errors). The correct, and only, remaining action is
external to this codebase: the Founder/account owner must resolve the organization's prepaid-credit
balance directly with OpenAI. No project-level spend-limit check, model change, or key change is
applicable here. Do not retry live scenario calls until the Founder explicitly confirms billing is
fixed. See `docs/AI-COPILOT.md`, "Live OpenAI smoke test," and `docs/PROJECT_STATE.md`, "Integration
status," both updated to reflect this corrected taxonomy.

---

### DEC-046

**Date:** 2026-09-09
**Context:** Sprint 4.5's live Pluggy validation exposed a real architectural weakness, independently
confirmed by the Founder against OpenAI's public error taxonomy and Pluggy's own documentation: a
real sandbox Connect flow was completed, but the Connect widget's client-side `onSuccess` callback
never reached this application, so no `ProviderConnection` was ever persisted and no data was
imported — even though the Item was successfully created on Pluggy's side. Pluggy's own docs state
`onSuccess` is not guaranteed to fire and that business logic/database integrity must not rely on it
exclusively.
**Decision:** Hardened the connection lifecycle so `onSuccess` is a fast UX path, never the sole
discovery/persistence mechanism:
1. `ExternalConnectionStatus` (the `OpenFinanceProvider` interface) gained an optional
   `clientUserId` field, populated by `PluggyProvider.getConnection` from the real Item's own
   `clientUserId` (which this application always sets to the internal `financialProfileId` at
   Connect Token creation — unchanged from Sprint 3).
2. Added `recoverOrphanedConnection(db, providerName, externalConnectionId)`
   (`packages/app-services/src/sync.ts`): idempotent (checks for an existing connection by
   (provider, externalConnectionId) — profile-agnostic — before doing anything else), validates the
   Item's `clientUserId` against a real, known `FinancialProfile` (`repo.getProfileById`, new) before
   trusting it, and — only once validated — delegates to the SAME `completeConnection` function
   `onSuccess` already calls, so a recovered Item runs through the identical initial-sync pipeline
   rather than a parallel one.
3. The webhook dispatcher (`packages/app-services/src/webhook.ts`) now calls
   `recoverOrphanedConnection` for any `item/*` lifecycle event whose `itemId` has no known
   connection yet, instead of silently dropping the event — making the existing webhook
   infrastructure the authoritative asynchronous discovery path, per the Founder's explicit
   instruction to prefer it over any new polling mechanism.
4. Pluggy's REST API (verified via the full `pluggy-sdk` method list) has no "list Items by
   clientUserId" endpoint, so true proactive polling-based discovery is not possible against the
   documented API — recovery is therefore reactive (triggered by a webhook, or a manually-supplied
   `externalConnectionId`), never a fabricated polling loop. This is documented explicitly in
   `docs/OPEN-FINANCE.md` rather than silently assumed.
**Rationale:** The Founder's explicit instruction, following live validation surfacing the exact
failure mode Pluggy's own documentation warns about. Reusing `completeConnection` rather than writing
parallel recovery-specific import logic keeps exactly one code path responsible for turning a Pluggy
Item into local data, avoiding drift between the two entry points.
**Status:** Accepted.
**Consequences:** In local development (no public `NEXT_PUBLIC_APP_URL`), Pluggy cannot deliver
webhooks to `localhost` at all — this is a genuine constraint of Pluggy's delivery model, not a gap in
`recoverOrphanedConnection` itself, which remains directly callable (e.g. with an `externalConnectionId`
copied from Pluggy's own dashboard) as a manual fallback in that environment. Live Pluggy sandbox
validation remains pending a further sandbox Connect attempt from the Founder — this hardening does
not itself constitute that validation.


---

### DEC-047

**Date:** 2026-09-09
**Context:** A real Sprint 4.5 live Pluggy sandbox Connect completed successfully, but the founder
observed a React warning ("Encountered two children with the same key") on the dashboard, tracing to
the Safe-to-Spend "Beach trip budget is still unknown" warning appearing multiple times. Investigation
found the underlying `FinancialSnapshot.warnings` array genuinely contained the same warning text
multiple times — not just a rendering artifact. Root cause: every fixture entity id in
`packages/financial-engine/src/fixtures/*.ts` (except `FIXTURE_PROFILE_ID`, already a stable literal)
was generated via `createId()`, which embeds `Date.now()` and a per-module counter. `seed()`'s
idempotency is an upsert keyed by id, and its own doc comment claims "every write is an upsert keyed
by the fixture's own stable ids" — but those ids are NOT stable across a fresh evaluation of the
fixtures module, which happens on every dev-server restart, and (confirmed live) separately for
Next.js's RSC vs. Route Handler module "layers" in Turbopack dev mode — each one calls `getDb()` →
`seed()` independently against the SAME persistent file-backed database. Live inspection of the local
dev database found 7 duplicate copies of the Rodeo/Beach-trip events, the old-debt installment plan,
and the manual "Nubank" payment source (49 fixed-expense rows instead of 7) — one set per historical
restart, each with a different random id.
**Decision:** Converted every fixture id to a stable string literal (e.g.
`"financial-event_fixture-beach-trip"`), matching `FIXTURE_PROFILE_ID`'s existing pattern, across
`fixtures/initial-user.ts`, `fixtures/transactions.ts`, and `fixtures/rules.ts`. Added
`stable-ids.test.ts` (financial-engine) and a new persistence test, both using `vi.resetModules()` +
a fresh dynamic `import()` to faithfully reproduce "a separate module registry" within a single test
run — the exact scenario that let this bug through undetected: the pre-existing "idempotent seed"
tests only ever called `seed()` within one already-running process, where the fixtures module's ids
were computed once and reused, masking the cross-instantiation instability entirely.
**Rationale:** `createId()`'s own doc comment already says it is "not cryptographically unique" and
implicitly assumes single-process stability; fixture/seed data specifically needs TRUE cross-process
stability, which only a literal constant provides.
**Status:** Accepted.
**Consequences:** Any future fixture addition must use a stable literal id, never `createId()` — the
new `vi.resetModules()`-based tests catch a regression automatically. The already-corrupted local dev
database (accumulated duplicate rows from before this fix) is not automatically cleaned up by this
decision — a fresh `.data` wipe + reseed (or a future one-time repair script, not implemented here)
is needed to fully clear it; the real Pluggy-imported connection/accounts/transactions are unaffected
(they were already keyed by stable external provider ids, never by `createId()`).

---

### DEC-048

**Date:** 2026-09-09
**Context:** While validating real Pluggy account/transaction/bill shapes against the live sandbox
connection (Sprint 4.5, continuing the pending live validation), inspection of the local database
found each of the two real Pluggy `CreditCardBill` rows duplicated — same `externalBillId`, two
different internal ids — after the same connection was synced more than once (an initial sync plus a
manual `/api/sync` call). Unlike transactions (`findTransactionByExternalId`) and payment sources
(`findPaymentSourceByExternalId`), `billFromExternalInput`'s caller never looked up an existing bill
by `(provider, externalBillId)` before generating a fresh id — every sync therefore created a new
bill row for the same real external bill.
**Decision:** Added `findBillByExternalId` (`packages/persistence`), and gave
`billFromExternalInput` an optional `id` parameter (defaulting to a fresh `createId()`, matching the
existing `paymentSourceFromExternalAccount(input, connectionId, id = createId(...))` pattern) so the
sync pipeline (`packages/app-services/src/sync.ts`) can look up and reuse an existing bill's id —
preserving its original `createdAt` too. Added a regression test (`sync.test.ts`) syncing the same
mock connection twice and asserting exactly one bill row persists with a stable id.
**Rationale:** Matches the established idempotent-upsert pattern already used for every other
provider-sourced entity in this pipeline; `CreditCardBill` was the one entity that had drifted from
it. Never fed into `FinancialSnapshot` math (see `domain/bill.ts`'s own doc comment), so this bug
never caused a financial double-counting error — but it did violate the sync pipeline's general
idempotency guarantee and would have caused unbounded row growth on every sync of a credit card
account.
**Status:** Accepted.
**Consequences:** None beyond the fix — the pattern now matches every other external-entity import in
the pipeline.


---

### DEC-049

**Date:** 2026-09-09
**Context:** Rigorously validating `seed()`'s idempotency across real, separate process invocations
(per the Founder's explicit instruction, going beyond the same-process tests DEC-047 added) found a
SECOND instability the first fix missed: `reconciliation_links` grew by exactly one row on every
fresh-process seed run (1, 3, 4, 5, 6, 7...). Root cause: `fixtures/initial-user.ts`'s
`reconciliationLinks` export is computed by calling `findTransactionDuplicates`/
`reconcileEventLineItems` at fixture-module-evaluation time — and those functions generate a fresh
`id` (`createId("reconciliation-link")`) on every call, BY DESIGN, since a real sync must always be
free to re-propose the same candidate link without caring what id a previous proposal used (real
usage already guards against this via content-based dedup — see below). `seed()` had no equivalent
guard: it just upserted the fixture's freshly-generated links by id every time, creating a new row
per fresh evaluation.
**Decision:** Exported `reconciliationLinkPairKey` (the content-identity function — `type:primary:
linked` — used to detect an equivalent link regardless of its own `id`) from
`packages/financial-engine/src/domain/reconciliation.ts`, replacing an unexported local duplicate
that `app-services/src/sync.ts`'s `reconcileProfile` already had. `seed()` now looks up an existing
link by this content key before upserting, reusing its id when found — mirroring
`reconcileProfile`'s own established pattern exactly, rather than inventing a parallel one. Extended
the `vi.resetModules()` regression test to three resets with explicit per-entity count assertions
(including `reconciliation_links`), since the original two-call version happened not to catch this.
**Rationale:** The general-purpose domain functions are correctly designed for real sync usage (fresh
id + content-based pre-filtering by the caller) — the bug was `seed()` not applying that same
caller-side discipline Sprint 2/3's own `reconcileProfile` already established.
**Status:** Accepted.
**Consequences:** Any future fixture-derived (as opposed to literal-id) collection needs the same
caller-side content-dedup treatment if it's persisted by `seed()` — `reconciliationLinks` was the
only such case as of Sprint 4.5.

---

### DEC-050

**Date:** 2026-09-09
**Context:** A second live Pluggy sandbox Connect attempt (after DEC-046's hardening) actually
succeeded — twice, from two separate widget interactions — leaving two real, independent
`ProviderConnection`s instead of one. No existing application-level function could safely remove one:
`OpenFinanceProvider.deleteConnection` only removes the Item on the provider's own side; nothing
cleaned up the LOCAL rows scoped to a connection. The Founder explicitly required using "the
application's existing deleteConnection/provider lifecycle rather than manually deleting random DB
rows," and to report rather than improvise if proper deletion semantics didn't yet exist.
**Decision:** Implemented `disconnectConnection` (`packages/app-services/src/sync.ts`): best-effort
provider-side deletion (never blocks local cleanup if it fails — the Item may already be gone there),
then removes every LOCAL row scoped to the connection in FK-safe order — reconciliation links
referencing its transactions (on EITHER side, including a cross-connection link where the OTHER side
belongs to a connection being kept, since real Pluggy sandbox data from two connections turned out to
trigger exactly this via `findTransactionDuplicates`'s ordinary recurring-charge matching) →
installment plans referencing its transactions/payment sources → bills → transactions → payment
sources → sync runs → the connection row itself. New repository functions
(`packages/persistence/src/repositories.ts`) do the actual deletes, each a targeted `DELETE ... WHERE`
— never raw/ad-hoc SQL. Exposed via `DELETE /api/connections?connectionId=...`
(`apps/web/app/api/connections/route.ts`), scoped to the current profile's own connections. Added
`connection-deletion.test.ts` (3 tests) proving: a cross-connection reconciliation link is correctly
removed while the kept connection's own data is untouched; a connection with no imported data at all
deletes cleanly; an unknown connection id throws rather than silently no-op-ing.
**Rationale:** The Founder's explicit deterministic tie-break (prefer CONNECTED + successfully synced,
then earliest-created) selected `provider-connection_2` as canonical; this function is what made
discarding the other one safe and complete rather than improvised.
**Status:** Accepted.
**Consequences:** `disconnectConnection` is a real, permanent, general-purpose application capability
now — not a one-off cleanup script. No UI "Disconnect" button exists yet (only the API endpoint); a
natural, low-risk follow-up, not required for this to be correct.

---

### DEC-051

**Date:** 2026-09-09
**Context:** While verifying the post-cleanup and post-3x-sync database state, a standalone
diagnostic script (`createDatabase()` + `runMigrations()` against the same file-backed
`apps/web/.data/money-copilot.pglite` path) was run WHILE the Next.js dev server was ALSO running
against that same file. This is the same category of risk `docs/PROJECT_STATE.md` had already flagged
as a "known limitation" after discovering Next.js gives RSC pages and Route Handlers separate
`getDb()` singleton instances — but this time, a genuinely SEPARATE OS process (not just a separate
in-process singleton) touched the file concurrently. The result was a hard PGlite/WASM
`RuntimeError: Aborted()` on `CREATE SCHEMA IF NOT EXISTS "drizzle"` — and, critically, the corruption
did not self-heal: EVERY subsequent attempt to open that same data directory failed identically, even
after stopping every process, removing the stale `postmaster.pid` lock file (a standard, safe Postgres
recovery step — confirmed safe here since its recorded PID, `-42`, is a PGlite-internal placeholder,
never a real OS process), and retrying from a fresh process. The file was unrecoverable.
**Decision:** Documented, as a hard operational rule for this project: **never run a second
process (standalone script, a second `pnpm` command, etc.) against the same file-backed PGlite data
directory while the Next.js dev server (or any other process) already has it open.** All
database-state verification during live/manual testing must go through the ALREADY-RUNNING
application's own API surface (e.g. `GET /api/connections`, `POST /api/sync`) — never a parallel
`tsx`/`node` script — unless the other process (dev server included) is first confirmed stopped.
Recovered by wiping `.data` and rebuilding from migrations + the (now-fixed, DEC-047/DEC-049) seed —
this reconstructs the canonical fixture baseline byte-for-byte deterministically, but the real
Pluggy-imported connection/accounts/transactions from the live validation session were lost and had
to be re-established via one more live sandbox Connect.
**Rationale:** PGlite is a single embedded WASM Postgres instance per file; unlike a real
client-server Postgres, there is no built-in mechanism here arbitrating concurrent writers/openers
across OS processes, and a failed concurrent open can corrupt the file irrecoverably rather than
simply erroring cleanly. Given this project's data is either deterministic fixture data or
sandbox-only Open Finance data (never real personal financial data, per
`REAL_PERSONAL_FINANCIAL_DATA_ALLOWED`), the cost of this failure mode is inconvenience, not real data
loss — but the rule stands regardless of what the data represents.
**Status:** Accepted.
**Consequences:** Any future diagnostic/administrative script that touches this database must check
(or be told) whether the dev server is running first. A more robust long-term fix (e.g., a real
client-server Postgres for local dev, or a documented safe "maintenance mode" toggle) is not
implemented — out of scope for this sprint, noted as technical debt.

---

### DEC-052

**Date:** 2026-09-09
**Context:** After the DEC-051 rebuild, a real Pluggy sandbox connection was created successfully
(confirmed via server logs: `POST /api/token 200` → `POST /api/connections 200` → `GET / 200`,
repeated twice, zero errors) but the RSC-rendered homepage kept showing "DEMO / FIXTURE DATA — no
institution connected" while `GET /api/connections` correctly reported the connection as
`CONNECTED`. This reproduced twice. The cause: `packages/app-services/src/db.ts`'s `getDb()` cached
its database-initialization promise in a plain module-level `let cachedDb`. Next.js's Turbopack dev
server compiles React Server Components and Route Handlers as separate module "layers"/bundles; each
layer got its OWN evaluation of `db.ts`, hence its own `cachedDb` — the RSC layer's instance had
opened the database before the connection existed and never saw the later write made through the
Route Handler layer's separate instance. `router.refresh()` (`ConnectedAccountsPanel.tsx`) was
confirmed firing correctly every time (a `GET /` request appeared in the server log immediately after
each successful connect) — this was never a client-side caching/refresh problem, purely a server-side
divergent-singleton problem.
**Decision:** Cache the database-initialization promise on `globalThis` instead
(`declare global { var __moneyCopilotDb: Promise<Database> | undefined }`), the same fix commonly used
for the analogous Prisma-Client-in-Next.js-dev-mode singleton problem. `globalThis` is the actual JS
realm global object, shared across module registries within the same Node.js process — unlike a
module-level variable, which is scoped to whichever compiled module instance holds it. `getDb()` and
the test-only `resetDbCache()` now read/write `globalThis.__moneyCopilotDb`.
**Verification (live, post-fix, DEC-053's `GET /api/debug/counts` endpoint plus direct `curl` against
the already-running dev server — no second process touched the database, per DEC-051):** after one
real sandbox Connect, `GET /api/connections` reported exactly 1 connection AND the RSC homepage banner
read "PROVIDER DATA CONNECTED (SANDBOX)" (zero occurrences of "DEMO / FIXTURE DATA") in the same
observation — RSC, Route Handlers, and the `app-services` layer all resolve the same running-process
DB instance. Three repeated `POST /api/sync` calls against that connection produced byte-identical
entity counts across every category (see DEC "Live Pluggy validation" note in `PROJECT_STATE.md`),
confirming the fix does not itself introduce any double-initialization or race.
**Rationale:** This is a real, permanent characteristic of Next.js's dev-mode module bundling, not a
one-off bug — any future module that lazily caches a singleton resource (a DB connection, an SDK
client, etc.) in this codebase must use the same `globalThis` pattern rather than a bare module-level
variable, or it risks silently diverging state across RSC and Route Handler layers again.
**Status:** Accepted.
**Consequences:** The hard rule from DEC-051 (never open the same file-backed PGlite database
concurrently from a second OS process) still stands and is unrelated to this fix — this fix only
solves in-process, cross-module-layer divergence. `globalThis` caching is appropriate for this
project's local development persistence architecture (a single Node.js process running `next dev`);
it is not itself a solution to genuine multi-process/multi-instance deployment, which is out of scope
until a real production persistence layer is chosen.

---

### DEC-053

**Date:** 2026-09-09
**Context:** Verifying DEC-052's fix and the live Pluggy 3x-sync idempotency proof required reading
entity counts (connections, payment sources, transactions, bills, installment plans, reconciliation
links, consumption total) from the running application without opening a second process against the
file-backed PGlite database (forbidden by DEC-051). No such read existed.
**Decision:** Added `getEntityCounts()` (`packages/app-services/src/queries.ts`), composed entirely
from existing repository read functions (no new persistence-layer code), and exposed it at
`GET /api/debug/counts` (`apps/web/app/api/debug/counts/route.ts`). The route returns 404 immediately
whenever `process.env.NODE_ENV === "production"`, BEFORE calling `getDb()` at all — proven by a
regression test (`route.test.ts`) that mocks `@money-copilot/app-services` so `getDb()` throws if
called, then asserts the production branch still returns 404 without that mock ever firing. This is a
plain, anonymously-reachable diagnostic endpoint with no request body and no query parameters, so it
must never be reachable outside local development — the project has no auth layer yet (pre-Founder-
approval sandbox-only product), so a `NODE_ENV` gate (Next.js's own standard convention for dev-only
behavior) is the correct minimal control, not a placeholder for a real authorization check that
doesn't exist yet.
**Payment-source audit (same endpoint, Founder-requested):** the response also includes a
per-`PaymentSource` audit — `type`, `subtype`, and three booleans (`hasProvider`,
`hasDistinctExternalAccountId`, `contributesToLiquidity`, `isCreditCardLiability`) — deliberately
never the raw `externalAccountId`, `label`, `id`, or `connectionId`. Distinctness is evaluated across
the full set (an id is only meaningful evidence against duplication compared to its siblings), and
`contributesToLiquidity` mirrors `resolvePosition`'s own filter (`packages/app-services/src/queries.ts`)
exactly, so the audit can never silently drift from what the engine actually does. Live result for the
3 `PaymentSource`s present after the validated sandbox connection: (1) `CREDIT_CARD`, no provider, not
liquidity-contributing, is-credit-card-liability — the pre-existing manually-entered fixture "Nubank"
card, correctly excluded from liquidity coverage since Sprint 3 (DEC-022's manual-source design); (2)
`DEBIT`/`CHECKING_ACCOUNT`, has provider, distinct external id, liquidity-contributing — the real
Pluggy sandbox checking account; (3) `CREDIT_CARD`/`CREDIT_CARD`, has provider, distinct external id,
liquidity-contributing, is-credit-card-liability — the real Pluggy sandbox credit card.
`allExternalAccountIdsDistinct: true`. All 3 are legitimate, genuinely distinct sources; no duplicate
mapping bug, no fix needed, no re-run of the 3x-sync proof required.
**Rationale:** Reusing one hardened, gated endpoint for both the count proof and the payment-source
audit avoided adding two separate temporary diagnostic surfaces.
**Status:** Accepted.
**Consequences:** `GET /api/debug/counts` remains in the codebase as a permanent, gated, local-dev
diagnostic tool (not deleted after this validation) — any future change to it must preserve the
production 404 gate and the non-sensitive-fields-only contract for the payment-source audit.

---

### DEC-054

**Date:** 2026-09-09
**Context:** The Sprint 1/2 canonical Safe-to-Spend regression (217,111 cents = BRL 2,171.11,
`packages/financial-engine/src/snapshot/snapshot.test.ts`) is computed from `initialUserSnapshotInput`
— deterministic fixture data only. Once a real Pluggy sandbox connection was live-validated, the
SAME homepage now renders a DIFFERENT Safe-to-Spend figure (BRL 1,293.01), because
`getFinancialSnapshot` (`packages/app-services/src/queries.ts`) builds its snapshot from whatever is
actually persisted for the profile — fixture data PLUS every real transaction/bill imported by the
live sandbox sync. Without an explicit record of why, a future session could mistake the runtime
figure for a regression and "fix" the permanent fixture test to match it, destroying the one test that
has protected this exact number since DEC-011/DEC-013.
**Decision:** Both values are permanent and intentionally different; neither ever overwrites the
other:
- **BRL 2,171.11 (217,111 cents)** — the deterministic, fixture-only regression. Protected by
  `snapshot.test.ts`'s existing assertions. Must never change unless the fixture data itself is
  deliberately changed (and if so, per existing project convention, the new number gets the same
  DEC-011/013-style "why this changed" treatment).
- **BRL 1,293.01** — the live, sandbox-connected RUNTIME snapshot, produced only once a real Pluggy
  sandbox connection has synced data into the SAME persisted profile the fixtures also populate. This
  number is expected to change again the next time sandbox data changes; it is not a regression target
  and must never be hard-coded into a `snapshot.test.ts`-style permanent assertion.
**The exact BRL 878.10 (87,810 cents) delta, audited component-by-component** (both snapshots share
the identical `USABLE_INCOME`, `FIXED_COMMITMENTS`, `VARIABLE_BUDGETS`, `FUTURE_CONFIRMED`,
`FUTURE_ESTIMATED`, and `PROTECTED_SAVINGS` components — verified byte-identical between
`snapshot.test.ts`'s fixture-only assertions and the live-rendered breakdown table):
  - `ACTUAL_SPENDING`: fixture-only R$828.89 (82,889 cents) → sandbox-connected R$1,651.09 (165,109
    cents) = **+R$822.20 (82,220 cents)**. The real Pluggy sandbox transactions imported by
    `syncConnection` (Netflix, Spotify, gym, and the rest of the sandbox's canned dataset) are real
    `FinancialTransaction`s with `financialEffect: CONSUMPTION` dated within the current month, so
    `buildFinancialSnapshot` correctly counts them exactly like any other actual spending — this is
    the engine working as designed, not a bug.
  - `DEBT_COMMITMENTS`: fixture-only R$1,400.00 (140,000 cents) → sandbox-connected R$1,455.90
    (145,590 cents) = **+R$55.90 (5,590 cents)**. The live sync imported one additional
    `CreditCardBill`/`InstallmentPlan` from the sandbox connector's own credit-card data (on top of
    the fixture's pre-existing "Existing credit card bill installment" plan), contributing its own
    this-month installment amount.
  - Sum of deltas: 82,220 + 5,590 = **87,810 cents = BRL 878.10**, exactly matching
    217,111 − 129,301 = 87,810. Fully reconciles; no unexplained remainder.
**Rationale:** The Founder's explicit instruction was to identify the exact responsible components,
not merely state "provider data changed it" — this breakdown is what makes the two numbers auditable
and permanently distinguishable from each other going forward.
**Status:** Accepted.
**Consequences:** `docs/PROJECT_STATE.md` must always present both numbers side by side with this
distinction, never just the most recently observed one. Any future live sandbox re-validation session
that produces yet another different runtime figure should extend this same component-level breakdown
methodology rather than silently replacing the number.
