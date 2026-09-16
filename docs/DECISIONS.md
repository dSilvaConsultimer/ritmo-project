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

---

### DEC-055

**Date:** 2026-09-09
**Context:** The Founder confirmed OpenAI organization prepaid credit was available and asked to
resume the pending live OpenAI PT-BR validation (`live-openai-smoke.test.ts`), adding one more
required scenario ("Hoje vou sair com uma garota... talvez motel. Quanto posso gastar?" — an
outing-budget question specifically chosen to tempt a model into inventing a dinner/motel price).
Running the suite live surfaced 3 of 7 tests failing with `groundingStatus: FAILED`. Debug
instrumentation (temporary, reverted after diagnosis) showed EVERY failure was the same class of bug,
not a hallucination: the model's answer was 100% correct and 100% traceable to real deterministic tool
output, but `packages/app-services/src/copilot/facts.ts`'s `extractFinancialFacts` had never been
wired up to expose several of the fields those tools actually return —
`DailyGuidance.monthlySafeToSpendRemaining` (only `recommendedDiscretionarySpendToday` was extracted),
`SpendingEnvelope.protectedSavingsStatus.target` (only `recommendedAmount`/`cautionAmount` were), and
`getLifestyleComparison`/`getFinancialSnapshot` — TWO tools with NO fact extractor at all, falling
into the `default: return []` case, so grounding had literally nothing to check a rich, entirely
correct model narrative against.
**Decision:** Rather than patch individual fields reactively as different live calls happened to cite
different ones (inherently nondeterministic — a live model's phrasing varies call to call), added one
shared `financialSnapshotFacts(snapshot, sourceTool, labelPrefix)` helper
(`packages/app-services/src/copilot/facts.ts`) that turns every salient monetary field of a
`FinancialSnapshot` (income, all six commitment buckets, protected savings, discretionary cash,
projected savings, Safe-to-Spend total + today's recommendation, all three future-installment
horizons, and liquidity-aware Safe-to-Spend when known) into facts at once. Wired this into a new
`getFinancialSnapshot` case and into `getLifestyleComparison` (called once per scenario, with a
"Current lifestyle: "/"Independent-living: " label prefix, plus the two scenario deltas stored as
absolute magnitude — prose expresses direction in words ("reduces by X"), never with a minus sign).
Also added the two missing fields directly to the `getDailyGuidance` and `getSpendingEnvelope` cases.
Added a permanent offline regression (`facts.test.ts`) asserting each of these tools' real,
deterministic output values appear among the extracted facts — this would have caught the entire gap
without any live API call. Re-ran the full live suite 3 times after the fix: 7/7 passing every time
(model phrasing varies run to run, so 3 clean runs — not 1 — is the actual confirmation of stability,
not luck).
**Rationale:** Grounding's job is to distinguish an invented amount from a real one — a coverage gap
that makes a CORRECT answer look unsupported is the same defect in spirit as a coverage gap that lets
a WRONG one through: either way, the fact set doesn't match what the tool actually computed. Fixing
the `FinancialSnapshot` shape once, comprehensively, closes this for every current and future tool
that returns a full snapshot (or wraps one, as `getLifestyleComparison` does), rather than leaving it
to be rediscovered field-by-field on some future live run.
**Status:** Accepted. **Live OpenAI validation for Sprint 4.5 is now PASSED** — see
`docs/PROJECT_STATE.md`/`docs/AI-COPILOT.md` for the final scenario-by-scenario result. No model
change, no API key change, no Financial Engine change, no Pluggy integration change were made or
needed — exactly as instructed.
**Consequences:** Any NEW tool added in a future sprint that returns (or wraps) a `FinancialSnapshot`
should reuse `financialSnapshotFacts` rather than hand-picking fields, to avoid reintroducing this
exact gap. Tools returning some other rich domain object should still get a dedicated, complete case
rather than a partial one, per this same lesson.

---

### DEC-056

**Date:** 2026-09-09
**Context:** Sprint 5 (Recommendation engine) required actual candidate discovery, evidence,
impact calculation, and a verification lifecycle — none of which existed. Sprint 1 had only modeled
`Recommendation`'s SHAPE (`docs/ROADMAP.md`: "Sprint 1 only defined the data model in
domain/recommendation.ts"), with `estimatedMonthlySavings`/`modifiedMonthlySavings`/`verification`
fields that were never wired to any repository, mapper, or seed code (confirmed by search before
changing anything, per the brief's explicit "do not create a second parallel recommendation model —
extend/refactor the existing one cleanly").
**Decision:** Refactored `packages/financial-engine/src/domain/recommendation.ts` in place (not a new
parallel file) to the full Sprint 5 shape: `type: RecommendationType` (`CANCEL_RECURRING_COST` /
`REDUCE_RECURRING_COST` / `REVIEW_RECURRING_COST` — `REDIRECT_FREED_CASHFLOW` deliberately NOT added,
per the brief's own "do not expand the sprint unnecessarily"), `identityKey` (the deterministic
economic-opportunity identity — see DEC-059), a full `RecommendationEvidence` (merchant, category,
cadence, observed + monthly-equivalent amount, occurrences, transaction ids, payment source,
confidence), `projectedMonthlyImpact`/`projectedAnnualImpact` (replacing the old single
`estimatedMonthlySavings`), an append-only `decisionHistory: RecommendationDecisionEvent[]` (never
overwriting prior states), and a separate `VerificationAssessment` type (`NOT_DUE` / `INCONCLUSIVE` /
`CONFIRMED_SUCCESS` / `CONFIRMED_FAILURE`) kept OUT of `RecommendationStatus` so "we checked and
evidence is insufficient" never corrupts the lifecycle status itself — only `CONFIRMED_SUCCESS`/
`CONFIRMED_FAILURE` ever transition status to VERIFIED/FAILED (see DEC-061/DEC-013's verification
engine). `RecommendationStatus` itself (`PENDING`/`ACCEPTED`/`MODIFIED`/`REJECTED`/`VERIFIED`/
`FAILED`) is UNCHANGED from Sprint 1 — it already matched the brief's target naming exactly.
**Rationale:** Since the old shape was never persisted anywhere in practice (verified empty/unused
before touching it), a clean in-place refactor was safe and preferable to bolting Sprint 5 concepts
onto a shape that never fit them, or maintaining two competing `Recommendation` types.
**Status:** Accepted.
**Consequences:** `domain.test.ts`'s recommendation-lifecycle test was rewritten to the new shape (it
previously constructed the Sprint 1 shape directly). Any earlier documentation referencing
`estimatedMonthlySavings` or a single `RecommendationVerification` object is superseded by this entry.

---

### DEC-057

**Date:** 2026-09-09
**Context:** The Sprint 5 brief's Section 4 ("Protected Preferences") is explicit and non-negotiable:
`ProtectedPreference` must exclude a category from recommendation generation BEFORE any ranking or
presentation, generically — "any future ProtectedPreference receives the same treatment," specifically
naming the Founder's real family-support fixture (`motherSupport`/`motherSupportPreference`,
`packages/financial-engine/src/fixtures/initial-user.ts`) as the concrete case to protect. That
fixture protects a `FixedExpense` (`scope.type === "EXPENSE"`), not a transaction category directly —
but the recommendation engine only ever evaluates `FinancialTransaction`s, which carry a `category`
string, not a link to any `FixedExpense`.
**Decision:** Added `protectedCategories(preferences, fixedExpenses): ReadonlySet<string>`
(`packages/financial-engine/src/domain/preference.ts`) — for each preference, either use its
declared `CATEGORY` directly, or resolve the referenced `FixedExpense`'s own category. The
recommendation engine (DEC-058) excludes any transaction whose category is in this set BEFORE
anything else runs — before recurring-pattern detection, before confidence scoring, before impact
calculation. A live regression test constructs a transaction that WOULD otherwise pass every other
filter (CONSUMPTION effect, categorized, recurring, high confidence) but shares the protected
`FixedExpense`'s category, and asserts zero recommendations are produced — proving category
protection works on its own, not merely incidentally via the separate financial-effect filter.
**Rationale:** A generic, preference-driven mechanism (rather than a hardcoded check for "the mother
support case" specifically) is what makes this correct for ANY future `ProtectedPreference` without
an engine change — exactly the brief's own requirement.
**Status:** Accepted.
**Consequences:** A `ProtectedPreference` scoped to a category with no matching transactions today
still costs nothing (the set is simply not hit) — this mechanism scales to future protected
preferences with no code change, only fixture/user data.

---

### DEC-058

**Date:** 2026-09-09
**Context:** Needed deterministic recommendation candidate discovery (reusing, never duplicating,
Sprint 2's `detectRecurringCandidates`) plus a cadence-aware, non-invented impact calculation — the
brief explicitly warns against multiplying a weekly/yearly charge as if it were monthly, against
inventing a lower "reduced" price, and against scattering magic thresholds through the code.
**Decision:** `packages/financial-engine/src/domain/recommendation-policy.ts` centralizes every
threshold as one `RecommendationPolicy` object with named, documented fields and one
`DEFAULT_RECOMMENDATION_POLICY` (minimum confidence for CANCEL vs. REVIEW, minimum evidence
occurrences, eligible financial effects — CONSUMPTION only — excluded categories, the identity
amount-bucket width, verification grace period, sync-staleness tolerance, reduction amount
tolerance) — explicitly documented as product defaults, not derived financial law.
`recommendation-cadence.ts` classifies an observed interval into `WEEKLY`/`MONTHLY`/`YEARLY`/`UNKNOWN`
(mirroring `recurring.ts`'s own 20-40-day "monthly" bounds rather than inventing a second definition)
and converts to a monthly-equivalent amount ONLY for a recognized cadence — `UNKNOWN` returns `null`,
which `recommendation-generation.ts`'s `generateRecommendationCandidates` treats as "not confident
enough to CANCEL," falling back to `REVIEW_RECURRING_COST` (impact shown, when available, explicitly
framed as informational, never a guaranteed saving). `recommendation-impact.ts`'s
`computeReductionImpact(current, target)` returns `null` — not a zero or negative figure — whenever
`target >= current`, per the brief's explicit "never allow negative savings."
A transaction is eligible evidence only when its `financialEffect === "CONSUMPTION"` (excludes
TRANSFER/CARD_PAYMENT/DEBT_PAYMENT/REFUND/FEE/INCOME by construction, satisfying the brief's exclusion
list without a separate check), it has a non-null category, and that category is in neither
`protectedCategories` (DEC-057) nor the policy's own `excludedCategories` default list (Housing,
Family Support, Insurance, Utilities, Healthcare, Taxes, Debt — a defense-in-depth product default,
never a substitute for actual `ProtectedPreference` evaluation).
**Rationale:** Centralizing every threshold in one named, documented, parameter-passed object (never
a module-level magic constant) is what the brief's Section 23 explicitly requires, and is what makes
this genuinely configurable later without an engine change.
**Status:** Accepted.
**Consequences:** `docs/RECOMMENDATIONS.md` documents every default and its rationale. A future
per-profile policy override only requires threading a different `RecommendationPolicy` value through
existing function parameters — no branching logic needs to change.

---

### DEC-059

**Date:** 2026-09-09
**Context:** Recommendation generation must be idempotent — repeated evaluation over unchanged data
must never create a duplicate row, per the brief's explicit "do not simply use transaction ID because
each monthly transaction may have a new provider transaction ID" and "Open Finance deduplication and
recommendation deduplication are separate concerns. Both must remain idempotent."
**Decision:** `Recommendation.identityKey` (computed once, at generation time, by
`buildRecommendationIdentityKey` — profile + type + normalized merchant + cadence + an
amount-bucketed representative amount + payment source, joined deterministically) is enforced UNIQUE
per `financialProfileId` at the database level
(`packages/persistence/src/schema.ts`'s `recommendations` table, a composite unique constraint —
mirroring DEC-023's `ProviderConnection` uniqueness pattern exactly). The Sprint 1 `recommendations`
table (created in migration 0000, confirmed completely unused — zero repository/mapper/seed code ever
touched it) was replaced via a hand-authored migration (`0003_workable_grim_reaper.sql`, DROP+CREATE
— `drizzle-kit generate`'s interactive rename-disambiguation prompt cannot run non-interactively in
this environment, so the migration SQL and its `meta/0003_snapshot.json`/`_journal.json` entries were
authored directly, verified by running the full migration test suite against a fresh database).
`evaluateRecommendations` (`packages/app-services/src/recommendation-service.ts`) is strictly
ADD-ONLY: for each freshly-generated candidate, `findRecommendationByIdentityKey` decides whether to
insert a new PENDING row or do nothing — an existing row of ANY status (including REJECTED) means
"nothing to do," which is simultaneously what makes generation idempotent AND what implements REJECTED
suppression (DEC-060's "sync integration" note) — no separate suppression mechanism was needed.
**Rationale:** A DB-level uniqueness guarantee (not just an application-level check) is the same
defense-in-depth pattern already established for provider connections — a genuine invariant, not
merely a convention callers must remember to honor.
**Status:** Accepted.
**Consequences:** A future session running `drizzle-kit generate` again should reconcile against the
hand-authored `0003_snapshot.json` — the CLI will treat it as the current baseline correctly, but the
interactive-prompt limitation will recur for any further large `recommendations`-shape change unless
this environment gains TTY support for that command.

---

### DEC-060

**Date:** 2026-09-09
**Context:** Per the brief: "After a successful provider sync, the application should be capable of
evaluating recommendations that are due for verification... Three repeated identical syncs must not
duplicate recommendations, duplicate decision events, duplicate verification records, or repeatedly
transition VERIFIED -> VERIFIED / FAILED -> FAILED."
**Decision:** `syncConnection` (`packages/app-services/src/sync.ts`) calls `evaluateRecommendations`
then `evaluateRecommendationVerifications` immediately after a successful import, wrapped in its own
try/catch so a recommendation-evaluation problem can NEVER fail the sync itself (the imported
financial data is the already-committed, important result). Idempotency for verification specifically
comes from `evaluateRecommendationVerifications` only ever considering recommendations currently
ACCEPTED or MODIFIED — VERIFIED/FAILED are terminal and are never re-selected, so a third identical
sync literally has nothing left to re-evaluate for an already-decided outcome. The same evaluation
also runs on every homepage load (`apps/web/app/page.tsx`) so fixture/demo-mode users (no provider
connection at all) still see recommendations generated from any recurring MANUAL-origin transactions,
not only from synced ones.
**Rationale:** Making sync trigger evaluation automatically (rather than only exposing a capability
some caller might invoke) is what actually satisfies "the application should be capable of" as an
observed behavior, not just unused code.
**Status:** Accepted.
**Consequences:** Every `syncConnection`/homepage-load call now does slightly more work
(recommendation generation + verification pass) — both are simple, bounded, in-process computations
over already-loaded data (no additional network calls), so this was judged an acceptable cost.

---

### DEC-061

**Date:** 2026-09-09
**Context:** While writing the app-services integration tests for verification (accept a
cancellation, advance time, confirm VERIFIED), a test using a stale `lastSuccessfulSyncAt` to prove
`INCONCLUSIVE` unexpectedly produced `CONFIRMED_SUCCESS` instead. Root cause:
`recommendation-verification.ts`'s `daysBetween` helper assumed both inputs were plain `YYYY-MM-DD`
dates and unconditionally appended `T00:00:00Z` — but `ProviderConnection.lastSuccessfulSyncAt` is
always a FULL ISO timestamp already (e.g. `"2026-09-09T18:27:26.329Z"`). Concatenating produced a
malformed string (`"...329ZT00:00:00Z"`), `Date.parse` returned `NaN`, and every comparison against
`NaN` (`daysSinceSync > policy.maxSyncStalenessDaysForVerification`) silently evaluated `false` — the
sync-staleness check became a permanent no-op, meaning a real connection that had NEVER synced
recently would still be treated as fresh evidence.
**Decision:** `daysBetween`'s inputs now go through `toEpochMillis`, which only appends a synthetic
midnight time when the string does NOT already contain a `"T"` (i.e., is a plain date, not a full
timestamp) — both forms are now handled correctly and unambiguously. Added two permanent regression
tests using a real full-ISO-timestamp `lastSuccessfulSyncAt`, one stale (must be `INCONCLUSIVE`) and
one fresh (must reach a real verdict) — this specific bug class (a `NaN` silently defeating a numeric
comparison) would otherwise be very easy to reintroduce.
**Rationale:** This is exactly the kind of defect the brief's own closing instruction anticipates —
found while writing tests for Sprint 5's OWN new code, not inherited from elsewhere — so it is fixed
here with a regression test rather than deferred.
**Status:** Accepted.
**Consequences:** Any future function accepting "either a date or a timestamp" as a string parameter
should use the same `toEpochMillis`-style guard rather than assuming a single format.

---

### DEC-062

**Date:** 2026-09-09
**Context:** The Sprint 4.5 lesson (DEC-055: "a correct tool result that is not exposed to grounding
is still a product bug") applies identically to every new Sprint 5 tool — `getRecommendations`,
`getRecommendationDetails`, and the three decision tools all return real, deterministic monetary
figures (observed amount, monthly-equivalent amount, monthly/annual impact, a MODIFIED user target)
that a live model would naturally cite.
**Decision:** Added `recommendationFacts(recommendation, sourceTool)`
(`packages/app-services/src/copilot/facts.ts`) — one shared helper covering every monetary field a
single `Recommendation` carries — wired into all five new tool cases in `extractFinancialFacts`, plus
three new aggregate facts (potential/accepted/verified monthly savings) for `getRecommendations`.
Added permanent offline tests (`facts.test.ts`) proving every one of these fields is present, before
any live call was made — closing this gap proactively rather than rediscovering it live as happened
in Sprint 4.5.
**Rationale:** Given the exact prior lesson, shipping a new domain's tools without grounding coverage
from day one would have been a known, avoidable repeat of the same defect class.
**Status:** Accepted.
**Consequences:** Any future recommendation-related tool should extend `recommendationFacts` rather
than hand-rolling a new fact list.

---

### DEC-063

**Date:** 2026-09-09
**Context:** Sprint 5's V1 scope example transactions are explicitly Netflix/Spotify-style recurring
subscriptions — and Sprint 4.5's live Pluggy sandbox validation had already imported real
`NETFLIX.COM`/`SPOTIFY AB` recurring charges. Neither had a matching category rule
(`packages/financial-engine/src/fixtures/rules.ts`), so both stayed `UNCATEGORIZED` — which, per the
recommendation engine's own conservative design (DEC-058: never recommend against an
ambiguous/uncategorized transaction), made them silently invisible to the entire feature this sprint
built, despite being its own headline example.
**Decision:** Added merchant-normalization and category rules for `NETFLIX` and `SPOTIFY`
(→ "Entertainment"/"Streaming"), matching the exact real merchant substrings observed live. Added a
permanent regression test (`category.test.ts`) asserting both categorize correctly using the actual
fixture rule set, not just an inline test-only rule.
**Rationale:** Found while building the live-validation Netflix test scenario for this sprint —
without this fix, the sprint's own primary example would have produced zero recommendations against
the exact real data this project already validated live in Sprint 4.5.
**Status:** Accepted.
**Consequences:** Any other recurring discretionary merchant discovered in future live/sandbox
validation should get the same treatment (a rule addition, not a special case in the recommendation
engine itself).

---

### DEC-064

**Date:** 2026-09-09
**Context:** Building the live-validation and offline orchestrator tests for accepting/rejecting a
recommendation in PT-BR (using the brief's own example phrases — "Pode aceitar essa recomendação.",
"Não quero mexer nessa assinatura.") revealed that `hasExplicitMutationIntent`
(`packages/app-services/src/copilot/mutation-guard.ts`) did not recognize EITHER phrase as explicit —
its pattern list was tuned for Sprint 4's financial-transaction phrases ("gastei," "paguei,"
"reserve") and had no concept of a recommendation DECISION at all. Both example acceptance/rejection
tool calls were incorrectly blocked as not-explicit.
**Decision:** Extended both `EXPLICIT_ACTION_PATTERNS` lists (English and Portuguese, maintaining the
established DEC-044 two-language parity convention) with recommendation-decision language: "pode
aceitar," "aceito," "quero aceitar," "quero cancelar," "quero reduzir," "não quero," "rejeito" (PT-BR)
and "accept it," "i accept," "go ahead," "i don't want this/it," "reject it/this," "i reject"
(English). Verified none of these collide with any existing `HYPOTHETICAL_PATTERNS` entry (e.g. "não
quero" does not match "poderia"/"deveria"/"e se eu"/"seria possível"). Added permanent offline test
cases (`mutation-guard.test.ts`) for both the new explicit phrases and confirmed the brief's own
hypothetical counter-example ("E se eu cancelasse essa assinatura?") still correctly returns `false`
via the pre-existing "e se eu" pattern.
**Rationale:** A brand-new domain's decision vocabulary (accept/modify/reject a recommendation) is
not automatically covered by patterns written for a different domain's vocabulary (recording an
expense) — this is a real, found-during-implementation gap, not a hypothetical one, exactly like
DEC-063.
**Status:** Accepted.
**Consequences:** Any future AI-tool domain with its own natural "decision" vocabulary should audit
`mutation-guard.ts`'s pattern coverage specifically for that vocabulary rather than assuming the
existing patterns generalize.

---

### DEC-065

**Date:** 2026-09-09
**Context:** Sprint 6 (Concierge) combines two fundamentally different systems — the deterministic
financial engine and an external real-world discovery provider. The brief is explicit and
non-negotiable: "external search must NEVER determine Safe-to-Spend," and the mandated order is
FINANCIAL ENVELOPE → USER INTENT → DISCOVERY REQUIREMENTS → REAL-WORLD SEARCH → ... , never reversed.
**Decision:** Every concierge entry point (`getConciergeBudget`, `searchConciergePlaces`,
`buildConciergePlansForProfile` — `packages/app-services/src/concierge/concierge-service.ts`) calls
`getSpendingEnvelopeForProfile` (Sprint 4, unchanged) BEFORE any discovery-provider call, and derives
the discovery search ceiling (`deriveSearchCeiling`) FROM that envelope — never the reverse. This is
enforced architecturally, not just by convention: `@money-copilot/discovery` has zero dependency on
`@money-copilot/financial-engine` (and vice versa), so a discovery provider's response literally
cannot contain a `Money`/`SpendingEnvelope` value to begin with — it can only ever influence which
VENUES are shown, never what the user can safely spend. Regression-tested directly
(`concierge-service.test.ts`, "(A)": the search ceiling passed to the provider is asserted to be
exactly the envelope's own caution ceiling; "(B)": a provider returning an absurd/adversarial price
is proven to leave `getSafeToSpend`'s own output completely unchanged).
**Rationale:** A financial safety guarantee enforced only by "always call this function first" is a
convention that can be forgotten; enforcing it via the TYPE SYSTEM (discovery types structurally
cannot represent financial data) is a much stronger guarantee, matching the same architectural
principle already used for Open Finance (`financial-engine` has zero dependency on
`open-finance`/Pluggy) and the AI layer (financial-engine has zero dependency on `@money-copilot/ai`).
**Status:** Accepted.
**Consequences:** Any future discovery-provider integration (a live adapter) inherits this guarantee
automatically — it cannot introduce a financial-truth bypass without literally adding a
`financial-engine` dependency to the `discovery` package, which would be an obvious, reviewable red
flag.

---

### DEC-066

**Date:** 2026-09-09
**Context:** The brief requires a deterministic "does this cost fit the budget" classifier
(`evaluateBudgetFit`) with FIVE states (`WITHIN_RECOMMENDED`/`WITHIN_CAUTION`/`HIGH_IMPACT`/
`EXCEEDS_LIMIT`/`UNKNOWN_COST`), while explicitly warning against "creating conflicting financial-zone
semantics" — and the financial engine already has a three-state `SpendStatus` model
(`SAFE`/`CAUTION`/`HIGH_IMPACT`, `packages/financial-engine/src/simulation/expense-simulation.ts`)
computed from a `SpendingEnvelope`'s `recommendedAmount`/`cautionAmount` boundaries.
**Decision:** `evaluateBudgetFit` (`packages/financial-engine/src/simulation/budget-fit.ts`) reuses
`SpendingEnvelope`'s EXACT SAME two boundaries — no new threshold, no second definition of
"recommended" or "caution." `EXCEEDS_LIMIT` is a genuinely distinct concept, not a fourth financial-
engine zone: it fires ONLY when an amount exceeds the USER'S OWN explicit stated ceiling
(`userCeiling`), and — critically — a generous user ceiling can never loosen a `HIGH_IMPACT`
classification into something safer (`classifyAmount` checks `userCeiling` as an ADDITIONAL, stricter
constraint only, never a replacement for the engine's own boundaries). For a cost RANGE, both bounds
are classified separately (`minZone`/`maxZone`) with the overall `zone` always the more conservative
(worse) of the two — a range whose lower bound fits but whose upper bound doesn't is never presented
as simply "safe."
**Rationale:** Reusing the exact same two numbers `SpendStatus` already uses is what actually
satisfies "avoid creating conflicting financial-zone semantics" — a fourth boundary would have meant
the concierge and the existing spend-simulation flow could disagree about what "caution" means for
the identical financial state.
**Status:** Accepted.
**Consequences:** If `SpendPolicy`'s `cautionCompensationRatio` (or any future policy change) shifts
`SpendingEnvelope`'s boundaries, `evaluateBudgetFit`'s classification shifts identically and
automatically — no concierge-specific policy to keep in sync.

---

### DEC-067

**Date:** 2026-09-09
**Context:** Sprint 6 needs a provider-neutral abstraction for real-world venue discovery, following
"the same architectural principle used for Open Finance and AI providers" — plus a structured
representation of price evidence, since "real-world prices are imperfect" and must never be treated as
uniformly exact.
**Decision:** New package `@money-copilot/discovery`, mirroring `@money-copilot/open-finance`'s exact
shape: a `LocalDiscoveryProvider` interface (`searchPlaces`/`getPlaceDetails`), a deterministic
`MockDiscoveryProvider` (obviously-synthetic venue names, e.g. "Generic Bistro" — never a real
business, mirroring Pluggy sandbox data's own labeling discipline), and `discovery-provider-registry.ts`
(`packages/app-services`) mirroring `provider-registry.ts` exactly. `PriceEvidence` supports six
provenance-tagged shapes (`EXACT`/`RANGE`/`STARTING_AT`/`PRICE_LEVEL`/`ESTIMATED`/`UNKNOWN`) plus
`basis` (`PER_PERSON`/`TOTAL`/`UNKNOWN_BASIS`), `source`, `observedAt`, and `confidence` — never a bare
number. `PRICE_LEVEL` (a "$".."$$$$" indicator) deliberately NEVER converts to a BRL amount in V1 — no
documented, centralized mapping policy exists, so `plan-builder.ts`'s `venueCostRangeCents`
explicitly skips it rather than guessing (see DEC-066's sibling concern about never inventing a
number). No live provider was implemented — see the "Live provider status" DEC-073 below.
**Rationale:** The exact same reasoning that justified `OpenFinanceProvider`/`AIProvider` applies here
verbatim: swappable external infrastructure must never leak into the deterministic core, and a mock
implementation must exist so the whole system is testable and demoable without any live credential.
**Status:** Accepted.
**Consequences:** Adding a real live provider later (once credentials exist) is purely additive — one
new adapter class + one new registry branch, no changes anywhere else, exactly like `PluggyProvider`
was added alongside `MockProvider` without touching `financial-engine` or `app-services`'s other
callers.

---

### DEC-068

**Date:** 2026-09-09
**Context:** `ConciergeSession`/`OutingPlan`/`SavedConciergePlan` need to be persisted, but they are
APPLICATION-layer types (`packages/app-services/src/concierge/types.ts`) — unlike every other
persisted entity in this codebase, they are not `financial-engine` domain types, because they
reference discovery-domain concepts (`VenueCandidate`, `ActivityType` from `@money-copilot/discovery`)
that `financial-engine` must never depend on (DEC-065). `packages/persistence` depends on
`financial-engine` but must NEVER depend on `app-services` (the dependency runs the other way) — so
persistence cannot import these types the way `mappers.ts` imports `Recommendation`/`SyncRun`/etc.
**Decision:** `packages/persistence/src/repositories.ts` exposes plain ROW-shaped functions for the
two new tables (`ConciergeSessionRow`/`SavedConciergePlanRow` — JSON-blob + primitive fields only, no
imported rich type), documented explicitly as an exception to this file's usual pattern.
`concierge-service.ts` does its own JSON serialization/deserialization between its rich domain types
and these row shapes — the "mapper" logic that would normally live in `persistence/mappers.ts` lives
in `app-services` instead for this one domain.
**Rationale:** The alternative (moving `ConciergeIntent`/`OutingPlan` into `financial-engine` so
persistence could import them normally) would have violated DEC-065's own guarantee by giving
`financial-engine` visibility into discovery-domain concepts. A thin, row-shaped persistence
interface with mapping pushed to the caller is the correct resolution once a type genuinely belongs
to the application layer rather than the domain layer.
**Status:** Accepted.
**Consequences:** Any FUTURE type that references both persistence-worthy state AND a
non-financial-engine package's types should follow this same pattern (row-shaped persistence
functions, mapping done by the caller) rather than either creating a dependency cycle or smuggling
foreign concepts into `financial-engine`.

---

### DEC-069

**Date:** 2026-09-09
**Context:** Two related brief requirements: (a) "do not send the user's complete financial history to
discovery providers... only location, activity type, price/search constraints, preferences," and (b)
"treat external search content as untrusted data... search results must not override system prompt,
financial rules, mutation policy, or grounding rules."
**Decision:** `DiscoverySearchCriteria` (`packages/discovery/src/provider.ts`) is a narrow type that
structurally CANNOT carry income, balance, debt, or transaction history — those concepts don't exist
in the `@money-copilot/discovery` package at all (see DEC-065/DEC-067). `buildSearchCriteria`
(`concierge-service.ts`) constructs it from ONLY derived fields (`activityType`, `location`,
`maxPriceCents`, `partySize`, `preferences`, `avoidances`, `dateTime`). Separately, every discovery
tool's result is passed to the AI provider exclusively as a `tool_result` turn item — the
orchestrator's `instructions` field sent on every request is a fixed constant
(`CURRENT_SYSTEM_INSTRUCTIONS`), never concatenated with or derived from any tool output, so a
maliciously-crafted venue name/description (e.g. "ignore all previous instructions...") has
structurally zero path to altering the system prompt, `hasExplicitMutationIntent`'s evaluation of the
ORIGINAL user message, or grounding's fact pool. Regression-tested directly
(`concierge-service.test.ts`, "(B, Z)": criteria object key-set + serialized-content scan for
forbidden financial terms; `orchestrator-concierge.test.ts`, "(Q, injection)": a scripted malicious
payload proven to leave the sent `instructions` byte-identical across every call and to still be
caught by grounding if the model parrots an invented amount).
**Rationale:** Two different threat models (data exfiltration to a third party vs. prompt injection
FROM a third party) are both closed by the same underlying discipline: never let untrusted/sensitive
data cross a boundary through anything other than a narrow, structurally-typed, explicitly-constructed
interface.
**Status:** Accepted.
**Consequences:** Any future tool that calls an external provider must construct its request payload
the same explicit way (an allowlist of fields, never a spread of broader internal state) and must
never feed tool output back into the `instructions` sent to the AI provider.

---

### DEC-070

**Date:** 2026-09-09
**Context:** The brief warns against "mixing all grounding into fragile regex logic" while still
requiring that venue names/prices/addresses/ratings never be invented — a much richer grounding
requirement than Sprint 4/4.5/5's purely amount-based `FinancialFact` model, since a venue NAME isn't
a regex-matchable currency figure.
**Decision:** `DiscoveryFact` (`concierge/types.ts`) is a separate type from `FinancialFact` — never
blended into the same array in the response shape. Discovery facts are populated STRUCTURALLY, by the
orchestrator itself, directly from each discovery tool's actual result (`copilot/discovery-facts.ts`'s
`extractDiscoveryFacts`) — the LLM never writes to this list, so every name/rating/address entry is
grounded BY CONSTRUCTION, with no text-pattern verification needed at all for non-monetary facts. For
the one sub-case that IS a currency figure (a venue's price), `discoveryFactsAsGroundingFacts` converts
price evidence into the SAME amount-checking pool `groundResponseText` already uses for
`FinancialFact`s — merged into the grounding CHECK only, never into the client-facing `financialFacts`
array, so the two concepts stay separate in the response shape while sharing one proven mechanism for
the one sub-case where regex-based amount extraction is actually appropriate.
**Rationale:** Attempting a generic NER-style verifier for "is this venue name/address/rating actually
mentioned accurately in the prose" would have been exactly the "fragile regex logic" the brief warns
against, and would have violated the established "do not over-engineer general NL verification"
principle from Sprint 4. Grounding-by-construction (never writing unverified content into the fact
list in the first place) sidesteps the need for such a verifier entirely.
**Status:** Accepted.
**Consequences:** Any future non-monetary "must not be invented" fact type (in this domain or a
future one) should follow the same pattern — extract it structurally from tool output, never verify
free text against it after the fact.

---

### DEC-071

**Date:** 2026-09-09
**Context:** The brief requires: multi-part plans (required + optional components) with deterministic
combination arithmetic; optional components never silently inflating a "base" cost figure; and a hard
separation between selecting/saving a plan and actually spending money (no `FinancialTransaction` on
save; an explicit "separa R$X" reservation must reuse the existing `FinancialEvent` mechanism, never a
new parallel one).
**Decision:** `buildConciergePlans` (`plan-builder.ts`) builds the deterministic power-set over
`optionalComponents` (bounded and small — one optional component means exactly 2 plans). Each
resulting `OutingPlan` carries BOTH `baseCostRangeCents`/`baseBudgetFit` (required components only)
and `totalCostRangeCents`/`totalBudgetFit` (required + this specific optional combination) as
separate fields — the UI/AI can always distinguish "R$150 base" from "R$270 with optional lodging"
rather than presenting the inflated figure as unavoidable. `sumCostRangesCents` returns `null` (not
zero) the moment ANY included component's price is unknown — a plan with an unpriced optional
component never gets classified as if it were free. `saveConciergePlan` writes only to
`saved_concierge_plans` (a `SELECTED` status marker), never to `financial_transactions`.
`reservePlanBudget` calls the EXISTING `createPlannedFinancialEvent` (Sprint 1/4) directly — no
concierge-specific reservation table or logic exists.
**Rationale:** Reusing `FinancialEvent` for budget reservations (rather than inventing a parallel
"concierge reservation" concept) keeps exactly one mechanism for "money set aside for something
planned" across the whole product, matching the brief's own explicit instruction.
**Status:** Accepted.
**Consequences:** Any future "set money aside for X" feature (concierge-related or not) should also
reuse `createPlannedFinancialEvent` rather than creating another parallel mechanism.

---

### DEC-072

**Date:** 2026-09-09
**Context:** The brief requires deterministic, inspectable venue/plan ranking where "budget fit should
dominate" — a highly-rated option that exceeds the user's envelope must not outrank an equally
suitable option that safely fits, unless the user explicitly asks for higher-impact alternatives —
while explicitly forbidding "one opaque AI score" and "scattered arbitrary weights."
**Decision:** `ConciergeRankingPolicy` (`ranking.ts`) centralizes four named, documented weights
(`budgetFitWeight`, `preferenceMatchWeight`, `ratingWeight`, `priceConfidenceWeight`) with
`budgetFitWeight` set an order of magnitude higher than the others by default — `rankVenueCandidates`
returns each candidate's full factor breakdown alongside the total score, never just a single number.
Regression-tested directly: a lower-rated `WITHIN_RECOMMENDED` venue is proven to outrank a
higher-rated `HIGH_IMPACT` one.
**Rationale:** Making the dominance relationship an explicit, large weight ratio (rather than special-
cased logic like "always sort HIGH_IMPACT last regardless of score") keeps the ranking uniform and
inspectable while still achieving the required behavior — and remains tunable as a product policy
default without a code change.
**Status:** Accepted.
**Consequences:** Any future ranking factor (e.g. real distance once a live provider supplies
coordinates) should be added as one more named, weighted factor in this same policy object, never a
special case bolted onto the sort comparator.

---

### DEC-073

**Date:** 2026-09-09
**Context:** Per the brief's Section 14/52, a live discovery provider was only to be implemented "if
an existing product-owned credential/capability can safely support Sprint 6" — otherwise, complete the
abstraction + mock provider and report the exact blocked status rather than stalling the sprint or
fabricating fake production data.
**Decision:** Inspected `apps/web/.env.example` and `.env.local` before choosing anything — confirmed
no Google Places / web-search / any local-discovery API credential exists in this environment (only
`OPENAI_API_KEY`/`PLUGGY_*` are configured). No live provider adapter was written.
`LIVE_DISCOVERY_VALIDATION = BLOCKED_BY_EXTERNAL_PROVIDER_CONFIGURATION`. The running application uses
`MockDiscoveryProvider` by default (obviously-synthetic venue data, never real business names/
addresses), which is what live validation of the rest of the pipeline (envelope → intent → plans →
grounding → AI explanation) was actually run against.
**Rationale:** Writing a live adapter against a provider that can never actually be tested in this
environment would risk shipping undiscovered bugs and violates the same "do not assume a stale API
contract" instruction the brief itself raises — better to ship a complete, tested abstraction and
report precisely what's needed than to guess at an untestable implementation.
**Status:** Accepted.
**Consequences:** The Founder/Product must provision a product-owned (never end-user-supplied)
places/local-search API credential, server-side only, before a live adapter can be added — at that
point, adding it is purely additive per DEC-067's consequence.

---

### DEC-074

**Date:** 2026-09-09
**Context:** Live validation of the Section 51 acceptance scenario ("Vou sair com uma garota em
Campinas hoje à noite...") against the real running application and real OpenAI (not `MockAIProvider`)
found a genuine bug: the model correctly called `getConciergeBudget`, correctly read its
`recommendedAmountCents`/`cautionAmountCents`, and correctly cited those exact figures in prose — the
financial-envelope-first architecture was working exactly as designed — but `groundResponseText`
rejected the response anyway (`unsupportedAmountsCents: [129301, 159301]`), because
`extractFinancialFacts` in `facts.ts` had no case at all for `"getConciergeBudget"`, nor for the
`budget`/`currentBudget` fields nested inside `buildConciergePlans`/`evaluateConciergePlan` results.
This is the same failure mode as DEC-055 (Sprint 4.5) and DEC-062 (Sprint 5) recurring a third time: "a
correct tool result that is not exposed to grounding is a product bug," not a model bug.
**Decision:** Added `conciergeBudgetFacts(budget, sourceTool)` to `facts.ts`, producing three facts
(recommended amount, caution ceiling, search ceiling) per `ConciergeBudget`, and wired it into
`extractFinancialFacts` for `"getConciergeBudget"` (direct) and `"buildConciergePlans"` /
`"evaluateConciergePlan"` (via their nested `.budget`/`.currentBudget` field). Added two permanent
regression tests in `facts.test.ts`. Re-ran the exact live scenario after the fix:
`groundingStatus: "PASSED"`.
**Rationale:** Every new AI tool this project adds must ship its fact extractor in the same change —
this is now the third sprint in a row this exact gap has been found live rather than caught by review,
so it is called out explicitly here (again) as a recurring risk class, not a one-off.
**Status:** Accepted.
**Consequences:** Any future tool whose result contains a monetary figure the model might cite must add
a corresponding `extractFinancialFacts` (or `extractDiscoveryFacts`) case in the same PR — a new tool
with no fact extractor should be treated as an incomplete tool, not a follow-up task.

---

### DEC-075

**Date:** 2026-09-09
**Context:** After fixing DEC-074, the live model still refused to call `searchPlaces` /
`buildConciergePlans` even when explicitly and unambiguously asked ("Pode procurar opções de
restaurante em Campinas para mim?", and separately, in a brand-new conversation with zero prior
context, "Busque restaurantes em Campinas para hoje à noite.") — it replied that it could not search
for specific restaurants yet. Root cause, found by reading `system-instructions.ts`: Sprint 4's
`SYSTEM_INSTRUCTIONS_V1` contained an explicit numbered rule stating the model did not have real-world
venue/product/travel recommendations yet, and to say so if asked "where should I go." That rule was
completely accurate when Sprint 4 wrote it — and, unnoticed until this live test, directly contradicted
and actively suppressed the brand-new Sprint 6 discovery tools, even though they were correctly
registered with valid strict-mode schemas. This is a different failure class from DEC-074: not a
grounding-coverage gap, but a stale system-prompt instruction actively telling the model a true-when-
written fact that had since become false.
**Decision:** Removed the stale rule from `SYSTEM_INSTRUCTIONS_V1`, renumbering the rule after it.
Restructured the version chain so each sprint's additions are their own traceable layer:
`V1` (Sprint 4) → `V2` (Sprint 4.5, language matching) → `V3` (Sprint 5, recommendation-lifecycle
guidance, created retroactively during this fix so the layering stays consistent) → `V4` (Sprint 6,
concierge guidance — explicitly states the model DOES have `getConciergeBudget`/`searchPlaces`/
`buildConciergePlans`/`evaluateConciergePlan`, must resolve the financial envelope first, must never
invent venue facts, must ask for a location if missing, and that `saveConciergePlan`/
`reservePlanBudget` require an explicit decided instruction and never book/contact/spend on the user's
behalf). `CURRENT_SYSTEM_INSTRUCTIONS = SYSTEM_INSTRUCTIONS_V4`. Re-ran the full live scenario after
the fix in a fresh conversation: correct tool call, correct party-size/cost inference, correct
plan/grounding results.
**Rationale:** A capability can be fully implemented, correctly registered, and still be unreachable in
practice if an older instruction tells the model it doesn't exist — this class of bug is invisible to
every offline test that doesn't exercise the real system prompt end-to-end against a real model, which
is exactly why the brief's live-validation step exists.
**Status:** Accepted.
**Consequences:** When a sprint adds a capability that a prior sprint's system instructions describe as
absent or out of scope, that prior rule must be located and corrected in the same change — a version-
chain review ("does any earlier rule claim something this sprint just made untrue?") is now a required
step before considering a new AI capability done.

---

### DEC-076

**Date:** 2026-09-09
**Context:** Sprint 7 requires proactive alerts without turning Money Copilot into a notification
system that decides financial truth on its own — the brief is explicit that alert CREATION must be
100% deterministic and that "Alert" and "Notification" (a delivery of an alert through a channel) are
different concepts that must never collapse into one table.
**Decision:** `Alert` (`packages/app-services/src/alerts/types.ts`) is a persisted domain signal with
its own lifecycle (`ACTIVE_UNSEEN`/`ACTIVE_SEEN`/`DISMISSED`/`RESOLVED`); `NotificationDelivery`
(`packages/app-services/src/notifications/types.ts`) is a separate table recording one delivery
ATTEMPT of one alert through one channel. Alert creation/lifecycle transitions
(`alert-service.ts`'s `evaluateAlerts`/`upsertAlertEpisode`) never reference a notification provider or
delivery state at all; notification delivery (`notification-service.ts`) only ever READS an alert's
already-decided state to decide whether/how to render and deliver it. The AI's alert tools
(`getAlerts`/`getAlertDetails`/`markAlertSeen`/`dismissAlert`/`reevaluateAlertContext`/
`updateNotificationPreference`) can read, explain, mark-seen, dismiss, or re-check an EXISTING alert —
none of them can create one, resolve one, or change its severity.
**Rationale:** Mirrors the exact "the engine calculates, AI interprets" boundary already enforced for
financial figures (Sprint 4), recommendations (Sprint 5), and concierge discovery (Sprint 6) — alert
existence and meaning is one more kind of financial/product truth the AI must never originate.
**Status:** Accepted.
**Consequences:** A future external channel (PUSH/EMAIL) only ever needs new `NotificationProvider`
implementations and `NotificationChannel` values — it never needs to touch `Alert`'s own schema or
lifecycle logic.

---

### DEC-077

**Date:** 2026-09-09
**Context:** The brief's anti-spam requirements (Section 24) are the most safety-critical part of
Sprint 7: one active alert per identity/episode, no duplication on repeated identical evaluation, a
seen alert must not become unseen again, a dismissed alert must not reappear, and a resolved condition
should only re-arm after a MEANINGFUL recovery/re-deterioration — not on every tiny fluctuation.
**Decision:** A single shared function, `upsertAlertEpisode` (`alert-service.ts`), implements ALL of
this in one place for every alert type: it looks up the most recent row for an identity
(`findLatestAlertRowByIdentityKey`), reuses it in place (touching only `lastTriggeredAt`/evidence,
never `status`/`seenAt`/`dismissedAt`) whenever the condition is still true and a non-terminal row
already exists, transitions to `RESOLVED` the moment the condition becomes false, and only creates a
brand-new row when no non-terminal row exists for that identity (which is also what "re-arming" means
here — a new episode after an old one resolved). For `SAFE_TO_SPEND_MATERIAL_DROP` specifically, a
persisted ORIGINAL episode baseline (`AlertEvaluationCheckpoint.activeDropEpisodeBaselineCents`) plus a
configured recovery hysteresis ratio (`AlertPolicy.safeToSpendRecoveryHysteresisRatio`) prevents a
value oscillating right at the material-drop threshold from flapping the alert open/resolved on every
evaluation.
**Rationale:** Per-type ad-hoc reuse/resolve logic would have meant seven or eight independent, easy-
to-diverge implementations of the exact same anti-spam guarantee — one shared mechanism is both less
code and structurally impossible to get inconsistent across types.
**Status:** Accepted.
**Consequences:** Any new alert type added in a future sprint must compute a boolean
"isCurrentlyTrue" and call `upsertAlertEpisode` — it must never invent its own reuse/dismiss/resolve
branching.

---

### DEC-078

**Date:** 2026-09-09
**Context:** Safe-to-Spend/liquidity-coverage change detection requires a "previous" value to compare
against — but the brief explicitly warns against retroactively alerting on a profile's entire
pre-existing historical state the first time alerting is turned on (Section 12: "do not double-count
old data").
**Decision:** One `AlertEvaluationCheckpoint` row per profile
(`packages/persistence`'s `alert_evaluation_checkpoints` table) stores the minimum comparable state:
rolling `safeToSpendCents`, `liquidityAwareSafeToSpendCents`, `liquidityCoverage`, the currently-active
drop episode's baseline (if any), `evaluatedAt`, and `policyVersion` — never a duplicate full snapshot.
When no checkpoint row exists yet (a fresh profile, or alerting's first-ever run against an established
one), both checkpoint-delta-dependent alert types (`SAFE_TO_SPEND_MATERIAL_DROP`,
`LIQUIDITY_COVERAGE_DEGRADED`) are unconditionally suppressed for that one call, while the OTHER five
alert types (which evaluate CURRENT state only, no delta needed) are unaffected and correctly surface a
presently-true condition even on a first-ever run. A live-data-specific subtlety: a profile that has
never connected any institution is permanently `UNKNOWN` coverage from day one — `evaluateAlerts`
distinguishes this ("nothing was ever better, so it can't be degrading") from a genuine COMPLETE→PARTIAL
regression by checking whether a real alert episode already exists, not just by comparing rolling
checkpoint values, which would otherwise incorrectly fire forever on a permanently-demo profile.
**Rationale:** The bootstrap/first-run distinction has to be narrower than "suppress everything on day
one" — a currently-broken connection or a currently-failed recommendation is real, present information
the user should see immediately, not noise to be filtered out just because it's the first evaluation.
**Status:** Accepted.
**Consequences:** Any future alert type that needs a "previous vs. current" comparison must add its own
field to `AlertEvaluationCheckpoint` (or a new profile-scoped checkpoint concept) and follow the same
"only checkpoint-delta types respect bootstrap suppression" pattern — a purely current-state alert type
never needs this at all.

---

### DEC-079

**Date:** 2026-09-09
**Context:** The brief requires a notification privacy model (a future lock-screen push must be able to
omit amounts) and an honest external-provider status, without implementing any real push/email
integration this sprint (`LIVE_EXTERNAL_NOTIFICATION_VALIDATION = NOT_CONFIGURED` is an acceptable,
expected outcome per the brief's own instruction).
**Decision:** `NotificationPreferences.privacyMode` (`GENERIC` | `AMOUNT_ALLOWED`) is enforced at
render time (`notification-service.ts`'s `renderPayload`) — `GENERIC` always produces the brief's own
example generic sentence ("Money Copilot encontrou algo que merece sua atenção."), never a
figure-bearing one, regardless of which alert triggered it. `NotificationProvider` (mirroring
`OpenFinanceProvider`/`LocalDiscoveryProvider`'s exact abstraction pattern) receives ONLY
`{financialProfileId, channel, title, body}` — never a transaction history, balance, or provider
token. `MockNotificationProvider` is the only registered provider; no Firebase/APNs/SendGrid/Twilio
code was written.
**Rationale:** Building the privacy boundary and the provider abstraction NOW, even with only a mock
implementation, means a future real channel is purely additive (one adapter + one registry branch)
and can never accidentally receive more financial context than a rendered notification payload needs —
the same reasoning already applied to `LocalDiscoveryProvider` (DEC-069) and `OpenFinanceProvider`.
**Status:** Accepted.
**Consequences:** Before any real external channel ships, Product must decide the actual default
`privacyMode` for real users (this sprint defaults to `AMOUNT_ALLOWED`, matching in-app behavior,
which is a reasonable default for a channel nobody outside the user's own device sees but may not be
the right default for a lock-screen-visible one).

---

### DEC-080

**Date:** 2026-09-09
**Context:** Two independent, explicitly-named hardening items: (1) the Sprint 4.5 incident where
repeated clicks on "Connect institution" created two sandbox connections, still not fully closed (the
button only disabled itself during the token-fetch request, not for the entire time the Connect widget
was open); (2) no UI existed yet for the already-implemented `disconnectConnection` (DEC-050); (3) a
production deployment with no live discovery credential would still silently return
`MockDiscoveryProvider`'s obviously-synthetic venues as if they were real search results.
**Decision:** `ConnectButton` is now disabled for the ENTIRE time its widget is open (`isOpen`), not
just during the token fetch — closing the exact gap the Sprint 4.5 incident exploited. A new
`DisconnectButton` (explicit two-step confirm, disabled while in flight, refreshes server state after)
wires to the EXISTING `DELETE /api/connections` endpoint — no new backend logic. A connection whose
status is `LOGIN_ERROR`/`USER_ACTION_REQUIRED`/`ERROR` now shows a "Reconectar" button (the SAME
`ConnectButton`/Connect-flow component, relabeled) instead of "Refresh / sync" — reconnecting the same
sandbox Item is already deduplicated by `completeConnection`'s existing (profile, provider,
externalConnectionId) lookup, so no new duplicate-prevention logic was needed there either.
Separately, `getDiscoveryProvider` now throws `DiscoveryError("PROVIDER_NOT_CONFIGURED_FOR_PRODUCTION")`
when asked to resolve `"mock"` under `NODE_ENV === "production"`; `concierge-service.ts`'s two entry
points catch specifically that error and return `{ discoveryUnavailable: true, candidates: [], plans:
[] }` — the financial envelope is still resolved normally, but no synthetic venue ever reaches a
production user.
**Rationale:** All three are the same class of fix — a real gap between what the system already
correctly implements at the service layer and what the UI (or environment-specific safety check) around
it actually enforces. Reusing the existing backend logic in every case (`disconnectConnection`,
`completeConnection`'s dedup, the discovery-provider registry) kept the fix small and low-risk.
**Status:** Accepted.
**Consequences:** A real live discovery provider, once configured, must be registered under its OWN
name (never reusing `"mock"`) so this production guard continues to do its job without any further
code change.

---

### DEC-081

**Date:** 2026-09-09
**Context:** The exact same live bug — a new AI tool returns a correct monetary figure, but
`facts.ts`'s per-tool `switch` statement has no case for it, so grounding rejects an entirely correct
answer — was found live in THREE separate sprints (DEC-055 in Sprint 4.5, DEC-062 in Sprint 5, DEC-074
in Sprint 6), always because the fact extractor lived in a file separate from the tool definition a
reviewer could add without touching. The Sprint 7 brief explicitly invites addressing this ("consider
whether a more declarative/shared fact-registration mechanism can reduce future omission risk... if a
small clean abstraction eliminates repeated manual omission bugs, implement it").
**Decision:** `ToolDefinition` (`copilot/tools.ts`) gained an optional `extractFacts` field. A tool
that can return a monetary figure now declares its OWN extractor INLINE, immediately next to its
schema and `execute` function — physically impossible to add the tool without at least seeing the
field. `extractFinancialFacts` (`facts.ts`) checks `findTool(toolName)?.extractFacts` FIRST, falling
back to the legacy per-tool switch only when a tool hasn't declared one — existing tools are
UNCHANGED, no forced migration. All six Sprint 7 alert tools use the new mechanism exclusively.
**Rationale:** A full migration of all ~27 existing tools' extraction logic into the new style would
have been a large, purely-cosmetic risk for no behavioral gain (every existing tool's coverage is
already correct and tested) — the brief itself cautions against a "massive rewrite unless justified."
Adding the mechanism and applying it going forward gets the actual benefit (new tools can no longer
silently skip grounding coverage) without that risk.
**Status:** Accepted.
**Consequences:** Any NEW tool added from Sprint 8 onward that can return a monetary figure should use
`extractFacts` inline rather than adding a new `facts.ts` switch case — code review for a new tool
should specifically check this field exists when the tool's result could contain money.

---

### DEC-082

**Date:** 2026-09-09
**Context:** Live validation against the real running app and real OpenAI (Section 73's scenario) found
a genuine bug: asking the assistant to "Pode marcar o alerta do Safe-to-Spend como visto." — natural
phrasing that names WHICH alert, exactly the kind of message a real user sends — was rejected as
`MUTATION_NOT_EXPLICIT` even though the user's intent was unambiguous. Root cause:
`EXPLICIT_ACTION_PATTERNS`' mark-seen regex, `/\bmarc(a|ar|ado|o|ou) como (visto|vista|lido|lida)\b/i`,
required "marcar" and "como visto" to be ADJACENT — true only for the brief's own bare example ("Pode
marcar como visto.") and false for any real sentence that names the object in between, which is the
more natural and more common phrasing.
**Decision:** Widened the pattern to `/\bmarc(a|ar|ado|o|ou)\b.{0,40}\bcomo (visto|vista|lido|lida)\b/i`
— allows up to ~40 characters between the verb and "como visto" (enough for "o alerta do Safe-to-Spend"
or similar) while still requiring both markers in the right order, so an unrelated sentence that merely
contains the word "marcar" somewhere far earlier still doesn't match. Added two permanent regression
tests using the exact live-failing phrasing. Verified live after the fix: the identical message now
succeeds (`markAlertSeen: SUCCESS`).
**Rationale:** A regex tuned only against a brief's own bare illustrative example, without considering
how a real user would actually phrase the same intent with an object named in between, is exactly the
kind of gap only live validation (not offline unit tests written against the same narrow examples)
reliably catches — the same lesson as DEC-064's/DEC-075's live-phrasing gaps in earlier sprints, now a
fourth recurrence in a fourth domain (recommendations, concierge, now alerts).
**Status:** Accepted.
**Consequences:** Any future mutation-guard pattern should be written against how a user would
plausibly phrase the intent WITH an object/detail named in the middle, not just the shortest possible
example — "does this still match if the user names what they're acting on?" is now a standing question
to ask before considering a new pattern done.

---

### DEC-083

**Date:** 2026-09-10
**Context:** Sprint 8 introduced `apps/ritmo` — a new TanStack Start frontend (ported from the
Founder-approved `meu-ritmo-design` Lovable prototype) that becomes the product UI, replacing
`apps/web`'s developer dashboard as the surface end users see. `apps/ritmo`'s server functions
import `@money-copilot/app-services` directly and call `getDb()` exactly like `apps/web` already
does — the same file-backed PGlite database, just from a second application.
**Decision:** DEC-051's rule ("never run a second process against the same file-backed PGlite data
directory while another process already has it open") now explicitly extends to `apps/ritmo`:
`pnpm --filter @money-copilot/web dev` and `pnpm --filter @money-copilot/ritmo dev` must never run
concurrently against the same data directory. In practice each app's default `MONEY_COPILOT_DB_PATH`
resolves relative to its own `cwd` (`apps/web/.data/...` vs. `apps/ritmo/.data/...`), so the two
currently write to two DIFFERENT physical files rather than corrupting a shared one — but both
independently reseed the identical fixture on first run, so this is a latent footgun rather than a
protection: pointing both at the same explicit `MONEY_COPILOT_DB_PATH` (e.g. via a shared
`.env.local`) would immediately reintroduce DEC-051's exact failure mode. The documented rule is:
stop whichever dev server isn't in use before starting the other, and never override
`MONEY_COPILOT_DB_PATH` to point both apps at one file.
**Rationale:** `apps/web` is being retired deliberately once `apps/ritmo` reaches parity (see
`docs/RITMO.md`) — until then, both exist, both are capable of opening the database, and DEC-051's
underlying constraint (PGlite arbitrates no concurrent OS-process access) is unchanged by which
application is doing the opening.
**Status:** Accepted.
**Consequences:** `docs/RITMO.md` documents this rule for anyone working in `apps/ritmo`; no
automated enforcement exists (matching DEC-051's own state) — this remains a documented discipline,
not a code-level guard.

---

### DEC-084

**Date:** 2026-09-09
**Context:** The Sprint 8 plan called for a `server/` directory as the single location allowed to
import `@money-copilot/app-services` in `apps/ritmo` (mirroring `apps/web`'s Route-Handler-only
boundary). Wiring the Home screen's first server function this way produced a full-page red error
overlay in dev: `[plugin:vite:import-analysis] [import-protection] Import denied in client
environment / Denied by file pattern: **/server/**`. Investigation (reading
`@tanstack/start-plugin-core`'s `import-protection/defaults.js`, then downloading
`@lovable.dev/vite-tanstack-config`'s own published `dist/index.js` via `npm pack`) found this is a
real, deliberate Lovable scaffold convention, not a bug: it overrides TanStack Start's own default
`import-protection` pattern (`**/*.server.*`, file-suffix-based) to `client: { files:
["**/server/**"], specifiers: ["server-only"] }` — i.e. any import path literally containing a
`server/` segment is denied from client-context code.
**Decision:** Renamed the directory to `apps/ritmo/src/functions/` — identical architectural role
(the only place `createServerFn()` bodies live, the only place allowed to import `app-services`),
different name that doesn't collide with the scaffold's literal pattern match.
**Rationale:** The protection itself is exactly the security boundary the Sprint 8 plan already
required — the fix is to work with Lovable's own naming convention, not to weaken or bypass the
protection to keep a preferred folder name.
**Status:** Accepted.
**Consequences:** Any future `apps/ritmo` work should assume `src/functions/` (never `src/server/`)
is where server-only code lives; `docs/RITMO.md` documents this explicitly so the reason isn't
rediscovered from scratch.

---

### DEC-085

**Date:** 2026-09-09
**Context:** Live screenshot verification of the Home screen's real-data wiring showed "Hoje, 04 de
setembro" for `asOfDate = "2026-09-05"` — one calendar day off. Root cause:
`Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "long" })`, with no explicit `timeZone` option,
formats in the HOST PROCESS's local timezone; a `Date` built via `Date.UTC(year, month-1, day)`
represents UTC midnight, which is the PREVIOUS calendar day in any timezone behind UTC — exactly the
same category of date-vs-instant confusion `packages/financial-engine`'s own `date-utils.ts` already
guards against for every domain date (every date in this codebase is an explicit "YYYY-MM-DD"
calendar string, never a real timezone-bound instant).
**Decision:** Added `timeZone: "UTC"` to the formatter in `apps/ritmo/src/adapters/format.ts`, with a
comment recording the live-discovered failure mode, plus a permanent regression test
(`format.test.ts`) asserting the day never shifts backward.
**Rationale:** A presentation-layer formatter that silently depends on the server process's local
timezone is a latent bug for any deployment environment set to a timezone behind UTC (which most
production hosting defaults to, UTC itself) — the fix generalizes the financial-engine's own
established discipline to the new presentation layer rather than inventing a separate convention.
**Status:** Accepted.
**Consequences:** Any future `apps/ritmo` date-formatting helper must pass `timeZone: "UTC"` (or
equivalent) explicitly — never rely on the host process's default timezone.

---

### DEC-086

**Date:** 2026-09-09
**Context:** Wiring the Assistente screen's real chat (per the Founder's explicit instruction to
connect it to the real `runCopilotTurn` orchestrator, not leave it scripted) surfaced two real,
live-discovered gaps. First, the Lovable mock's "Simulação" card shows a fabricated `Hoje`/`Depois`
Safe-to-Spend pair; the real `simulateExpense` tool's actual output has no such pair — it returns a
recommended limit, projected savings after the expense, and any compensation required to still hit
the savings goal. Second, a real live OpenAI response rendered with literal `**asterisks**` visible
in the chat bubble: the model's replies use plain markdown, but the approved bubble is a plain `<p>`,
never a markdown renderer — a real, visible defect not present in the fully-scripted mock (which
never contained markdown).
**Decision:** The "Simulação" card now shows the three real `simulateExpense` figures (recommended
limit, projected savings after, compensation required) under honest labels, only ever rendered when
that tool actually ran this turn — never a fabricated before/after pair. A small, targeted
`parseInlineMarkdown()` function (splits `**bold**` spans into bold/plain text segments) was added and
used only for chat-bubble text — deliberately not a general markdown parser, and it never touches the
bubble's own visual container/styling.
**Rationale:** Both gaps are exactly the kind of "the mock implied a fact/format the real system
doesn't produce" case Sprint 8's own data-integration rule anticipates: adapt the displayed content
honestly, never fabricate, never touch the approved visual shell beyond what's strictly needed to
render real content correctly.
**Status:** Accepted.
**Consequences:** `docs/RITMO.md`, "Data-model gaps" #7/#8, documents both for future reference. If a
future model response includes other markdown constructs (lists, links, headers), the same literal-
character defect will recur until `parseInlineMarkdown` (or a real markdown renderer, if ever
justified) is extended to cover them.

---

### DEC-087

**Date:** 2026-09-11
**Context:** Sprint 9 (production authentication and multi-user isolation) needs a single, fail-closed
notion of "what environment is this process running in" — today only two ad hoc
`NODE_ENV === "production"` checks exist anywhere in the repo, and there is no way to express
"staging" at all (a required environment per the Sprint 9 brief, distinct from both local development
and production). Every later Sprint 9 safety rule (never seed Founder fixture data outside
development/test, never boot production against file-backed PGlite, never honor a dev-only auth
bypass flag in production) needs one shared, tested source of truth for this, not each call site
inventing its own check.
**Decision:** Added a new package, `@money-copilot/config` (`src/env.ts`):
`resolveAppEnvironment()` (returns `"development" | "test" | "staging" | "production"`, `APP_ENV`
authoritative when set since it's the only way to express staging, falling back to conventional
`NODE_ENV` values, defaulting to `"development"` — never defaulting to `"production"`, so a
misconfigured deployment fails loudly rather than silently behaving as dev), `requireEnv()` (throws
`EnvironmentConfigError` on a missing/blank variable, never returns an empty string as if it were
set), and `assertDevOnlyFlagNotInProduction()` (fails closed if a dev-only flag is `"true"` while the
resolved environment is production).
**Rationale:** First placed in `@money-copilot/shared` (reasoning: generic/non-financial, every
package already depends on it) — this was wrong and caught immediately by `pnpm -r run typecheck`:
`financial-engine` depends on `shared`, and `financial-engine` is deliberately usable with **no
Node/framework dependency at all** (`docs/ARCHITECTURE.md`, "Why this split"). Since `shared` ships as
raw source (no compiled `.d.ts`), any consumer importing from it type-checks the whole module graph
`shared` re-exports — so a `process.env` read anywhere in `shared` breaks `financial-engine`'s (and
`ai`'s, `open-finance`'s, `discovery`'s) Node/framework independence, not just conceptually but as a
real, immediate compile error. Moved to a new, separate `@money-copilot/config` package instead,
depended on only by the Node-context packages that actually need it (`persistence`, `app-services`,
`apps/ritmo`) — `financial-engine`/`ai`/`open-finance`/`discovery` do not and must not depend on it. A
dependency-free, plain-TypeScript implementation (no zod or similar) was kept — the validation here is
a handful of presence/equality checks, matching this codebase's existing style (`getPluggyClient`,
`/api/chat`'s `OPENAI_API_KEY` check) of inline checks without a schema library.
**Status:** Accepted.
**Consequences:** Phase 1 (production Postgres boot guard, seed gate) and Phase 3 (dev auth bypass
gate) of Sprint 9 both build directly on these three functions rather than inventing their own
environment checks. `apps/ritmo/.env.example` (new) documents `APP_ENV` for the first time.

---

### DEC-088

**Date:** 2026-09-11
**Context:** Sprint 9 must decide which app(s) receive real authentication. `apps/web` has
`DEMO_PROFILE_ID` hardcoded across 6 separate route files with zero auth infrastructure of any kind;
`apps/ritmo` has exactly one seam, `getCurrentProfileContext()`
(`apps/ritmo/src/functions/profile-context.ts`), built in Sprint 8 specifically so a later sprint
could replace its internals without touching any adapter or route. `apps/web` is already documented
(Sprint 8, `docs/RITMO.md`) as internal/debug-only, to be retired once `apps/ritmo` reaches parity.
**Decision:** Sprint 9's authentication work targets `apps/ritmo` exclusively. `apps/web` remains
local-only and unauthenticated; it must never be deployed to a publicly reachable address, and if it
is ever run against a shared (non-laptop-local) environment, that access is restricted at the network
level (VPN/IP allowlist), not by adding application-level auth to a to-be-retired debug tool.
**Rationale:** Retrofitting real authentication onto 6 hardcoded call sites in an app already
scheduled for retirement is effort spent on code that's going away, for zero product benefit — the
brief's own instruction ("if `apps/web` is retained for internal debugging: keep it local/internal or
explicitly protected") explicitly allows this scoping.
**Status:** Accepted.
**Consequences:** Any future session must not assume `apps/web`'s API routes are protected by
anything beyond "don't expose this host publicly" — this is a documented, deliberate gap, not an
oversight. `apps/ritmo`'s server/client security boundary and its single profile-context seam (both
Sprint 8, DEC-084) remain the enforcement points Sprint 9 builds on.

---

### DEC-089

**Date:** 2026-09-11
**Context:** Sprint 9 requires production-grade authentication infrastructure. The brief's own
instruction is to evaluate deliberately and document the choice, not default to whatever a scaffold
happened to include.
**Decision:** **[Better Auth](https://www.better-auth.com/)** — self-hosted, TypeScript, runs inside
`apps/ritmo`'s own server functions rather than redirecting to a vendor-hosted screen (so it can never
own Ritmo's visual identity — a hard constraint the brief repeats across multiple sections), ships a
Drizzle adapter (no second ORM alongside the existing persistence layer), and provides email/password,
OAuth, email verification, secure password-reset, and a first-party MFA plugin (satisfying "future MFA
readiness" without committing to MFA now). **Identity model**: Better Auth's own canonical user record
is the single source of truth for authentication identity — there is no separate, duplicate "Ritmo
User" table. `financial_profiles.owner_user_id` references Better Auth's `user.id` directly.
`FinancialProfile` keeps its own separate, opaque id regardless, because Pluggy's `clientUserId`/
connection-recovery mechanism (`recoverOrphanedConnection`, DEC-046) already depends on
`financialProfileId` being a stable value distinct from any auth-provider identity.
**Rationale:** **Clerk** was considered and rejected — its core value proposition is prebuilt hosted
UI; its headless "Elements" kit narrows but doesn't remove the visual-ownership tension the brief
explicitly warns against, plus a recurring per-MAU cost for a pre-revenue product. **Auth.js** was
considered and rejected — its TanStack Start support is a community pattern, not a first-party
integration, unlike Better Auth's dedicated TanStack Start guide. Implementation follows that official
guide exactly (its `/api/auth/*` handler mounted as a TanStack Start server route, its own cookie
helpers, `getSession` for server-side session retrieval, its client SDK for the login/signup/recovery
forms, its `signOut` for logout) — no custom password hashing, session tokens, or crypto of any kind.
**Status:** Accepted.
**Consequences:** `apps/ritmo/src/functions/profile-context.ts`'s real implementation (Sprint 9 Phase
3) resolves `FinancialProfile` via `owner_user_id = session.user.id`. If Ritmo ever needs application
metadata Better Auth's user schema doesn't hold, that becomes a clearly separate, explicitly-named
metadata relation keyed on the same id — never a second parallel identity table.

---

### DEC-090

**Date:** 2026-09-11
**Context:** Sprint 9 requires a production Postgres database — file-backed PGlite (DEC-051/DEC-083)
is development/test infrastructure only, and has no real multi-process/multi-instance story. The
brief's own instruction is to evaluate deployment/runtime requirements before picking infrastructure,
not by habit.
**Decision:** **[Neon](https://neon.tech)** (serverless Postgres) for the production/staging database.
**Deployment runtime**: override `apps/ritmo`'s Lovable-scaffolded nitro preset from its default
(`cloudflare-module`, confirmed by reading `@lovable.dev/vite-tanstack-config`'s source and
`apps/ritmo/vite.config.ts`'s own comment) to `node-server` via `nitro: { preset: "node-server" }`,
deployed to a plain Node host (Railway recommended for operational simplicity/cost fit; Fly.io or
Render are reasonable alternatives) — this override does not require ejecting from the Lovable
scaffold.
**Rationale:** Neon ships built-in connection pooling (directly relevant to avoiding connection storms
in serverless/ephemeral environments), branch-per-environment support (a natural fit for the required
staging environment), and works over both a plain TCP `pg`/node-postgres connection and an HTTP
driver. The Node-runtime override exists because our actual server-only dependencies — the `openai`
Node SDK, `pluggy-sdk`, Drizzle with a Postgres driver, Better Auth's Node adapter (DEC-089) — are not
built for the Cloudflare Workers edge runtime the scaffold defaults to; forcing edge compatibility
(Neon's WebSocket driver, auditing every SDK for Workers support) is real, avoidable risk for zero
benefit at this stage, and the brief itself instructs against forcing an edge runtime when server
dependencies are incompatible.
**Status:** Accepted.
**Consequences:** `packages/persistence` gains a second, node-postgres-based database adapter
alongside the existing PGlite one (Sprint 9 Phase 1), environment-selected via DEC-087's
`resolveAppEnvironment()`. Both vendor choices are reversible (neither Better Auth's data model nor
Postgres itself is exotic) — this is a considered default for the first production deployment, not a
permanent architectural commitment.

---

### DEC-091

**Date:** 2026-09-11
**Context:** `reconciliation_links` (`packages/persistence/src/schema.ts`) had no
`financial_profile_id` column at all — a pre-existing, self-flagged gap
(`docs/OPEN-FINANCE.md`, "Known provider limitations": "harmless with today's single demo profile;
would need a migration before real multi-profile support"). `repo.listAllReconciliationLinks(db)`
returned every profile's links to any caller; `reconcileProfile` (`packages/app-services/src/sync.ts`)
used it to build its de-dup key set, reading every other profile's reconciliation data into a
computation that should only ever see one profile's own data. Sprint 9's multi-user isolation work
made this the first concrete fix, since reconciliation is explicitly named in the brief as an area
that "must never compare/merge economic data across different users/profiles."
**Decision:** Added `financial_profile_id` to `reconciliation_links` (migration
`0007_curious_speedball.sql`, hand-edited after `drizzle-kit generate` produced a plain
`NOT NULL` column add that would fail against any already-populated table: the real migration adds
the column nullable, backfills it from each link's own `primary_transaction_id`'s
`financial_transactions.financial_profile_id`, then sets `NOT NULL` and adds the FK — verified against
a database with pre-migration rows inserted via raw SQL, not just a fresh empty database). Added
`financialProfileId` to the domain `ReconciliationLink` type
(`packages/financial-engine/src/domain/reconciliation.ts`), stamped from the matched transaction's own
`financialProfileId` in both `findTransactionDuplicates` and `reconcileEventLineItems`. Folded it into
`reconciliationLinkPairKey`'s content-identity key too, as defense in depth. Replaced
`listAllReconciliationLinks` with `listReconciliationLinksForProfile(db, financialProfileId)`
(profile-filtered) at all three call sites (`sync.ts`'s `reconcileProfile`, `persistence`'s `seed()`,
and a test) — the unscoped function no longer exists anywhere in the codebase.
**Rationale:** A pure schema/signature fix rather than a defense added only at a future API/route
layer — the same principle as every other profile-scoped repository function already in this
codebase, extended to the one table that had fallen through the cracks in Sprint 2.
**Status:** Accepted.
**Consequences:** New permanent regression coverage:
`packages/financial-engine/src/domain/reconciliation.test.ts` (stamping),
`packages/persistence/src/reconciliation-repository.test.ts` (round-trip + two-profile isolation —
proves a second profile's links are never returned for the first). Any future reconciliation-adjacent
function must take and filter by `financialProfileId` from here on; there is no longer an unscoped
read path to reach for by accident.

---

### DEC-092

**Date:** 2026-09-11
**Context:** DEC-090 chose Neon Postgres for staging/production, alongside the existing PGlite
database used for development/test. `packages/persistence/src/db.ts` exported a single
`Database = PgliteDatabase<typeof schema>` type used as a parameter type across 12+ files in
`app-services`; the migrator (`migrate.ts`) imported PGlite's own `drizzle-orm/pglite/migrator`,
which is API-incompatible with a Postgres connection.
**Decision:** `Database` is now driver-neutral: `PgDatabase<PgQueryResultHKT, typeof schema>` from
`drizzle-orm/pg-core` — the shared base class both `PgliteDatabase`/`NodePgDatabase` extend, verified
by direct assignability check before adopting it (both driver-specific database objects satisfy the
neutral type; every repository function's `.select()`/`.insert()`/`.update()`/`.delete()` call is
defined on the base class, unaffected by which concrete driver produced the instance). Two parallel,
driver-specific pairs exist for the small "bootstrap" surface that Drizzle doesn't offer a neutral API
for: `createDatabase`/`runMigrations` (PGlite) and `createPostgresDatabase`/`runPostgresMigrations`
(node-postgres, a pooled `pg.Pool` with a modest `max: 10` — a single long-lived Node process per
DEC-090's Node-runtime choice, not a serverless-per-request function that would risk a connection
storm). `packages/app-services/src/db.ts`'s `initializeDb()` picks the pair via two new pure,
independently-unit-tested predicates, `shouldUsePostgres(environment)` and
`shouldSeedDatabase(environment)` (`db.test.ts`) — staging/production always take the Postgres branch
and never seed; development/test always take the PGlite branch and always seed (idempotently, as
before). Because these two environment sets are disjoint by construction, production can never
accidentally boot against file-backed PGlite and can never accidentally seed Founder fixture data —
not by a separate defensive check, but because no code path connects "production" to either PGlite or
`seed()` at all.
**Rationale:** A driver-neutral base type keeps the other ~99% of the codebase (every repository
function, every app-service) completely unaware that two drivers exist — only the bootstrap surface
(4 functions total) needs to know. This was verified empirically (a standalone assignability probe)
before committing to it, rather than assumed from Drizzle's documentation alone.
**Status:** Accepted.
**Consequences:** The Postgres adapter is type-checked and unit-tested (driver selection logic) but
has NOT been exercised against a real Postgres server — no Postgres instance exists in this
environment. That exercise happens in Sprint 9 Phase 6 (staging validation) once a real Neon database
exists; until then, `createPostgresDatabase`/`runPostgresMigrations` carry real but unverified-against-
a-live-server risk, same as any new code path pending its first live run.

---

### DEC-093

**Date:** 2026-09-11
**Context:** Sprint 9 Phase 2's own research pass (three parallel audits of the auth/API surface,
persistence layer, and app-services ownership boundaries) produced a confirmed, itemized IDOR
inventory: `disconnectConnection` (no `financialProfileId` parameter AT ALL — any caller could delete
another profile's entire connected-account data by guessed id, the single highest-severity finding),
`syncConnection`/`refetchTransactionsByExternalId` (took `financialProfileId` but never checked the
fetched connection actually belonged to it — cross-tenant data contamination, not just a read leak),
`getLatestSyncRunForConnection`, `getRecommendationDetails`, `acceptRecommendation`/
`modifyRecommendation`/`rejectRecommendation`, `markAlertSeen`/`dismissAlert`/`getAlertById`/
`reevaluateAlertContext`, `getOrCreateConversation` (read+write access to another profile's entire
chat history — the most serious conversation-layer gap), `appendMessage`/`listMessagesForConversation`,
and concierge's `requireSession` (→ `reevaluateConciergePlan`/`saveConciergePlan`) — none of these
took a resource id without either omitting `financialProfileId` entirely or fetching by id first and
never checking the result's own stored profile matched the caller.
**Decision:** Added `packages/app-services/src/ownership.ts`: one `ResourceNotFoundError` and one
`assertOwnedByProfile(resource, financialProfileId, description)` helper, used everywhere a resource
is fetched by bare id and then acted on. **Deliberately identical failure for "doesn't exist" and
"exists but belongs to someone else"** — both throw the same error, same message shape (brief §18:
"never leak whether another user's sensitive resource exists") — never a distinct "403 exists, not
yours" signal. Two implementation patterns were used, chosen per call site: (1) push the check into
the ONE canonical "fetch this resource type by id" function so every current and future caller is
protected automatically (used for `getAlertById`, `getOrCreateConversation`,
`listMessagesForConversation` — these had (or became, for conversations) a single choke-point
function); (2) call `assertOwnedByProfile` directly at each mutation/read site where no single
choke-point existed (`sync.ts`'s three connection functions, `recommendation-service.ts`'s
`requireRecommendation`, `concierge-service.ts`'s `requireSession`). Every AI copilot tool
(`tools.ts`) that calls one of these functions now passes `ctx.financialProfileId` — the
orchestrator's own already-resolved, trusted value — never a client-supplied id.
**Rationale:** A single shared error type/helper, used consistently, means the "never leak existence"
property is enforced in exactly one place's design intent rather than re-derived correctly (or not) at
every call site. Choosing between the two patterns per call site (rather than forcing one everywhere)
matched each file's existing structure instead of a wide, riskier refactor.
**Status:** Accepted.
**Consequences:** A live bug was found WHILE fixing this (not before): `dismissAlert`'s and
`markAlertSeen`'s internal calls to `requireAlert` had their `(financialProfileId, alertId)` arguments
transposed during the first edit pass — caught immediately by the existing pre-Sprint-9 test suite
(`notification-service.test.ts`, `orchestrator-alerts.test.ts` both failed with a
`ResourceNotFoundError` for what should have succeeded), fixed before commit. This is direct evidence
the existing test suite has real teeth, not just coverage theater. A second, more serious gap was
found the same way while writing Phase 2's adversarial suite — see DEC-094.

---

### DEC-094

**Date:** 2026-09-11
**Context:** While writing Sprint 9's permanent two-profile adversarial regression suite
(`packages/app-services/src/two-profile-isolation.test.ts`), a reconciliation-isolation test failed
with a real cross-tenant read: `packages/persistence/src/repositories.ts`'s
`loadFinancialSnapshotInput` — the single function `getFinancialSnapshot`, `getCategoryTotals`,
`getUncategorizedTransactions`, `getReconciliationCandidates`, and `reconcileProfile` all load their
data through — read `reconciliation_links` with `db.select().from(schema.reconciliationLinks)` and
**no `WHERE` clause at all**, unlike every other query in the same function (all ten of which
correctly filter by `financialProfileId`). This is a second, independent instance of the exact gap
DEC-091 (Phase 1) already fixed at the `listReconciliationLinksForProfile`/`reconcileProfile` call
site — DEC-091's own fix did not cover this second, separate unscoped read site inside
`loadFinancialSnapshotInput` itself, which neither that fix's manual review nor its two-profile repo
test happened to exercise (that test called the scoped list function directly, never
`loadFinancialSnapshotInput`).
**Decision:** Added `.where(eq(schema.reconciliationLinks.financialProfileId, financialProfileId))`
to that query, matching every sibling query in the same `Promise.all`.
**Rationale:** The real financial impact was likely low in practice (`excludedTransactionIds` matches
by globally-unique transaction id, so a foreign profile's link couldn't wrongly exclude a real
transaction from this profile's own spending sum) — but `FinancialSnapshotInput.reconciliationLinks`
still handed every profile's link records (transaction ids, confidence, method) to any caller of five
different app-services functions, a genuine read-scope violation regardless of today's specific
downstream consumers happening not to misuse it.
**Status:** Accepted.
**Consequences:** This is the second time in one sprint a reconciliation-adjacent unscoped read was
found only by writing an adversarial test that actually exercised the real code path, not by manual
review of the schema/function signatures alone — the same lesson as DEC-064/DEC-075/DEC-082/DEC-093's
"live phrasing/live behavior gap" pattern, here for cross-tenant data isolation specifically. Any
future audit of `financial_profile_id`-scoped tables should grep for every raw `db.select().from(schema.X)`
call on a profile-scoped table, not just the ones already known to be called `list*ForProfile`.

---

### DEC-095

**Date:** 2026-09-11
**Context:** `packages/persistence/src/auth-schema.ts` and `apps/ritmo/src/routes/api/auth/$.ts` both
carried a code comment citing this decision number before the decision itself was ever written down —
a gap surfaced by a later state-recovery audit (this session), not by the original implementation
pass. Recorded now, retroactively, so the citation resolves to something real.
**Decision:** Better Auth's identity-table schema (`user`, `session`, `account`, `verification` in
`auth-schema.ts`) was derived directly from Better Auth 1.7.4's own `getSchema()` function
(`better-auth/db`), called with this app's real config (email/password enabled) — not guessed from
documentation or copied from an example. The API mount point follows Better Auth's official TanStack
Start integration guide exactly: a single catch-all file route (`/api/auth/$`) with `GET`/`POST`
handlers that call `auth.handler(request)`, no custom routing or method-specific logic layered on top.
**Rationale:** Hand-guessing Better Auth's schema shape risks drifting from whatever fields/constraints
a specific installed version actually expects (session token uniqueness, cascade rules, etc.); reading
them from the library's own schema generator, against the exact config this app uses, removes that
risk entirely. Following the official integration guide's exact mount shape (rather than a
hand-rolled equivalent) means future Better Auth upgrades can be diffed against the guide, not against
this app's own reinvention of it.
**Status:** Accepted.
**Consequences:** `auth-schema.ts`'s tables are owned by Better Auth — this codebase never writes to
them directly except through `auth.api.*`. If a future Better Auth upgrade changes `getSchema()`'s
output, `auth-schema.ts` must be regenerated the same way (re-run `getSchema()` against this app's
config), not hand-edited to match a changelog description.

---

### DEC-096

**Date:** 2026-09-11
**Context:** Same retroactive gap as DEC-095 — `packages/persistence/src/repositories.ts`'s
`provisionProfileForOwner` cited this decision number before it existed. `loadFinancialSnapshotInput`
(the function every Ritmo screen's data ultimately flows through) hard-requires exactly one
`FinancialGoal` per profile and throws otherwise — a pre-existing `financial-engine` invariant, not
something Sprint 9 changes. A brand-new profile provisioned on first login has no goal a real user has
ever stated.
**Decision:** `provisionProfileForOwner` creates a minimal placeholder `FinancialGoal`
(`monthlySavingsTargetCents: 0`) alongside the profile, but only the first time a given owner's profile
is genuinely new (guarded by the same `onConflictDoNothing`/`.returning()` race-safe check used for the
profile row itself).
**Rationale:** A zero monthly-savings-target, honestly representing "no goal set yet," satisfies the
existing invariant without fabricating an aspirational number the user never actually stated — the
brief's explicit rule that a real user never receives fabricated financial data (§11) extends
naturally to a brand-new user's very first data.
**Status:** Accepted.
**Consequences:** Phase 4's onboarding flow (not yet started — see PROJECT_STATE.md) is the natural
place for a user to later set a real savings goal; until then, every new signup's Safe-to-Spend/goal
UI honestly reflects "not set" rather than a made-up figure.

---

### DEC-097

**Date:** 2026-09-11
**Context:** Sprint 9 Phase 3 fix-up, following a state-recovery audit (this session) of Sprint 9's
uncommitted work. `auth.server.ts`'s `betterAuth({...})` call passed neither `secret` nor `baseURL`.
Reading Better Auth 1.7.4's own source (`dist/context/create-context.mjs`) showed the actual fallback
behavior: with no `secret`, it uses `options.secret || env.BETTER_AUTH_SECRET || env.AUTH_SECRET ||
"better-auth-secret-12345678901234567890"` — a fixed, publicly-known insecure default — and only
refuses to start (`validateSecret`) when its own internal `isProduction` check trips, which is based on
`NODE_ENV`, not this codebase's `APP_ENV`/`resolveAppEnvironment()`. Since this app treats `APP_ENV` as
authoritative and defines a `staging` tier Better Auth has no concept of at all, a staging deployment
with `NODE_ENV` unset or `"development"` could boot signing real user sessions with the well-known
default secret, entirely undetected by Better Auth's own guard. `baseURL`, left unset, is silently
derived per-request instead of failing loudly.
**Decision:** Added `apps/ritmo/src/functions/auth-config.server.ts`: `resolveBetterAuthSecret(environment,
env)` and `resolveBetterAuthBaseURL(environment, env)`, both pure and directly unit-tested
(`auth-config.server.test.ts`). In staging/production, both call `@money-copilot/config`'s `requireEnv`
for `BETTER_AUTH_SECRET`/`BETTER_AUTH_URL` — missing means the process refuses to start, full stop, no
implicit fallback of any kind. In development/test, `BETTER_AUTH_SECRET` falls back to an explicit,
named, checked-into-source constant (`DEV_ONLY_INSECURE_SECRET`) — never Better Auth's own hidden
default — and `BETTER_AUTH_URL` stays optional. `auth.server.ts`'s `buildAuth()` now passes both
explicitly into `betterAuth({...})`, which take priority over Better Auth's own env-var fallback.
**Rationale:** Reuses the exact `requireEnv`/environment-tier pattern DEC-090/092 already established
for `DATABASE_URL` (`packages/app-services/src/db.ts`) rather than inventing a second fail-closed
mechanism — one place in this codebase decides "what's required in which tier," and Better Auth's own
guard (real, but `NODE_ENV`-based and staging-blind) is treated as defense-in-depth, not the actual
gate.
**Status:** Accepted.
**Consequences:** A staging/production `apps/ritmo` boot with either variable unset now fails
immediately and loudly (`EnvironmentConfigError`) instead of silently signing sessions with a
guessable, publicly-documented secret. No secret value is ever logged by this resolution path.

---

### DEC-098

**Date:** 2026-09-11
**Context:** Same Phase 3 fix-up. `auth.server.ts` had no `sendResetPassword` callback at all, which
makes Better Auth's own `/request-password-reset` endpoint throw `RESET_PASSWORD_DISABLED`
server-side, on every single call. Reading Better Auth's route source
(`dist/api/routes/password.mjs`) showed that error never reaches the client: it's passed through
`ctx.context.runInBackgroundOrAwait`, which (with no `advanced.backgroundTasks.handler` configured,
which this app doesn't configure) `await`s the callback inside a `try/catch` that only logs, never
rethrows. The endpoint therefore always returned `{status: true}` regardless, and
`recuperar-senha.tsx` always rendered "Verifique seu e-mail" — a fake success on every request, not
merely when delivery happens to fail. No transactional-email provider (Resend, SES, Postmark, SMTP, or
otherwise) has ever been configured anywhere in this codebase.
**Decision:** Added `apps/ritmo/src/functions/email.server.ts` as the product-owned transactional-email
boundary: `isTransactionalEmailConfigured()` (currently always `false` — reads a
`TRANSACTIONAL_EMAIL_PROVIDER` env var that nothing sets yet), `isPasswordResetAvailable(environment)`
(true in development/test unconditionally; true in staging/production only once a provider is
configured), and `sendPasswordResetEmail` (development/test: logs the real reset URL server-side only,
an honest stand-in for manual/automated testing, never a pretense that an email was sent;
staging/production: throws `PasswordResetUnavailableError` when unconfigured). Because Better Auth
swallows that throw (see above), it is NOT the enforcement point — `isPasswordResetAvailable` is.
`recuperar-senha.tsx`'s route `loader` now calls `checkPasswordResetAvailability()`
(`password-reset.ts`/`password-reset.server.ts`) BEFORE the form ever renders; when unavailable, the
page shows an honest "temporarily unavailable" state instead of collecting an email address for a flow
that cannot deliver anything — this is a global, environment-level flag, identical for every visitor,
so it leaks nothing about any individual account (the existing "always show the same confirmation"
anti-enumeration behavior inside the form itself is unchanged).
**Rationale:** The brief's own instruction was not to hardcode a specific vendor absent one already
being configured, and none is — inventing a vendor choice here would be a bigger, unreviewed decision
than a fix-up should make unilaterally. A clean boundary that fails closed in staging/production and
degrades honestly (not silently) in development/test satisfies "no fake success" without forcing that
choice prematurely.
**Status:** Accepted.
**Consequences:** **A real transactional-email provider is still required before password recovery can
work in staging/production** — this is an explicit, tracked gap, not an oversight papered over by this
fix-up. Wiring one in is: implement `isTransactionalEmailConfigured`'s real check and
`sendPasswordResetEmail`'s production branch in `email.server.ts`, set `TRANSACTIONAL_EMAIL_PROVIDER`,
document the new required env var(s) in `.env.example` — no other file changes.

---

### DEC-099

**Date:** 2026-09-11
**Context:** DEC-090 decided `apps/ritmo` should build for a plain Node runtime (`node-server`), not
the Lovable scaffold's default Cloudflare Workers target — but the actual override was never applied
to `vite.config.ts`. A state-recovery audit (this session) caught the gap by actually running the
production build and observing it still emit `wrangler.json`/a Cloudflare Worker config, contradicting
the documented decision.
**Decision:** Added `nitro: { preset: "node-server" }` to `apps/ritmo/vite.config.ts`'s
`defineConfig({...})` call — the officially-supported override surface
`@lovable.dev/vite-tanstack-config` exposes for exactly this (confirmed by reading its own
`LovableViteTanstackOptions` type, which documents `nitro.preset` as forwarded directly to `nitro/vite`
and explicitly designed for hard-pinning a deploy target). No ejection from the Lovable scaffold was
needed.
**Rationale:** Using the scaffold's own documented extension point keeps every other Lovable-provided
plugin/behavior (TanStack devtools, `VITE_*` injection, sandbox detection, etc.) intact and upgradable,
versus forking `vite.config.ts` away from `defineConfig` entirely.
**Status:** Accepted.
**Consequences:** A clean production build now emits `.output/server/index.mjs` (a plain Node ESM
entry) instead of Cloudflare Worker output, started with `node ./server/index.mjs` (per the build's own
generated `.output/nitro.json`, `commands.preview`) — deployable to Railway or any other plain Node
host, matching DEC-090. That option's own doc comment notes the override applies only OUTSIDE a
Lovable-sandboxed build (`LOVABLE_NITRO_PRESET` pins Cloudflare inside that specific sandbox) — this
codebase's own production/CI builds never set that variable, so it doesn't apply here.

---

### DEC-100

**Date:** 2026-09-11
**Context:** Same state-recovery audit flagged that `apps/ritmo/scripts/check-client-bundle.mjs`
(Sprint 8, DEC-08x) still only checked for `OPENAI_API_KEY`/`PLUGGY_CLIENT_SECRET` and three package
names (`@electric-sql/pglite`, `pluggy-sdk`, `openai`) — never extended for Sprint 9's new server-only
surface (Postgres driver, Better Auth's server-only entry points, `BETTER_AUTH_SECRET`, `DATABASE_URL`).
It happened to still pass, which is not the same as actually covering that surface.
**Decision:** Extended the script (still zero-dependency, plain Node) with: real secret VALUE checks
(when locally configured) for `BETTER_AUTH_SECRET`, `DATABASE_URL`, and `BETTER_AUTH_URL`; a literal
forbidden-name check for `DATABASE_URL`; precise server-only package/entry-point markers —
`pg-connection-string`/`pg-protocol` (node-postgres's own sub-dependencies, not the bare string `"pg"`,
which is far too generic and would false-positive constantly), `drizzle-orm/node-postgres`, and
`better-auth/adapters/drizzle`/`better-auth/tanstack-start`; and a generic pass over any local
`.env`/`.env.local` file's actual key/value pairs (skipping `VITE_`-prefixed keys, which this app's Vite
config deliberately inlines into the client bundle on purpose, and values under 12 characters, which
are ordinary tokens like `"true"` rather than meaningful secrets to search for). Deliberately did
**not** add a bare literal-name check for `BETTER_AUTH_SECRET`/`BETTER_AUTH_URL`: running the extended
scanner against a real build surfaced that `better-auth/react`'s own official client bundle legitimately
enumerates both names itself (a generic cross-runtime env-getter helper it ships with) — checking for
the bare name would be a permanent false positive against a real, client-safe dependency, not a
finding; the real VALUE checks for both remain in place.
**Rationale:** Verified empirically, not assumed: an earlier draft that checked `BETTER_AUTH_SECRET`'s
bare name and every `.env.local` value regardless of length was run against a real build first, and
both produced concrete false positives (`better-auth/react`'s own bundle; the literal boolean value of
a local `DEV_AUTH_BYPASS=true`) — both were narrowed before being kept, rather than shipping a scanner
whose first real signal would have been ignored as noise.
**Status:** Accepted.
**Consequences:** `check-client-bundle.test.ts` (new) locks in both the precision (real client-safe
Better Auth imports must never be flagged) and the coverage (the new markers/checks fire on synthetic
server-only content) as permanent regression coverage, run under `apps/ritmo`'s normal `pnpm run test`.

---

### DEC-101

**Date:** 2026-09-11
**Context:** Sprint 9 Phase 4 (onboarding + Bank Connection product experience) needs a real,
authenticated, ownership-safe way for `apps/ritmo` to drive the existing Pluggy Connect flow
(`createConnectToken`/`completeConnection`/`disconnectConnection`/`getConnections`/
`getLatestSyncRunForConnection`, all pre-existing since Sprint 3–7 — see docs/OPEN-FINANCE.md). No
Ritmo server function previously called any of this.
**Decision:** Added `apps/ritmo/src/functions/connections.server.ts` (server-only logic) +
`connections.ts` (thin `createServerFn` wrappers), following the exact `assistente.server.ts`/
`assistente.ts` split already established in Phase 3/Sprint 8. Every exported handler
(`getConnectionScreenDataHandler`, `startBankConnectionHandler`, `finishBankConnectionHandler`,
`checkSyncProgressHandler`, `removeBankConnectionHandler`) resolves `financialProfileId` itself via
`getCurrentProfileContext()` and takes no `financialProfileId` parameter at all — structurally
impossible for a caller to supply one. `toConnectionSummary` collapses the richer
`ProviderConnectionStatus` (`PENDING`/`CONNECTED`/`SYNCING`/`LOGIN_ERROR`/`USER_ACTION_REQUIRED`/
`ERROR`/`DISCONNECTED`) into three product-facing health states (`OK`/`SYNCING`/`NEEDS_ATTENTION`/
`PENDING`) — the UI layer never sees a `ProviderConnection` id described as such, an "Item," a
`clientUserId`, or a raw provider status string (brief §4). `RECONNECT_STATUSES` (which statuses map
to `NEEDS_ATTENTION`) is copied verbatim from `apps/web`'s existing `ConnectedAccountsPanel` (Sprint 7,
DEC-080) — the same product decision, not a new one. Reconnecting reuses the exact same
`startBankConnectionHandler`/`finishBankConnectionHandler` pair as a first connection, relabeled
"Reconectar" in the UI — `completeConnection`'s own (profile, provider, externalConnectionId)
idempotency (DEC-023) is what prevents a duplicate `ProviderConnection`, not new logic here.
**Rationale:** No second connection architecture — every actual Pluggy interaction still flows through
the Sprint 3–7 functions, live-validated against the real sandbox in Sprint 4.5. This file only adds
the authentication/ownership seam and a UI-safe vocabulary on top.
**Status:** Accepted.
**Consequences:** `connections.server.test.ts` (new) is a permanent adversarial suite in the same
real-Better-Auth-session style as `security.adversarial.test.ts` — independent signed-up users, a
`MockProvider` registered under the real `"pluggy"` provider name (via `registerProvider`, not a
separate mock-only path), proving: a new user's onboarding state never includes another user's
connection; a repeated `finishBankConnectionHandler` call for the same external id never creates a
duplicate; and a connection can only ever be disconnected by its own owner.

---

### DEC-102

**Date:** 2026-09-11
**Context:** Sprint 9 Phase 4 needed concrete answers to three product questions the brief left to
this implementation to decide deliberately: (1) how does a new user get routed into onboarding — brief
§8 explicitly forbids a client-only flag as that source of truth; (2) does "skip for now" exist — brief
§9 explicitly allows requiring connection instead; (3) how is a mid-session session-expiry (SESSION_
EXPIRED, brief §J) detected and shown, given the brief explicitly forbids relying on client-side-only
expiry handling.
**Decision:**
1. **Routing.** `apps/ritmo/src/routes/_protected/index.tsx` (Home) gained a `beforeLoad` that calls
   the SAME `getConnectionScreenData()` (DEC-101) the Bank Connection screen uses, and redirects to
   `/onboarding` when `hasAnyConnection` is `false` — a real, server-resolved read on every Home
   navigation, never a flag written once at signup. A connection that merely *needs attention*
   (`NEEDS_ATTENTION`) does NOT block Home — the existing alert/notification system
   (docs/ALERTS-NOTIFICATIONS.md) already surfaces that, and `/mais` (or a future Home affordance)
   routes to `/conectar-banco` to act on it.
2. **No skip in V1.** `/onboarding` (`onboarding.tsx`) offers exactly one action: "Conectar meu banco."
   Every other Ritmo screen (Home, Insights, Planejamento) is built assuming real connected-account
   data; a genuinely honest zero-data empty-state experience across all of them (brief §9's own
   condition for allowing skip: "the user must enter a real empty-data product state," never Founder
   fixture data) is real, separate, cross-cutting work this sprint did not scope — see brief §9's own
   "acceptable to require connection" allowance.
3. **Session-expired.** `getCurrentProfileContext()`'s `UnauthenticatedError` (Phase 3) is now the
   single signal two independent layers both react to, without either importing the other's
   server-only module (the exact bug class Phase 3 fixed): `apps/ritmo/src/lib/auth-error.ts`'s
   `isAuthExpiredError(error)` checks only `error.name`/`error.message` — verified against
   `@tanstack/start-server-core`'s actual server-function error path
   (`server-functions-handler.ts`: any thrown non-Response/non-redirect/non-notFound error is
   serialized via `seroval`'s `toCrossJSONAsync`, which preserves `name`/`message` across the
   client/server boundary — confirmed by reading that source directly, not assumed). Two call sites:
   `__root.tsx`'s root `errorComponent` (catches a LOADER throwing this, e.g. Home's/`conectar-banco`'s
   own loaders) renders `SessionExpiredScreen` directly, replacing the entire failed route's subtree;
   every imperative handler in `conectar-banco.tsx` (button clicks, the sync-progress poll) also checks
   `isAuthExpiredError` in its own `catch` and navigates to `/sessao-expirada` — because `_protected.tsx`'s
   `beforeLoad` only re-runs on navigation, an imperative call made without a fresh navigation (e.g. a
   poll firing after the session has since expired) would otherwise surface as an unhandled rejection
   with no clean UI response.
**Rationale:** All three follow the same principle already established in Phase 2/3: the real
enforcement/decision point is server state checked on every relevant action, with the UI layer
reacting to it — never a separate client-side source of truth that can drift from what the server
actually knows.
**Status:** Accepted.
**Consequences:** A user who disconnects their only connection is not automatically sent back to
`/onboarding` mid-session (only Home's own `beforeLoad`, i.e. the next navigation to `/`, re-evaluates
this) — acceptable for V1, revisit if it proves confusing. Skip/empty-state product work remains
explicitly open for a future sprint, not silently dropped.

---

### DEC-103

**Date:** 2026-09-11
**Context:** While live-validating Phase 4 against `apps/ritmo`'s production (`node-server`, DEC-099)
build, `node .output/server/index.mjs` crashed on its very first request — `TypeError: (void 0) is not
a function` inside the bundled `auth.server` chunk, at a `.map()` call reached during Better Auth's own
module-level initialization. Root cause: `better-auth@1.7.4` and `@better-auth/core@1.7.4` both declare
`"zod": "^4.5.4"` in their own `package.json`, but `apps/ritmo`'s own direct dependency was pinned to
`"zod": "^3.25.76"` (unchanged since before Sprint 9) — pnpm's workspace resolution gave Better Auth's
bundled code zod 3.x at runtime, whose `z.email()`/`z.toJSONSchema` (zod v4-only top-level APIs Better
Auth's schema definitions call directly) are `undefined`. This had been silently present since Phase 3
— `vite build` printed `[IMPORT_IS_UNDEFINED]` warnings for exactly these calls (noted, but assessed as
build-time-only noise in the Phase 3 report) but never actually crashed under `vite dev`, which resolves
modules differently than a bundled production build. It reliably crashed every request once actually
run as `node .output/server/index.mjs` — i.e., **DEC-099's own node-server build target did not
actually work at runtime until this fix**, independent of anything Phase 4 itself added.
**Decision:** Upgraded `apps/ritmo`'s own `zod` dependency from `^3.25.76` to `^4.5.4` — matching what
`packages/app-services` (a dependency already in the same graph) already uses, and what Better Auth
itself requires. Verified every existing Ritmo zod schema (`assistente.server.ts`'s `sendMessageInput`,
this sprint's `finishConnectionInput`/`checkSyncProgressInput`/`removeConnectionInput`) uses only the
basic `z.object({...: z.string()...})` surface, unchanged between v3 and v4.
**Rationale:** A single dependency version bump, not a Better Auth downgrade or a zod shim — the
version actually installed should match what the library the whole auth stack depends on declares,
rather than carrying a stale pin from before Better Auth was introduced.
**Status:** Accepted.
**Consequences:** A rebuilt production bundle no longer prints any `IMPORT_IS_UNDEFINED` warnings for
zod, and `node .output/server/index.mjs` now serves real sign-up/session requests successfully (verified
live). Separately, and NOT fixed by this change: running that same built server against file-backed
PGlite fails with `Can't find meta/_journal.json` — the migration SQL files aren't copied into
`.output`'s bundled directory layout. This is a pre-existing, PGlite-in-a-bundled-server packaging gap
that does not affect real staging/production (which always uses `createPostgresDatabase`/
`runPostgresMigrations` via `shouldUsePostgres`, DEC-090/092, never the PGlite migrator) — left for
Phase 6 (staging validation) to address if a bundled-server-plus-PGlite combination is ever actually
needed, which it currently is not.

---

### DEC-104

**Date:** 2026-09-11
**Context:** Phase 4 was visually approved, but the Founder's own local browser was landing on
`/onboarding` immediately, without ever reaching `/login` — reported as a functional bug to fix before
Phase 5. Root cause, traced (not guessed) through `session.server.ts`/`profile.server.ts`: 
`apps/ritmo/.env.local` (the Founder's own local dev env file, gitignored, pre-dating this fix-up) had
`DEV_AUTH_BYPASS=true`. Both `checkAuthenticatedHandler` (the `_protected.tsx` `beforeLoad` UX check)
and `getCurrentProfileContext()` (the real security boundary) contain a dev-bypass branch that, when
that flag is `"true"` and the resolved environment isn't `production`, skips the real Better Auth
session check entirely — `checkAuthenticatedHandler` always returned `{authenticated: true}`, so
`_protected.tsx` never redirected to `/login`; `getCurrentProfileContext()` always returned
`DEMO_PROFILE_ID` (the Founder/demo fixture profile), which has real fixture transactions but zero
`ProviderConnection` rows — so Home's own `beforeLoad` (Phase 4, DEC-102) correctly saw "no connection"
for that profile and redirected to `/onboarding`. **Both redirects were individually correct given
their inputs** — the bug was that `DEV_AUTH_BYPASS=true` fed the auth check a false "yes" before
onboarding's own (correct) logic ever ran. A second, latent gap found in the same audit: the bypass
condition was `resolveAppEnvironment() !== "production"`, which would ALSO have activated in a
`staging` environment — never actually triggered, but a real gap against "impossible in
staging/production."
**Decision:**
1. Set `apps/ritmo/.env.local`'s `DEV_AUTH_BYPASS` to `false` — the normal local product experience
   now exercises real Better Auth by default, as it always should have.
2. Documented `DEV_AUTH_BYPASS` in `.env.example` for the first time (it had never been documented
   there at all) — explicit warning against defaulting it on, explaining exactly what it skips.
3. Tightened the bypass condition in both `session.server.ts` and `profile.server.ts` from
   `resolveAppEnvironment() !== "production"` to an explicit `environment === "development" ||
   environment === "test"` allow-list (`isDevOrTestEnvironment()`, duplicated identically in both
   files rather than factored into `@money-copilot/config`, which stays generic/domain-agnostic per
   DEC-087) — closing the staging loophole. `assertDevOnlyFlagNotInProduction`'s own production-only
   guard is unchanged and remains a second, independent layer.
4. Added `apps/ritmo/src/functions/dev-seed.server.ts`: `ensureDevTestUserHandler()`, a
   development/test-only, idempotent provisioning function for a real login
   (`teste@ritmo.local`/`RitmoTeste123!`) — calls Better Auth's REAL `auth.api.signUpEmail`, catching
   only the specific `USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL` error as the idempotent "already
   provisioned" case (verified against `better-call`'s actual `APIError` shape, not guessed). Refuses
   outside development/test by resolving `resolveAppEnvironment()` itself, the same pattern as every
   other Sprint 9 fail-closed check. Its `FinancialProfile` is provisioned lazily on first real login,
   through the exact same `resolveOrProvisionProfileForOwner` path every real user goes through — no
   special-cased empty-profile logic exists for this account; it's empty because every brand-new
   profile is. A dev-only route (`GET /api/dev-seed`) triggers it, mirroring `/api/auth/$`'s existing
   server-route pattern.
**Rationale:** The fix is at the actual fault line (a bypass flag defaulting on locally, and its
condition being broader than intended) rather than a new redirect papering over the symptom — per
the explicit instruction not to hide the problem. The dev-seed mechanism uses Better Auth's real
password/session mechanism throughout (no fake authentication anywhere), satisfying "use the existing
real /login screen" while still being fully scriptable/repeatable for local testing.
**Status:** Accepted.
**Consequences:** New permanent regression coverage: `dev-seed.server.test.ts` (idempotency; refusal
in staging AND production specifically; the provisioned account's profile is real-Better-Auth-backed
and starts genuinely empty — zero connections, `UNKNOWN` coverage; the bypass-unset default and the
staging-exclusion fix both exercise real Better Auth) plus one new test in
`security.adversarial.test.ts` proving `auth.api.signOut` really ends a session
(`checkAuthenticatedHandler` reports unauthenticated again, `getCurrentProfileContext` throws
`UnauthenticatedError` again). Live-verified end to end against the real dev server: clean
unauthenticated → `/login`; `/onboarding` and `/conectar-banco` both refuse an unauthenticated request
(redirect to `/login`, no private content rendered first); the real test login → `/onboarding` (zero
connections) → `/conectar-banco` reachable; real `auth.api.signOut` → `/`, `/onboarding`, and
`/conectar-banco` all redirect to `/login` again.

---

### DEC-105

**Date:** 2026-09-11
**Context:** Sprint 9 Phase 5 (production hardening) requires rate limiting for AI and Open Finance
action abuse. No Redis/external infrastructure is provisioned this phase (brief §3/§24), and the
brief explicitly forbids scattering ad-hoc timers/counters across route files.
**Decision:** Added `apps/ritmo/src/functions/rate-limit.server.ts`: a single, policy-driven,
in-memory `checkRateLimit(key, policy, now?)` — one exported `RATE_LIMIT_POLICIES` object (AI
burst/sustained, Open Finance action/poll, webhook) is the one place these numbers live. Keys are
always a stable internal identifier (`financialProfileId`), never an email/IP/raw PII. `now` is
injectable for deterministic tests. A one-time `console.warn` fires in staging/production noting the
storage is process-local — **explicitly not a distributed guarantee**: multiple instances would each
enforce independent counters. Auth endpoint abuse (sign-in/sign-up/password-reset) deliberately does
NOT go through this — see DEC-108.
**Rationale:** A single, testable abstraction (rather than per-call-site counters) makes the
"process-local, not distributed" caveat something documented and warned about exactly once, and makes
every policy visible/tunable in one place, per the brief's own requirements.
**Status:** Accepted.
**Consequences:** `rate-limit.server.test.ts` proves allow/deny/window-reset/per-key-isolation/
determinism. Before scaling `apps/ritmo` beyond one instance, this needs a shared backend (Better
Auth already supports a "secondary storage" option for its own limiter — one candidate, not decided
here since that's an infrastructure decision out of this phase's scope).

---

### DEC-106

**Date:** 2026-09-11
**Context:** Sprint 9 Phase 5 requires a structured logging boundary that's safe by default — the
brief lists a long, specific set of things that must never be logged (passwords, session tokens,
cookies, every secret name in `.env.example`, connect tokens, reset-password tokens, raw financial
payloads, arbitrary prompt content).
**Decision:** Added `apps/ritmo/src/functions/logger.server.ts`: `logger.debug/info/warn/error/audit`,
each emitting one structured JSON line (`timestamp`, `environment`, `severity`, `event`, plus caller
fields) to stdout/stderr. Two independent redaction layers, both automatic — callers don't opt in:
(1) any field NAME matching a sensitive pattern (`password|secret|token|cookie|authorization|api[_-]
?key|connect[_-]?token|session`, case-insensitive) is redacted wholesale, recursively through nested
objects/arrays; (2) any string VALUE matching a known secret shape (an OpenAI-style key, a Better Auth
session cookie fragment) is redacted even under an innocuous field name. A field merely named
`"tokens"` (plural) is redacted wholesale rather than recursed into — a deliberately safer default,
not a bug (see the test that pins this down). `logger.audit(...)` is the same shape with
`severity: "audit"` — see DEC-101's connection-lifecycle calls and DEC-105's rate-limit-denial calls
for real usage.
**Rationale:** Safe-by-default redaction (name AND shape based) means a future caller doesn't have to
remember to redact anything themselves to stay safe — the boundary does it either way.
**Status:** Accepted.
**Consequences:** Audit events currently land in the same stdout/stderr stream as everything else,
distinguished only by `severity: "audit"` — real hosting platforms (Railway included) capture and
retain process output. Routing audit events to separate, longer-retention persistent storage is an
explicit Phase 6 concern (brief §13: "do not provision external log infrastructure" here), not a gap
introduced by this choice. `logger.server.test.ts` proves the redaction rules directly.

---

### DEC-107

**Date:** 2026-09-11
**Context:** Sprint 9 Phase 5's own review of Phase 3's `email.server.ts` found that a real,
usable password-reset URL (a live secret — anyone who reads it can reset that account's password) was
written to ordinary `console.log` output in development/test (DEC-098's original implementation).
Automated tests (and manual local testing) still need a way to observe reset-link generation without a
real mailbox.
**Decision:** Replaced the `console.log` call with an in-memory capture
(`getLastDevPasswordResetEmail()`/`resetDevPasswordResetCapture()`, development/test only) holding the
most recent `{to, url, capturedAt}`. A safe, tokenless confirmation (`logger.info("dev_password_reset_
captured", { environment })`) is logged instead — the event name and environment, never the URL.
**Rationale:** The capability (prove reset-link generation without a real mailbox) is preserved
exactly; only the "where does the secret briefly live" answer changes — in-memory, accessible to the
same process's own tests, never written to any log stream.
**Status:** Accepted.
**Consequences:** `email.server.test.ts` was updated to assert against the capture instead of a
`console.log` spy, and additionally asserts the literal token/URL never appears in ANY log call made
during the test — a permanent regression proof, not just a behavior change.

---

### DEC-108

**Date:** 2026-09-11
**Context:** Sprint 9 Phase 5 requires auth endpoint abuse protection (sign-in/sign-up/password-reset)
that slows brute force/credential stuffing and prevents reset-email flooding, without revealing
whether an account exists. The brief explicitly instructs reviewing Better Auth's own installed
capabilities before building duplicate logic.
**Decision:** Reading Better Auth 1.7.4's own source (`dist/api/rate-limiter/index.mjs`) found it
already ships a complete, undocumented-by-us-but-real built-in rate limiter with sane default rules
specifically for `/sign-in*`, `/sign-up*`, `/change-password*`, `/change-email*` (10s window, max 3)
and `/request-password-reset`/`/forget-password*` (60s window, max 3) — keyed by client IP via
`getIP`, never by email, so a 429 fires identically for a real or fake account. Its own default is
`enabled` only in `production`; `auth.server.ts` now passes `rateLimit: { enabled:
shouldEnableAuthRateLimit(environment), storage: "memory" }`, extending that to `staging` too (this
app treats both tiers as equally sensitive) while leaving development/test unthrottled (so the
existing adversarial suites' many rapid sign-ups are unaffected).
**Rationale:** Using Better Auth's own mechanism (rather than wrapping its endpoints with a second,
app-level limiter) means the existing anti-enumeration guarantee (identical response shape regardless
of account existence) is preserved automatically — it was already built with that property, verified
by reading the source rather than assumed.
**Status:** Accepted.
**Consequences:** **Live-verified, not just configured**: `auth-rate-limit.server.test.ts` constructs a
real Better Auth instance with the limiter forced on and drives 6 rapid sign-in attempts through
`auth.handler(request)` (the real HTTP entry point) — a 429 reliably appears. A real, load-bearing
finding from writing this test: **the rate-limit check only fires for requests through
`auth.handler(request)` — NOT for direct `auth.api.signInEmail(...)` calls**, which bypass that
router-level `onRequest` hook entirely (an earlier draft of the test called the API directly and never
observed a 429 across 6 attempts). This does not weaken the real app (its actual entry point,
`/api/auth/$`, always uses `auth.handler(request)`) but does mean every existing adversarial test file
using `auth.api.*` directly is correctly unaffected by rate limiting even when enabled. `IP`-based
keying also means: with no real IP resolvable (no request headers at all, as in a direct API call),
Better Auth logs a one-time warning and falls back to a single shared bucket across all callers for
that path — worth knowing if a future test suite's own auth calls ever seem unexpectedly cross-
contaminated. `trustedOrigins`/CORS: audited, not touched — Better Auth trusts only `baseURL`'s own
origin by default for both CSRF origin-checking and callback/redirect validation, which is exactly
what a same-origin-only app (no OAuth, no cross-origin redirect needs) wants; `baseURL` is already
`requireEnv`-validated in staging/production (DEC-097), so trusted origins already come from validated
environment config with no wildcard — explicit `trustedOrigins` config would be redundant, not
additive. CSRF: Better Auth's own origin-check middleware (confirmed live in Phase 3/4 testing — a
POST without a matching `Origin` header returns 403 "Missing or null Origin") is the real CSRF
boundary for every state-changing browser operation; no custom token/crypto was added or is needed.
Provider webhooks (DEC-111) are correctly NOT subject to this — a webhook is a server-to-server
callback, not a browser flow, and Better Auth's origin-check is not mounted on that route.

---

### DEC-109

**Date:** 2026-09-11
**Context:** Sprint 9 Phase 5's AI cost-protection review found `OpenAIProvider.generate` called
`responses.create()` with no `max_output_tokens` at all — a single copilot turn had no ceiling on
OpenAI-side cost/latency.
**Decision:** Added `DEFAULT_MAX_OUTPUT_TOKENS = 2000` to `packages/ai/src/model-config.ts` (alongside
the existing `DEFAULT_OPENAI_MODEL`, the established single home for model-tuning constants) and an
optional `maxOutputTokens` constructor option on `OpenAIProvider`, defaulting to that constant and
passed through to every `responses.create()` call.
**Rationale:** Generous enough for a real financial-assistant answer (docs/AI-COPILOT.md's own scope —
a few paragraphs plus tool calls) while giving every single request a hard ceiling; centrally defined
rather than a magic number inline, matching this file's existing convention for `DEFAULT_OPENAI_MODEL`.
**Status:** Accepted.
**Consequences:** This is a shared `@money-copilot/ai` package change — `apps/web`'s own AI usage
inherits the same ceiling. No existing test asserted the exact `responses.create()` call shape, so
this required no test updates; `packages/ai`'s suite still passes unmodified.

---

### DEC-110

**Date:** 2026-09-11
**Context:** Sprint 9 Phase 5 requires centralized production HTTP security headers (CSP, clickjacking
protection, MIME-sniffing protection, referrer policy, permissions policy, HSTS) without breaking
React/TanStack's own runtime, Better Auth, or the Pluggy Connect widget.
**Decision:** Added `apps/ritmo/src/functions/security-headers.server.ts`'s `applySecurityHeaders
(response, environment?)`, wired into `server.ts`'s existing response wrapper (the one place every
single response — SSR pages, server functions, API routes — already passes through) rather than
per-route. Skipped entirely in `development` (Vite's HMR client needs an inline-script-friendly,
websocket-connecting environment a strict CSP would break; dev is local-only, not the security
boundary this protects). Applied in `test`/`staging`/`production`. External CSP origins
(`fonts.googleapis.com`/`fonts.gstatic.com`, `connect.pluggy.ai`) were derived from the app's REAL
integrations — `__root.tsx`'s own `<link>` tags and `pluggy-connect-sdk`'s bundled source
respectively, both confirmed by reading them directly, not guessed. No wildcard anywhere in the policy.
**Rationale — a known, deliberate gap, not pretended to be solved:** `script-src` includes
`'unsafe-inline'`. TanStack Start's own SSR shell emits required inline bootstrap/hydration
`<script>` tags (confirmed in real rendered output — the `$tsr-stream-barrier` script and scroll-
restoration script observed during Phase 3/4 live testing); a strict `script-src 'self'` without it
would break hydration on every single page. A nonce-based CSP (a per-request nonce threaded into
TanStack Start's own inline scripts) would close this gap but requires deeper customization of its
document-shell rendering than this phase's scope — a real, explicitly tracked follow-up. The policy
still meaningfully restricts `frame-ancestors` (clickjacking), `object-src`, `base-uri`, and which
external origins scripts/styles/connections/frames can reach.
**Status:** Accepted.
**Consequences:** `security-headers.server.test.ts` proves the dev no-op, the production/staging
header set, HSTS gating, and that the original response status/body pass through unchanged.

---

### DEC-111

**Date:** 2026-09-11
**Context:** Sprint 9 Phase 5's webhook-integrity re-audit (brief §10) found `apps/ritmo` had NO
webhook receiver at all — only `apps/web` (`/api/webhook`, Sprint 3/4.5) did. Since `apps/ritmo` is now
the real product (Sprint 8/9) and `apps/web` is scheduled for retirement (DEC-088), this is a real gap,
not just a documentation one.
**Decision:** Added `apps/ritmo/src/functions/webhook.server.ts` + `routes/api/webhook.ts` — the SAME
`handleWebhookEvent` (`@money-copilot/app-services`, unmodified) `apps/web`'s route already calls, the
SAME shared-secret-in-URL authenticity scheme (`PLUGGY_WEBHOOK_SECRET` as a `?secret=` query param —
Pluggy documents no payload-signature mechanism for this integration, confirmed, not assumed — see
docs/OPEN-FINANCE.md "Webhook security"), plus two things `apps/web`'s route didn't have: a generous
provider-callback rate-limit ceiling (`RATE_LIMIT_POLICIES.webhook`, DEC-105) and a redacted error
response (the real error goes to `console.error`/`logger.error` server-side only; the client/caller —
Pluggy itself — gets a generic `"Webhook processing failed"` string, never the raw message).
**Rationale:** No new webhook architecture — `handleWebhookEvent`'s idempotency (claimed by Pluggy's
own `eventId`), "never trust the payload, always re-fetch canonical data" rule, and ownership
resolution (`recoverOrphanedConnection` validates `clientUserId` against a real known
`FinancialProfile`) all already satisfy the brief's integrity requirements — confirmed by re-reading
that function, not rewritten. This route is deliberately NOT behind Better Auth's origin-check/CSRF
middleware (brief §9: "do not accidentally apply browser CSRF assumptions to Pluggy webhooks") — it's
a server-to-server callback, not a browser flow.
**Status:** Accepted.
**Consequences:** `webhook.server.test.ts` proves secret enforcement, graceful handling of malformed
JSON/missing fields, rate-limiting, and that a processing failure's response body never contains
stack-trace-shaped content. This route has no public URL to actually receive traffic at yet (no
staging/production deployment exists) — a Phase 6 concern (registering the real webhook URL, including
`PLUGGY_WEBHOOK_SECRET`, at Connect Token creation time via `createConnectToken`'s existing
`webhookUrl` parameter, currently unused by `apps/ritmo`'s `connections.server.ts` — a deliberate,
documented Phase 6 wiring step, not an oversight, since there is no public URL yet to pass).

---

### DEC-112

**Date:** 2026-09-11
**Context:** Sprint 9 Phase 5 requires `/health/live` and `/health/ready` endpoints suitable for a
future Railway deployment's health-check configuration.
**Decision:** Added `apps/ritmo/src/functions/health.server.ts` + two routes,
`/api/health/live` (always `{status:"ok"}`, synchronous, zero dependency checks — "is the process
alive") and `/api/health/ready` (checks staging/production's required config via `requireEnv` and real
`getDb()` connectivity — "can this instance safely serve traffic," returning HTTP 503 when not).
Deliberately never calls OpenAI or Pluggy on a readiness check (brief §15) — both are `FEATURE_
REQUIRED`, not `BOOT_REQUIRED` (DEC-117's classification). Output is minimal: `{status, checks: {config,
database}}` — no hostname, secret, account id, or detailed internal error ever included.
**Rationale:** Matches the brief's own LIVE/READY semantic split exactly; reusing `requireEnv`
(already the fail-closed mechanism for staging/production config, DEC-090/097) rather than a second,
parallel config-validity check.
**Status:** Accepted.
**Consequences:** `health.server.test.ts` proves LIVE never fails, READY degrades safely (never
throws) when required config is missing, and the output never contains a connection string or key-
shaped value.

---

### DEC-113

**Date:** 2026-09-11
**Context:** Sprint 9 Phase 5 requires a deterministic preflight check distinguishing "cannot safely
run" (ERROR) from "boots fine but is a public-launch blocker" (WARNING) — the brief's own example: a
missing transactional-email provider must not crash the app, but must remain a tracked go-live blocker.
**Decision:** Added `apps/ritmo/src/functions/preflight.server.ts`'s `runPreflightChecks(env?,
environment?)` (pure, environment-injectable, directly testable) + `GET /api/preflight`. In staging/
production: ERRORs for each missing required variable (`DATABASE_URL`/`BETTER_AUTH_SECRET`/
`BETTER_AUTH_URL`), `DEV_AUTH_BYPASS=true` (a live tier must never honor this — DEC-104/DEC-087's own
guards would already refuse at boot; preflight catches it BEFORE deploy), an obviously-placeholder
`BETTER_AUTH_URL` (localhost/127.0.0.1) or `OPENAI_API_KEY`. A WARNING when `NODE_ENV` doesn't say
`"production"` — a real, load-bearing finding from earlier Phase 5 work: Better Auth's own rate-limiter
default and TanStack Start's own dev/prod branching key off `process.env.NODE_ENV` directly,
independent of this app's own `APP_ENV`-based `resolveAppEnvironment()`; a live tier should have both
aligned. Missing transactional email is a WARNING (`NO_TRANSACTIONAL_EMAIL_PROVIDER`), never an ERROR —
the app boots and every other screen works. Never returns a secret VALUE, only which named checks
passed/failed.
**Rationale:** A single, testable, environment-injectable function (rather than a shell script)
means the exact same logic that decides "is this deploy ready" is unit-tested directly, not only
exercised at actual deploy time.
**Status:** Accepted.
**Consequences:** `preflight.server.test.ts` proves the ERROR/WARNING split and that no secret value
ever appears in a report, even when a real one is passed in. `/api/preflight` is publicly reachable
with no additional access control — its content is deliberately secret-VALUE-free, but it does reveal
WHICH checks are configured/misconfigured (e.g., "DEV_AUTH_BYPASS_ENABLED"), a real if bounded
information-disclosure surface. Gating it behind network-level access control (VPN/IP allowlist,
matching DEC-088's own precedent for `apps/web`) or wiring it only into CI/CD rather than leaving it
publicly reachable is an explicit Phase 6 follow-up, not solved here.

---

### DEC-114

**Date:** 2026-09-11
**Context:** Sprint 9 Phase 5's dev-only-surface audit (brief §19/§20) requires proving the local dev
test login's real credentials (DEC-104: `teste@ritmo.local`/`RitmoTeste123!`) can never reach a
production client bundle.
**Decision:** Extended `check-client-bundle.mjs` with `FORBIDDEN_LITERAL_STRINGS` — both credentials,
checked unconditionally (not gated on any env var, since they're hardcoded constants in
`dev-seed.server.ts`, not something that varies per environment).
**Rationale:** Matches this script's existing pattern exactly (DEC-100) — extend the one automated,
build-time proof rather than only a stated rule.
**Status:** Accepted.
**Consequences:** `check-client-bundle.test.ts` proves both strings are in the always-checked list and
that the scanner actually flags them if present. A full rebuild was run and confirmed clean (no
regression — these constants only ever live in `dev-seed.server.ts`, a `.server.ts` file, never
reachable from client-bundled code). `DEMO_PROFILE_ID`'s use as an auth fallback was separately
confirmed structurally sound: it is only ever imported inside `profile.server.ts`'s dev-bypass branch
(`if (isDevOrTestEnvironment() && DEV_AUTH_BYPASS === "true")`), never in client-reachable code — no
additional bundle check was needed for that specific fact beyond the existing package-name/import-path
markers already in place (DEC-100).

---

### DEC-115

**Date:** 2026-09-11
**Context:** Sprint 9 Phase 5 requires migration-safety hardening before Phase 6 — preventing
destructive schema resets, avoiding accidental dev/PGlite migration behavior in production, and
reviewing the current release/migration workflow.
**Decision:** Confirmed by direct audit (grep across every exported function in
`packages/persistence`) that **no destructive schema operation exists in this codebase at all** — no
drop/truncate/reset-schema function of any kind; `runMigrations`/`runPostgresMigrations` only ever
APPLY pending migrations via Drizzle's own migrator. Added `no-destructive-migration.test.ts`: a
permanent, structural proof (asserts no exported function name matches a
drop/truncate/wipe/destroy pattern) that catches a future regression by name before it ships, not just
a one-time audit finding. Separately documented (not changed — brief §1 "preserve all current Phase
0–4 behavior"): `packages/app-services/src/db.ts`'s `initializeDb()` runs
`runPostgresMigrations(db)` automatically on every process boot when `shouldUsePostgres(environment)`
— in a multi-instance staging/production deployment, every instance would attempt this at startup.
Drizzle's own migrator tracks applied migrations in its own table, so this is not a correctness bug
under concurrent boots, only a timing/scaling one.
**Rationale:** Removing/gating the auto-migrate-on-boot behavior is real Phase 1 architecture (DEC-092)
this fix-up was told to preserve, not change; the safer, correctly-scoped Phase 5 action is to audit,
document, and structurally prove the ABSENCE of anything destructive, and recommend (not implement,
since there is no real Postgres/multi-instance deployment to test against yet — brief §17: "Do NOT run
against a real Postgres server yet") an explicit pre-deploy migration step (e.g., Railway's Pre-Deploy
Command feature) for Phase 6, decoupling "apply migrations" from "every instance's own boot" once a
real multi-instance deployment exists.
**Status:** Accepted.
**Consequences:** Founder/architecture reviewers evaluating Phase 6 should treat "add an explicit
Pre-Deploy Command migration step, separate from app boot" as a concrete Phase 6 action item, not
something this phase already solved (this WAS subsequently implemented — see DEC-117/DEC-119). `shouldSeedDatabase(environment)`'s existing disjoint-by-
construction guarantee (DEC-092: no environment where both `shouldUsePostgres` and `shouldSeedDatabase`
are true) remains unchanged and re-verified as part of this phase's full test run.

---

### DEC-116

**Date:** 2026-09-11
**Context:** Sprint 9 Phase 5 requires a dependency classification (what's required to boot vs. required
for a specific feature vs. required before public launch vs. truly optional) so a future reviewer
doesn't have to re-derive this from scratch.
**Decision:** Classified every external dependency this codebase has:

| Dependency | Classification | Why |
|---|---|---|
| `DATABASE_URL` (staging/production) | BOOT_REQUIRED | `requireEnv` throws in `initializeDb()` — the process cannot serve any request without it. |
| `BETTER_AUTH_SECRET`/`BETTER_AUTH_URL` (staging/production) | BOOT_REQUIRED | `requireEnv` throws in `buildAuth()` (DEC-097) — no request can be authenticated without them. |
| `OPENAI_API_KEY` | FEATURE_REQUIRED | Every other screen works without it; the Assistente screen returns a clear configuration-error state (Sprint 8) instead of crashing. |
| `PLUGGY_CLIENT_ID`/`PLUGGY_CLIENT_SECRET` | FEATURE_REQUIRED | Onboarding/Bank Connection returns a clear configuration-error state (`INVALID_CONFIGURATION`, `connections.server.ts`) instead of crashing; every other screen is unaffected. |
| `PLUGGY_WEBHOOK_SECRET` | OPTIONAL | Recommended (an unguessable shared secret protecting the webhook URL) but not required — `handlePluggyWebhookHandler` processes normally with no secret configured, matching `apps/web`'s existing route's own behavior. |
| Transactional email provider (none chosen yet) | GO_LIVE_REQUIRED | The app boots and every other screen works; password recovery is honestly unavailable outside development/test until one exists (DEC-098) — brief §16's own worked example. |
| Neon/a real Postgres instance | GO_LIVE_REQUIRED (Phase 6) | Required before Phase 6 staging validation; the Postgres code path is type-checked/unit-tested but has never run against a real server (DEC-092). |
| Railway/a real deployment | GO_LIVE_REQUIRED (Phase 6) | No deployment exists yet; `node-server` build target is ready (DEC-099). |
| An explicit Pre-Deploy Command migration step | GO_LIVE_REQUIRED (Phase 6) | See DEC-115 — recommended before a multi-instance deployment; implemented as `db:migrate:postgres` (DEC-117/119), wired into Railway's Pre-Deploy Command, not yet actually run against real infrastructure. |
| `DEV_AUTH_BYPASS`/`/api/dev-seed` | OPTIONAL, dev/test only | Never required for any real user; must be verifiably impossible in staging/production (DEC-104, re-verified this phase). |

**Rationale:** A single table (not scattered across a dozen files' own comments) gives a future
Founder/architecture reviewer one place to check "what actually blocks Phase 6/go-live" without
re-deriving it.
**Status:** Accepted.
**Consequences:** `/api/health/ready` and `/api/preflight` (DEC-112/113) both encode this
classification directly in their own logic (only BOOT_REQUIRED items gate readiness/preflight
success; FEATURE_REQUIRED/GO_LIVE_REQUIRED items are warnings or silent degradation, never a hard
failure).

---

### DEC-117 (supersedes part of DEC-092/DEC-115)

**Date:** 2026-09-11
**Context:** Sprint 9 Phase 6A (staging preparation) requires migrations to no longer be "hidden
inside ordinary application boot" — DEC-115 (Phase 5) had audited and DOCUMENTED this exact behavior
(`initializeDb()` calling `runPostgresMigrations(db)` on every process boot) as a real scaling concern
for a future multi-instance deployment, but deliberately left it unchanged at the time (Phase 5's own
scope was "preserve Phase 0–4 behavior"; changing boot-time migration behavior was recommended for
Phase 6, not done then). Phase 6A is that Phase 6 moment.
**Decision:** `packages/app-services/src/db.ts`'s `initializeDb()` no longer calls
`runPostgresMigrations` at all — the Postgres branch now only constructs the connection pool.
Migrations are applied EXCLUSIVELY via a new, explicit, standalone CLI:
`packages/persistence/src/migrate.ts` gained a main-module-guarded `migratePostgresCli()` (mirroring
`seed.ts`'s own `db:seed` CLI pattern exactly — same idiom, not a new one), run via
`pnpm --filter @money-copilot/persistence run db:migrate:postgres`. It calls `requireEnv("DATABASE_URL")`
then `runPostgresMigrations` — nothing else; no seeding, no reset capability exists to call even by
accident (confirmed by DEC-115's own structural test). Exits non-zero on any failure — never prints
the connection string, only the driver's own error. Development/test PGlite behavior is UNCHANGED —
`initializeDb()`'s PGlite branch still migrates (and, in dev/test, seeds) on every boot, exactly as
before; that path has no multi-instance concern to guard against.
**Rationale:** This is the correct Railway "Pre-Deploy Command" pattern (Railway's current terminology
for a one-shot step that runs before a new deploy starts receiving traffic — an earlier version of this
document called it a "release command"; corrected in the Phase 6A runtime-check pass): migrate once,
before new instances start receiving traffic — never per-instance, which is what made the old behavior
racy under concurrent boots. Reusing `seed.ts`'s exact CLI idiom (a main-module guard in the same file
as the exported function, run via `tsx`) means no new pattern was introduced for this.
**Status:** Accepted — supersedes DEC-092's/DEC-115's "migrations run automatically on Postgres boot"
description; that was correct for its time and is now explicitly changed, not silently drifted from.
**Consequences:** A real, unavoidable side effect discovered while making this change: `getDb()` alone
no longer proves real Postgres connectivity (a `pg.Pool` connects lazily) — DEC-118's `/api/health/
ready` improvement (`db.execute(sql\`select 1\`)`) closes exactly this gap, in the same turn, not left
open. **A staging/production boot against a database whose schema is not already current will now
fail loudly on its first real query** — this is intentional (never silently serve traffic against a
stale/partial schema) but means the exact deploy ordering (migrate, THEN start new instances) matters
operationally — see the Phase 6A staging plan for the concrete Railway wiring. `apps/ritmo/package.json`
gained a direct `drizzle-orm` dependency (previously only transitive via `@money-copilot/persistence`)
so `health.server.ts` could import `sql` directly.

---

### DEC-118

**Date:** 2026-09-11
**Context:** Sprint 9 Phase 5's own review flagged `/api/preflight` as publicly reachable with no
access control — its report is secret-VALUE-free but reveals WHICH checks are configured/
misconfigured (e.g. "DEV_AUTH_BYPASS_ENABLED"), real if bounded information disclosure. Phase 6A
requires resolving this before staging is provisioned.
**Decision:** Added `isPreflightAccessAllowed(providedSecret, env?, environment?)` to
`preflight.server.ts`: always allowed in development/test (no operational secret exists there, and
it's local-only); in staging/production, allowed ONLY with an exact match against a new
`PREFLIGHT_SECRET` operational secret (sent as an `X-Preflight-Secret` header) — **unavailable by
default**: if `PREFLIGHT_SECRET` itself is unset in a live tier, every request is refused, including
one bearing a header value (never silently compares against `undefined`). The route returns a plain
404 on refusal, not 401/403, so it never confirms its own existence to an unauthenticated caller.
**Rationale:** The simplest of the three architecturally-acceptable options the brief offered
(unavailable / secret-protected / internal-path-only) that doesn't require any new infrastructure or
network-topology assumption (an internal/admin-only deployment path would need a real reverse-proxy
rule this codebase doesn't control) — a single new optional operational secret, entered directly in
Railway's own environment variable UI (never pasted into chat), following the exact same
"leave unset in dev, required and validated in a live tier" shape every other Sprint 9 secret already
uses.
**Status:** Accepted.
**Consequences:** `preflight.server.test.ts` proves all three cases (dev/test always open;
unconfigured secret in a live tier always refuses; configured secret requires an exact match).
`PREFLIGHT_SECRET` is documented in `.env.example`, left unset there (per the "never commit a value"
rule every other secret in that file already follows).

---

### DEC-119

**Date:** 2026-09-11
**Context:** Sprint 9 Phase 6A's own correction pass flagged that a single `DATABASE_URL` serving
both the running application and the migration command is unsafe: Neon's pooled connection (the right
choice for a long-lived Node process making many short queries — DEC-090) is documented as less
predictable for DDL/migration workloads than a direct connection.
**Decision:** Split into two variables. `DATABASE_URL` — Neon's **pooled** connection string, read
ONLY by the running application (`packages/app-services/src/db.ts`'s `initializeDb()`, unchanged).
`DATABASE_DIRECT_URL` — Neon's **direct** (unpooled) connection string, read ONLY by the migration CLI
(`packages/persistence/src/migrate.ts`'s new `resolveMigrationConnectionString()`, which calls
`requireEnv("DATABASE_DIRECT_URL")` — never `DATABASE_URL`, even if the latter happens to be set).
`preflight.server.ts`'s required-variable check now includes `DATABASE_DIRECT_URL` alongside
`DATABASE_URL` for staging/production — its absence fails the release/migration step, which blocks
deployment just as surely as a missing `DATABASE_URL` would, even though the running app itself never
reads it.
**Rationale:** The two connections serve genuinely different workloads (many short pooled queries vs.
one long DDL-running session) and should never be assumed interchangeable — making them two distinctly
named variables, each read by exactly one code path, removes any ambiguity about which one a given
process needs.
**Status:** Accepted.
**Consequences:** `migrate.test.ts` proves `resolveMigrationConnectionString` reads
`DATABASE_DIRECT_URL` specifically (not `DATABASE_URL`, even when both are set) and fails closed,
clearly, when it's absent — verified live against both a completely missing variable and an
unreachable host (neither hung, neither printed the connection string). `.env.example` and the Phase
6A Railway/Neon plan both now document exactly which Neon connection string goes in which variable.

---

### DEC-120

**Date:** 2026-09-11
**Context:** Phase 6A's correction: the Founder has already selected Resend (Phase 5/6A's own
recommendation list named it first) — the transactional-email boundary (DEC-098) was ready to receive
a provider; this decision wires it in.
**Decision:** Added `apps/ritmo/src/functions/email-resend.server.ts`: a narrow `ResendEmailClient`
interface (`emails.send(...)`) the real `Resend` SDK satisfies structurally, `createResendClient
(apiKey)` (the only place `new Resend(...)` is ever constructed), `renderPasswordResetEmailHtml
(resetUrl)` (a minimal, Ritmo-branded template — name/identity, clear purpose, a CTA button, an
"ignore if not requested" line, NO financial data, and an honestly-real "expires in 1 hour" line —
Better Auth's own actual default `resetPasswordTokenExpiresIn`, confirmed by reading its source, not
invented), and `sendPasswordResetEmailViaResend` (throws a normalized `PasswordResetDeliveryFailedError`
on any provider failure — only the bounded `error.name` enum is ever logged, never Resend's free-text
`error.message`, never the reset URL/token). `email.server.ts`'s `isTransactionalEmailConfigured` now
requires ALL THREE of `TRANSACTIONAL_EMAIL_PROVIDER === "resend"`, `RESEND_API_KEY`, and
`TRANSACTIONAL_EMAIL_FROM` — the provider name alone is deliberately NOT sufficient (brief §D: "if
provider=resend but API key or FROM is missing... password reset must remain honestly unavailable and
preflight must report it as a GO_LIVE blocker" — both now true by construction). `sendPasswordResetEmail`
gained an injectable `createClient` parameter (default: the real constructor) so every test uses a
fake `ResendEmailClient` — no test in this codebase makes or requires a live Resend account or network
call.
**Rationale:** The exact same provider-neutral seam DEC-098 built is what makes this a small, contained
change — `auth.server.ts` and every route are completely unaware Resend exists; only
`email.server.ts`'s own two functions changed. Dependency injection for the client (rather than only
mocking the module) keeps the test suite fast and hermetic without needing a network-mocking library.
**Status:** Accepted.
**Consequences:** `email-resend.server.test.ts` (6 tests) and `email.server.test.ts`'s expanded Resend
describe block (5 tests, all against a mocked client) are the permanent regression proof — no real
Resend account exists or is required for CI to pass. The `resend` npm package (a real dependency, not
an account) was added to `apps/ritmo/package.json`; `check-client-bundle.mjs` gained a precise marker
for it (`"resend-node:"`, the SDK's own internal user-agent prefix — not the bare word "resend," which
collides with plausible UI copy like "reenviar"). Domain verification in Resend's own dashboard (a
Resend-side action, not code) remains required before `RESEND_API_KEY`/`TRANSACTIONAL_EMAIL_FROM` can
be real — not done in this turn, per "do not require a live Resend account yet."

---

### DEC-121

**Date:** 2026-09-11
**Context:** Phase 6A's correction: the Pluggy webhook URL boundary requested in the prior turn's plan
was never actually implemented — `connections.server.ts`'s `createConnectToken` call still omitted the
`webhookUrl` parameter entirely, meaning even once a real staging URL exists, nothing would register a
webhook against it without a further code change.
**Decision:** Added `apps/ritmo/src/functions/webhook-url.server.ts`'s `resolveWebhookUrl(env?)`:
returns `undefined` when no public base URL is configured (the current local-dev state — matches
docs/OPEN-FINANCE.md's documented "Local development caveat," webhooks cannot reach localhost anyway),
otherwise builds `${BETTER_AUTH_URL}/api/webhook` with `?secret=${PLUGGY_WEBHOOK_SECRET}` appended when
that secret is configured. Wired into `startBankConnectionHandler`'s `createConnectToken` call, which
previously passed no `webhookUrl` at all.
**Rationale:** Reuses `BETTER_AUTH_URL` — already `requireEnv`-validated in staging/production
(DEC-097) — as "this app's own validated public base URL" rather than inventing a second
`APP_BASE_URL`-shaped variable; the exact same concept `apps/web` used `NEXT_PUBLIC_APP_URL` for
(docs/OPEN-FINANCE.md). This means the real webhook URL starts being registered automatically the
moment a real `BETTER_AUTH_URL` exists (Phase 6B) — no further code change needed then.
**Status:** Accepted.
**Consequences:** `webhook-url.server.test.ts` proves the undefined-locally case, correct URL
construction with and without the secret, and correct handling of a trailing slash on the base URL.
Still does not call Pluggy and does not require a real staging URL to exist — exactly the "prepare the
code" scope this turn asked for, nothing further.

---

### DEC-122 (superseded by DEC-123 — see that entry)

**Date:** 2026-09-11
**Context:** Phase 6A's correction requires an explicit, repository-level Node version pin suitable for
pnpm, Railway, TanStack/Nitro, Better Auth, and `pg` — the prior `"node": ">=20"` in the root
`package.json` was too loose to be "explicit."
**Decision:** Added `.nvmrc` (`26`) at the repository root and tightened the root `package.json`'s
`engines.node` from `">=20"` to `"26.x"` — the exact major version this entire Sprint 9 body of work
(every typecheck/lint/test/build run across all ten phases/fix-ups) has actually been validated
against, per the explicit instruction not to arbitrarily change major runtime beyond what's already
been proven to work. Railway's Nixpacks builder reads both `.nvmrc` and `engines.node` to select a
Node version, so both are set for redundancy/clarity rather than relying on either alone.
**Rationale:** "Explicit" per the brief means a real, validated major version — not a permissive
range — while still allowing patch/minor updates within that major (a full patch pin would need
updating on every Node security release, which buys no real safety here).
**Status:** Accepted.
**Consequences:** A future Node major upgrade (e.g., to whatever becomes the next LTS) is a deliberate,
separately-validated decision — re-running the full quality-gate suite against the new version before
changing this pin — not an incidental side effect of some other change.

---

### DEC-123 (supersedes DEC-122)

**Date:** 2026-09-11
**Context:** DEC-122 pinned Node `26.x` on the reasoning "the exact version this work was validated
against." A Phase 6A review correctly flagged that this was the wrong criterion: as of this sprint's
own timeline (2026-09), Node 26 is the CURRENT release line, not yet LTS — Node 24 is the active LTS.
The brief's actual requirement was an explicit, SUPPORTED LTS runtime, not merely "whatever the
Founder's local machine happened to have installed." Using a non-LTS Current release for a staging/
production pin would mean losing security-patch support on a shorter, unpredictable timeline.
**Decision:** Installed Node 24 (`24.20.0`, the latest available patch, via a keg-only Homebrew
formula — `node@26` stayed the linked/default local version, untouched) and re-ran the ENTIRE quality
gate suite against it before changing anything: `pnpm install --frozen-lockfile`, `pnpm -r run
typecheck`/`lint`/`test` (all three packages/apps, all 777 tests), a full production build from the
monorepo root, a live-started production server (confirmed via `lsof` to be the real
`/opt/homebrew/Cellar/node@24/24.20.0/bin/node` binary, not a stale/wrong process) serving real
`/api/health/live` requests, and the migration CLI both against a missing `DATABASE_DIRECT_URL` and an
unreachable host. **Every single check passed identically to Node 26** — TanStack Start/Nitro, Better
Auth (including the real-HTTP-handler rate-limit test), zod 4, `pg`/Drizzle (including the PGlite-
backed test suites), the Resend adapter, and the migration CLI all showed zero Node-24-specific
issues. `.nvmrc` changed from `26` to `24`; root `package.json`'s `engines.node` changed from `"26.x"`
to `"24.x"`.
**Rationale:** Validate-then-pin, not pin-then-hope: the brief explicitly warned against reverting to
Node 26 "silently" if 24 failed — since it didn't fail anywhere, the correct, tested choice is the
actual LTS line, not the Current one this session's local environment happened to default to.
**Status:** Accepted — DEC-122 is superseded, not deleted; its reasoning (validate before pinning) was
sound, only its criterion (local-machine version instead of the LTS requirement) was wrong.
**Consequences:** One pre-existing, PGlite-specific gap was re-confirmed (not caused by this change):
running the BUNDLED production server (`node apps/ritmo/.output/server/index.mjs`) against file-backed
PGlite still fails with the same `ENOENT`/migration-file-packaging issue DEC-103 already documented —
identical under both Node 24 and Node 26, irrelevant to real staging/production (which always uses
Postgres via `DATABASE_URL`/`shouldUsePostgres`, never PGlite). No code change was made for this; it
remains a documented Phase 6 non-issue. Railway's Nixpacks builder will select Node 24 from either
`.nvmrc` or `engines.node` — both are set, matching DEC-122's original redundancy rationale.

---

### DEC-124

**Date:** 2026-09-11
**Context:** Phase 6B (real staging infrastructure) is paused. The Founder wants to personally pilot
Ritmo against their own REAL bank first, but entirely locally: local PGlite, real Better Auth, no Neon/
Postgres/Railway, no public webhook, no ngrok/tunnel. This needed an explicit, narrow, hard-to-trigger-
by-accident way to switch Pluggy from sandbox to real institution connectors without touching
`AppEnvironment` (development/test/staging/production) at all — conflating "which tier is running" with
"is this Open Finance data real" would make it impossible to later run a real staging deployment against
sandbox connectors, the actual near-term plan.
**Decision:** Added `apps/ritmo/src/functions/open-finance-mode.server.ts`'s `OpenFinanceMode` type
(`"sandbox" | "live"`) and `resolveOpenFinanceMode(env?)`, defaulting to `"sandbox"` everywhere. It
resolves to `"live"` ONLY when all three hold simultaneously: `resolveAppEnvironment()` is exactly
`"development"` (staging/production have no override — there is no environment-variable combination
that escapes this), `OPEN_FINANCE_MODE=live` (exact string match), AND `FOUNDER_LIVE_BANK_PILOT=true`
(a second, independent flag, so a stray `OPEN_FINANCE_MODE=live` copy-pasted from another `.env` file
can never alone activate real-bank behavior). Wired through: `ConnectWidget.tsx`'s `includeSandbox` prop
is now caller-supplied (was hardcoded `true`) — `conectar-banco.tsx` passes
`openFinanceMode === "sandbox"`; `ConnectionScreenData` now carries `openFinanceMode` (server-resolved,
never client-supplied, same pattern as `hasAnyConnection`); `connections.server.ts` gained
`requestManualSyncHandler`, reusing the existing `syncConnection` pipeline unmodified (no second sync
engine, no polling loop) — the only way to refresh a locally-connected real bank, since no public
webhook can reach `localhost`; `webhook-url.server.ts`'s `resolveWebhookUrl` now has an explicit
`environment !== "staging" && environment !== "production"` early return, so it can never build a URL
in development/test even if `BETTER_AUTH_URL` happens to be set (previously it only returned `undefined`
incidentally, because `BETTER_AUTH_URL` was unset locally — DEC-121). The Bank Connection screen shows a
dev-only "Banco real — piloto local" pill and a non-destructive warning banner (never auto-deletes
anything) when Live mode is active and the profile already has connections, so mixing sandbox test data
and a real bank on one profile is a deliberate, informed choice rather than a silent one.
**Rationale:** Two independent explicit opt-in flags plus an environment check with no override
mirrors `DEV_AUTH_BYPASS`'s fail-closed shape (DEC-104) while being strictly harder to trigger by
accident (three conditions, not one), matching the brief's requirement that staging/production can
never inherit this under any circumstance. Reusing `syncConnection`/the existing Connect flow rather
than building a parallel "live mode" pipeline keeps this a thin, deletable layer over Sprint 3–7's
existing Pluggy architecture, not a second Open Finance integration.
**Status:** Accepted. No real bank was connected as part of this change — `PLUGGY_CLIENT_ID`/
`PLUGGY_CLIENT_SECRET` in `apps/ritmo/.env.local` remain Sandbox credentials; the Founder enters real
credentials and performs the first real Pluggy Connect consent manually.
**Consequences:** `open-finance-mode.server.test.ts` (mode resolution: default sandbox, all-three-flags-
required, staging/production never override, ignores `DEV_AUTH_BYPASS` entirely, never activates in a
real `test`-environment run even with matching flags/credentials present) and additions to
`connections.server.test.ts` (`openFinanceMode` surfaces as `"sandbox"` in the real automated test
environment even with real-looking Pluggy credentials set; manual sync is ownership-checked exactly
like every other handler here — a forged `connectionId` from another user is rejected) and
`webhook-url.server.test.ts` (webhook URL stays `undefined` in development/test even when
`BETTER_AUTH_URL` is set, unchanged staging/production behavior) cover this. `check-client-bundle.mjs`
re-run clean against the new client code (`ConnectWidget`'s new prop, the new pill/banner) — no
`PLUGGY_CLIENT_SECRET` value or server-only package reached the client bundle.

---

### DEC-125

**Date:** 2026-09-14
**Context:** Founder review of the Mais/Planejamento functional work also flagged two unresolved
branding gaps: (1) after entering the authenticated product, the Ritmo name is nearly absent — the
wordmark only appears on Auth screens and the Mais footer; (2) the Founder suspects `RitmoMark.tsx`'s
inline SVG may be a Lovable-era recreation approximating the brand board rather than the actual
official exported asset, and asked for this to be re-audited rather than assumed correct.
**Decision:** (1) Added a small, subtle brand signature — the existing `RitmoMark` symbol plus a
compact "Ritmo" wordmark label — to the Home screen's header only (`_protected/index.tsx`), replacing
the previously symbol-only mark there. No other authenticated tab (Transações/Planejamento/
Insights/Assistente) gained new branding — the brief was explicit that repetition, not absence, was
the wrong failure mode to correct into. Mais's existing footer mark/tagline was left as-is (already an
acceptable "institutional/about" presence). (2) Audited the entire repository, including git history,
for any official exported logo file (`.svg`/`.png`/`.ai`/`.fig`/`.pdf`) — none exists.
`apps/ritmo/README.md`'s own original Lovable prompt confirms the mark was never an extracted asset:
it instructs an AI UI generator to "use the attached image as the main brand and visual identity
reference," and that reference image itself was never checked into the repository. Per the Founder's
explicit instruction, the mark was **not** redrawn or "improved" — doing so would repeat the exact
mistake being corrected (an approximation presented as official). Instead: created
`apps/ritmo/public/brand/` as the canonical asset boundary, with a `README.md` documenting exactly
which four files are needed (`ritmo-symbol-light.svg`, `ritmo-symbol-dark.svg`,
`ritmo-logo-light.svg`, `ritmo-logo-dark.svg`) and how `RitmoMark`/`RitmoWordmark` should consume them
once supplied; updated `RitmoMark.tsx`'s own doc comment to state plainly that its current paths are
an unverified placeholder, not canonical. The light/dark color treatment established in DEC-124
(two-tone light vs. monotone violet dark) is unchanged — no new or alternate geometry was introduced
anywhere.
**Rationale:** Placement (brand frequency) and authenticity (source-of-truth asset) are independent
problems — blocking the first on the second would leave a real, actionable, zero-risk fix (adding the
existing symbol+wordmark to one more screen) undone for no benefit, while the second genuinely cannot
be resolved without Founder-supplied source files and must not be guessed at.
**Status:** Accepted. Item (2) is explicitly incomplete pending the Founder's real asset files — this
is a known, documented gap, not a silent omission.
**Consequences:** Once real brand files exist at `apps/ritmo/public/brand/`, `RitmoMark`/`RitmoWordmark`
need a small, mechanical update to render them (e.g. `<img src="/brand/ritmo-symbol-light.svg">`,
switched by theme) instead of the current inline paths — everywhere that already uses `RitmoMark`/
`RitmoWordmark` (Auth screens, Home, Mais footer) picks up the real asset automatically once that one
component changes, with no call-site changes needed.

**Update (2026-09-14) — item (2) resolved, V1 canonical assets installed:** the Founder supplied four
files as the replacement asset set; auditing them (`file`/`sips`/raw byte inspection) found they were
**not SVGs at all** — raster PNGs with a `.svg` extension, each carrying embedded C2PA content-
provenance metadata whose one genuine embedded vector fragment turned out to be OpenAI's own
attribution icon (unrelated to the Ritmo mark). Per this DEC's own instruction to stop rather than
guess, that set was rejected without being wired in or edited — see the "History" section of
`apps/ritmo/public/brand/README.md` for the full detail. The Founder confirmed the rejection and
supplied a second set — real PNGs derived directly from the brand board, explicitly **not** AI-redrawn,
with no original vector master existing at all. These are now the accepted V1 canonical assets.
`RitmoMark`/`RitmoWordmark` were updated to render them as plain `<img>` elements (theme-selected
`src`, no CSS recoloring/filtering/geometry changes) — the exact "small, mechanical update" this DEC
anticipated. The favicon now derives from `ritmo-symbol-light.png` (replacing the interim hand-authored
`favicon.svg`, which was deleted). `RitmoMark.tsx`'s doc comment and `public/brand/README.md` were
both rewritten to describe this as the current, accepted state rather than a pending placeholder.
**Status is now fully Accepted** — no part of this DEC remains outstanding.

---

### DEC-127

**Date:** 2026-09-15
**Context:** Founder investigation of a real Pluggy Sandbox connection (checking account balance
R$35.995,75, a real +R$8.500 salary transaction on 2026-09-05) found Home showing "Entradas do mês =
R$0,00", "Já comprometido = R$0,00", and a negative Safe-to-Spend, plus a frozen "Hoje, 05 de setembro"
regardless of the real date. Root-cause investigation (a separate, read-only, no-code-change turn)
found: (1) "Entradas do mês" read `snapshot.income.gross` — the sum of the DECLARED `incomes` table — a
forward-looking planning input, never derived from real transactions; a real user (bank-connected or
not) had no way to ever populate it, since no `createIncome` mutation/tool existed anywhere in the
codebase (the only writer was `seed.ts` fixture data). (2) "Já comprometido" read the DECLARED
`fixed_expenses` table for the identical reason. (3) `apps/ritmo/src/functions/config.ts` exported
`ASOF_DATE` as a hardcoded literal ("2026-09-05", a Sprint 8 demo snapshot), never a real clock.
**Decision:**
1. **Home's "Entradas do mês" now means REALIZED income** — real posted transactions this month with
   `financialEffect === "INCOME"` (`queries.getRealizedIncomeForProfile`, new). The `incomes` table and
   `buildFinancialSnapshot`'s formula are UNCHANGED — `income.gross` still means declared/expected
   income for Safe-to-Spend, and Planejamento's "Entradas previstas" still correctly shows it; only
   Home's own label was reading the wrong table for what it claims to show.
2. **Declared `Income` is now a real, user-facing concept**: `mutations.createIncome`/`updateIncome`
   (mirroring `createFixedExpense`/`updatePlannedFinancialEvent`'s exact shapes) plus copilot tools
   `createIncome`/`createFixedExpense` (the latter previously had a service function but no tool) and
   two new READ tools, `getRecurringIncomeCandidates`/`getRecurringFixedExpenseCandidates`
   (`queries.ts`), which filter transactions by `financialEffect` (INCOME / CONSUMPTION respectively)
   before reusing `detectRecurringCandidates` unchanged — the exact same filter-then-reuse pattern
   `generateRecommendationCandidates` already established for the (unrelated) recurring-cost case.
   **Nothing auto-creates an `Income`/`FixedExpense` from a transaction or from a candidate** — both
   MUTATION tools are gated by the orchestrator's existing `hasExplicitMutationIntent`, identically to
   every other mutation tool; a candidate is evidence the AI may proactively surface as a question
   ("Detectei um recebimento recorrente de R$8.500 — é seu salário?"), never treated as confirmed.
3. **Safe-to-Spend's formula in `buildFinancialSnapshot` was deliberately NOT changed.** Its existing
   split — declared `income`/`fixedExpenses`/`events` (future/planned) vs. real `transactions`'
   `actualSpending` (past/realized, consumption-side only) — already matches the desired PASSADO vs.
   FUTURO separation exactly; the bug was Home's *display* layer reading the wrong field under a
   misleading label, not the engine's math. No formula line changed.
4. **Removed `ASOF_DATE` as a hardcoded literal.** New `packages/config/src/clock.ts` exports
   `todayIsoDate(timeZone?, now?)`/`isoDateInTimeZone(date, timeZone?)` — pure, timezone-correct
   (`Intl.DateTimeFormat` with an explicit IANA zone, never the host process's local zone or bare UTC),
   both parameters injectable so tests are fully deterministic and a future per-user timezone is a
   parameter, not a rearchitecture. `apps/ritmo/src/functions/config.ts`'s `ASOF_DATE` constant became
   `resolveAsOfDate(now?)`, computed fresh on every call, defaulting to the real clock in
   `America/Sao_Paulo` (the MVP's fixed default). Every real call site already threaded an explicit
   `asOfDate: string` parameter through pure functions, so this needed no downstream signature changes
   — only replacing the one frozen source. `planejamento-ia.server.ts`'s AI instructions (which
   interpolated `ASOF_DATE` into a module-level constant string, frozen at server-boot time) were
   restructured into a `buildInstructions(asOfDate)` function called per-request.
**Rationale:** Realized vs. declared/expected are genuinely different questions — a report of "what
already happened" and a plan of "what I expect/commit to" — and conflating them (as Home's field names
already implied they should be distinct, but the code didn't honor) is what produced the exact
Founder-visible bug. Fixing Home's read without ever silently populating `incomes`/`fixed_expenses`
preserves the explicit-confirmation principle (docs/AI-COPILOT.md) while making Home usable
immediately after a bank connection, before any manual declaration exists.
**Status:** Accepted.
**Consequences:** New tests: `packages/config/src/clock.test.ts` (timezone correctness, injectability);
`queries.test.ts` (`getRealizedIncomeForProfile`/`getRecurringIncomeCandidates`/
`getRecurringFixedExpenseCandidates` — effect filtering, month filtering, "never reads `incomes`");
`mutations.test.ts` (`createIncome`/`updateIncome` — persistence, defaults, Safe-to-Spend impact,
independence from realized income); `sync.test.ts` (a real sync importing an INCOME-effect and a
CONSUMPTION-effect transaction never changes `incomes`/`fixed_expenses` row counts); `tools.test.ts`/
`tool-schema-strict-mode.test.ts` (the four new tools registered, correctly classified, OpenAI-strict-
mode-valid). No existing test needed a behavior change beyond the two apps/ritmo test files that
already depended on `ASOF_DATE`'s value, which now construct it via `resolveAsOfDate(new Date(...))`
with an explicit injected instant instead of importing a literal — demonstrating the same
injectability the new clock module provides, and avoiding any future flakiness as real time passes.

**Update (2026-09-15) — branch/deploy separation, not a reversal of this decision:** the Founder
discovered Railway's staging and production environments were both deploying from `main`, so this
commit reached production unvalidated. This DEC's technical decision is unaffected: `main` was reverted
back to pre-DEC-127 (a clean `git revert`, not a rewrite) purely to remove it from production pending
staging validation; a new `staging` branch was created at the DEC-127 commit and pointed at Railway's
staging environment so the fix can be validated for real before being promoted back to `main`. See
DEC-128 for the sync-layer bug this validation surfaced, and for the branch/environment separation
itself. This DEC stays **Accepted** — nothing about the realized-income/clock design was wrong.

---

### DEC-128

**Date:** 2026-09-15
**Context:** Validating DEC-127 against the real Railway staging environment (Neon-backed, a genuine
Pluggy Sandbox connection already `CONNECTED`) surfaced that Home still showed "Entradas do mês =
R$0,00" — not because DEC-127's read logic was wrong, but because the salary transaction
(`SALARIO EMPRESA XYZ LTDA`, +R$8.500,00, 2026-09-05) had never actually reached
`financial_transactions` in Neon at all. `getRealizedIncomeForProfile` was reading the right table; the
table was simply missing the row. Root-caused in `packages/app-services/src/sync.ts`: Pluggy reports a
newly-created Item's status as `UPDATING`/`MERGING` (mapped to `"SYNCING"`,
`packages/open-finance/src/pluggy/status.ts`) while it is still assembling account/transaction data —
a normal, documented Pluggy behavior. `syncConnection` ignored this: if `provider.listAccounts()` ran
before the Item finished (the Connect widget's `onSuccess` calls `completeConnection` -> `syncConnection`
synchronously, immediately after the widget closes — no wait for readiness), it returned `[]`, and with
zero accounts and zero errors the old status ternary resolved to `"SUCCEEDED"`, which then stamped
`lastSuccessfulSyncAt = now`. Every later sync (including a correctly-configured `item/updated`
webhook, once the Item actually finished) used that watermark as an incremental `since` cutoff —
permanently excluding any transaction dated before it, i.e. every transaction that existed before the
connection finished the first time. This is a structural bug, not staging-specific; it did not
reproduce locally only because of timing.
**Decision:**
1. **A provider Item still `SYNCING` with nothing imported is never `"SUCCEEDED"`.** Reused the
   existing (previously unused) `SyncRunStatus` value `"PENDING"` rather than adding a new enum member
   — `!anySucceeded && providerStillUpdating -> "PENDING"`. A later webhook or manual refresh retries
   normally; nothing about this label change affects persistence.
2. **`lastSuccessfulSyncAt` only advances when `anySucceeded` is true** (at least one account was
   actually processed without error) — replacing the previous `status !== "FAILED"` check, which let a
   zero-account, zero-error attempt (provider not ready, or a connection with genuinely zero accounts)
   silently stamp the watermark anyway.
3. **Self-healing per payment source, not just forward-looking.** A connection whose watermark was
   already poisoned before this fix (staging's real connection) cannot be fixed by (1)+(2) alone — the
   bad timestamp is already persisted. `syncConnection` now checks
   `repo.hasAnyTransactionForPaymentSource` (new, `packages/persistence`, an indexed `LIMIT 1`
   existence check — never loads a row) before applying `since` to that specific payment source; a
   source with zero persisted transactions always gets a full pull regardless of the connection's own
   watermark. Once a source has at least one real transaction, it returns to normal incremental
   behavior. This is what lets the existing, already-`CONNECTED` staging connection recover the missing
   salary transaction on its very next sync — no manual backfill, no direct database write.
4. **Idempotency unchanged, proven in tests.** `findTransactionByExternalId`/`findPaymentSourceByExternalId`
   remain the only dedup keys; full sync -> incremental sync -> repeated sync never duplicates a row
   (`sync.test.ts`, "transaction idempotency" describe block).
5. **Manual "Sincronizar agora" is no longer limited to the local Live pilot mode**
   (`apps/ritmo/src/routes/_protected/conectar-banco.tsx`) — any healthy connection can be manually
   resynced by its owner. The server function (`requestManualSyncHandler`) and its ownership check,
   per-profile rate limit, and UI-level `syncing` disabled-state already existed and needed no new
   infrastructure — only the `isLivePilot` gate around rendering the button was removed.
6. **Webhook handling (`webhook.ts`, `webhook.server.ts`) was not modified** — idempotency (claimed by
   Pluggy's own `eventId`), the "never trust the payload, always re-fetch via `syncConnection`" rule,
   and the shared-secret authenticity check were already correct. New tests added instead, including
   the DEC-128-specific case: a `SYNCING` webhook delivery never poisons the watermark, and a later
   `item/updated` delivery once `CONNECTED` recovers the data the first one missed.
**Rationale:** The bug was a race between the provider's own async data assembly and this
application's optimistic "one sync attempt is either fully successful or fully failed" assumption.
Fixing the watermark logic (1+2) prevents any *new* connection from being poisoned; the per-source
existence check (3) is what makes an *already*-poisoned real connection (staging's) self-heal through
the real pipeline, honoring the constraint that no data may be inserted by hand.
**Status:** Accepted.
**Consequences:** New tests in `sync.test.ts` (provider-still-updating status/watermark behavior,
self-healing backfill, return-to-incremental behavior, transaction idempotency across full/incremental
syncs, provider-outage error handling and retry, no data loss on failure) and `webhook.test.ts`
(SYNCING webhook doesn't poison the watermark; a later CONNECTED webhook recovers the data). `MockProvider`
(`packages/open-finance`) gained an optional `status` constructor field so tests can simulate a
still-updating provider Item without adding failure-injection knobs to `syncConnection` itself. No
change to `buildFinancialSnapshot`, Pluggy transaction classification, or Home's own read logic
(DEC-127) — this is entirely a sync-layer correctness fix.

---

### DEC-129

**Date:** 2026-09-15
**Context:** Two product additions requested on top of DEC-128's sync fix, plus a report that the
un-gated "Sincronizar agora" button (DEC-128, decision 5) still wasn't visible in staging.
**Investigation (button not appearing):** Confirmed via `gh api .../commits/{sha}/status` and
`.../deployments` that the DEC-128 commit (`c013226`) deployed successfully to Railway staging
(`state: "success"`, single deployment record — the earlier two-environment bug from DEC-127's saga
does not recur, confirming the branch-separation fix holds). The button's rendering condition itself
(`healthy.map(...)` in `conectar-banco.tsx`) is unconditional for any connection whose collapsed
`health` is not `"NEEDS_ATTENTION"` — verified by direct inspection, not gated by `isLivePilot` or
anything else in the deployed commit. Most likely explanation: the report was made against a page load
that predated this specific deploy finishing (the deploy and the report were extremely close in time).
Secondary, not-yet-ruled-out possibility: if the real staging connection's Pluggy status is currently
one of `LOGIN_ERROR`/`USER_ACTION_REQUIRED`/`ERROR` (`RECONNECT_STATUSES`,
`apps/ritmo/src/functions/connections.server.ts`), it renders only in the single "needs attention" row
(only a "Reconectar" action, by design — a connection needing re-auth should not offer a stale-data
resync). No code change was made for this second possibility since it would depend on the connection's
actual current provider status, which requires re-checking in the browser against a confirmed-fresh
deploy.
**Decision — Extrato (Alteração 1):**
1. New read-only screen at `/extrato` (not a sixth bottom-nav tab), reached via a discreet "Extrato →"
   link added inside Home's existing "Disponível para gastar" card — same `ScreenHeader`/`PhoneShell`
   back-navigation pattern as every Mais subpage (`backTo="/"`).
2. New `getTransactionHistory` (`packages/app-services/src/queries.ts`) — unlike `getTransactions`
   (current month only, via `monthlyTransactionList`), this is the full, never-date-windowed ledger,
   newest first. A pure read model over `repo.loadFinancialSnapshotInput`; never mutates
   `financial_transactions`, never a new persistence table or column.
3. Presentation reuses, rather than duplicates, existing formatting: `categoryLabel`/`categoryPathLabel`
   (the exact "Sem categoria" neutral-state logic already established for Transações, now shared via
   `format.ts` instead of being duplicated) and two new small formatters (`formatShortDayMonth` "05
   set", `formatMonthYearLabel` "Setembro de 2026") built the same deterministic, timezone-free,
   string-slicing way as every other date formatter in `format.ts` — no new date-formatting approach
   introduced. Grouped by calendar month, since the transaction list is already sorted newest-first by
   the query layer.
**Decision — Auto-sync on app open (Alteração 2):**
1. New `syncAllConnectionsOnOpenHandler` (`connections.server.ts`) — lists the profile's non-
   `DISCONNECTED` connections and calls the existing `syncConnection` for each, exactly as the manual
   "Sincronizar agora" and webhook paths already do (no second sync pipeline). One connection's
   `FAILED` `SyncRun` (checked via its returned `status`, not merely whether the call threw —
   `syncConnection` never throws for a provider-side failure, see DEC-128) never stops the others and
   never deletes previously-synced data (an inherent `syncConnection` guarantee, unchanged here).
   Gated by the same `openFinanceAction` rate-limit bucket every other provider-calling action already
   uses — one check per app-open, not per connection.
2. Triggered from `_protected.tsx`'s own component (renamed from an inline arrow function to
   `ProtectedLayout`) in a `useEffect` guarded by a `useRef` flag — this is the correct "once per app
   open" boundary: `_protected` is a shared pathless layout, so navigating between its child routes
   (Home ↔ Planejamento ↔ ...) never remounts it or re-runs this effect; only each destination route's
   own `loader` re-runs. Deliberately NOT placed in any route's `loader`/`beforeLoad`, both of which DO
   re-run on every navigation — this was the one point the whole implementation hinged on getting
   right, per Founder's explicit "not on every route navigation" requirement.
3. Fire-and-forget: the app renders immediately from already-persisted data; sync runs in the
   background, and only on reporting at least one real success does it call `router.invalidate()` so
   already-mounted loaders re-fetch. Any failure (network, rate-limited, thrown) is swallowed at this
   call site on purpose — `syncAllConnectionsOnOpenHandler` already logs server-side, and
   `syncConnection` never deletes previously-synced data on failure — so the worst case is silently
   keeping the last-known-good data on screen, never a blank page.
**Rationale:** Both features are additive read/orchestration layers over already-existing, already-
approved primitives (`getTransactionHistory` over `loadFinancialSnapshotInput`; auto-sync over
`syncConnection`) — no Safe-to-Spend rule, Pluggy classification rule, or persisted schema changed, per
the Founder's explicit constraints for this task.
**Status:** Accepted.
**Consequences:** New tests: `queries.test.ts` (`getTransactionHistory` — newest-first ordering,
entrada/saída, category+subcategory, category without subcategory); `two-profile-isolation.test.ts`
((Q) — never leaks another profile's transactions); `extrato.test.ts` (month grouping, friendly
label/amount/date formatting, "Sem categoria" fallback including the `UNCATEGORIZED` sentinel, empty
state); `connections.server.test.ts` (`syncAllConnectionsOnOpenHandler` — multiple connections synced,
one failing connection isolated from the others with no data loss, empty-profile summary, repeated
calls never duplicate a transaction). Not covered by an automated test, and explicitly noted as a gap
rather than silently skipped: the client-side "exactly once per app open, not per navigation" guarantee
itself, since this repository has no component/DOM-rendering test tool (no React Testing Library or
equivalent) — verified instead by direct inspection of `_protected.tsx`'s position as a shared pathless
layout in the route tree, plus the `useRef` guard protecting against React 18 Strict Mode's dev-only
double-invoke. All work is on the `staging` branch only, per the Founder's explicit instruction — `main`
was not touched.

---

### DEC-130

**Date:** 2026-09-15
**Context:** Diagnosis (see the prior investigation, same day) found Home's "Disponível para gastar"
showing -R$788.20 for `financial-profile_9_mu1xbipy` despite real, healthy liquidity (checking
R$35,995.75, card owed R$961.95, salary R$8,500 already received this month) — because Home read
`snapshot.safeToSpend.total`, the DECLARED-PLAN Safe-to-Spend (`usable income − commitments −
actualSpending`), which is deeply negative whenever the `incomes` table is empty, regardless of real
liquidity. `snapshot.liquidity.liquidityAwareSafeToSpend` already existed but computed
`min(planSafeToSpend, availableLiquidity)` — a healthy liquidity figure was still capped by the broken
plan number, reproducing the exact same -R$788.20.
**Decision:**
1. **Home Safe-to-Spend now starts from current liquidity, not the declared plan, when reliable
   liquidity exists.** `computeLiquidityAwareSafeToSpend` (`packages/financial-engine/src/domain/
   position.ts`) is rewritten: no more `min(plan, liquidity)`; the liquidity-based total is now
   `currentAvailableCash − cardObligations − otherLiabilities − upcomingCommitments −
   upcomingEventReservations − debtCommitments − protectedSavings + futureIncome`, computed and
   returned directly. A new `basis: "LIQUIDITY_AWARE" | "PLAN_BASED"` field records which one is
   authoritative (`PLAN_BASED` only when the cash balance itself is unknown — the pre-existing
   fallback, unchanged in spirit). A new `recommendedTotal` field is the ONE number any single-figure
   consumer (Home) should read — the selection logic lives in the engine, never duplicated in
   `apps/ritmo`. The declared-plan `safeToSpend.total`/`safeToSpendBreakdown` formula in `snapshot.ts`
   is **completely unchanged** — still computed, still returned, just no longer capping a healthy
   liquidity figure.
2. **No double counting, by construction, not by reconciliation.** The liquidity-aware total never
   reads real transactions directly — `position.cashBalance`/`cardOutstandingBalance` already net
   every past-realized movement (income received, money spent, a card bill already paid) by
   definition of what a bank balance IS. Concretely:
   - Realized income/spending already happened → already in the balance → never re-added/re-subtracted.
   - A card purchase not yet reflected in checking → represented once, via the card's own
     `cardOutstandingBalance` (subtracted once) — never also subtracted as a future "card payment event."
   - A `FixedExpense` with a `dueDayOfMonth` already passed this month is presumed already paid (already
     in the balance) and excluded from "upcoming commitments" — `dueDayOfMonth`'s own doc comment is
     updated to note this NEW liquidity-only usage; the plan-based formula's treatment (always committed,
     regardless of due day) is explicitly unchanged.
   - A declared `Income.expectedDayOfMonth` already passed this month is presumed already received
     (already in the balance) and excluded from "future income"; only a day still ahead of `asOfDate`,
     with CONFIRMED/ACTUAL certainty, counts forward.
   - A `FinancialEvent` reservation only reduces the liquidity-aware total when its `startDate` falls
     within the CURRENT calendar month (`isSameMonth`) — the broader declared-plan total still reserves
     for every known future event regardless of timing (a genuinely different, intentionally broader
     question: "financial plan" vs. "safe to spend today").
3. **Planned income now has explicit provenance.** `Income` (`packages/financial-engine/src/domain/
   income.ts`) gains `source: "USER_DECLARED" | "HISTORY_INFERRED" | "USER_CONFIRMED_HISTORY"`
   (required; defaults to `USER_DECLARED` for any pre-existing/legacy row, since every `Income` before
   this DEC was, in fact, a direct user statement — `createIncome` has always required explicit
   confirmation, DEC-127) and an optional `expectedDayOfMonth` (mirrors `FixedExpense.dueDayOfMonth`
   exactly). `createIncomeTool` (copilot) gained a `fromRecurringPattern` boolean: `true` sets
   `HISTORY_INFERRED` (confirming a `getRecurringIncomeCandidates` result), omitted/`false` sets
   `USER_DECLARED` (a plain statement). `USER_CONFIRMED_HISTORY` is reachable only via `updateIncome`
   with an explicit `source` — no code path ever assigns it automatically. **Nothing was added that
   lets a learned pattern silently overwrite a declared `Income`** — `updateIncome` already only ever
   changes fields a caller explicitly supplies (Sprint 9 DEC-127 behavior, unchanged); a conflicting
   history observation is surfaced as a new/updated `RecurringExpenseCandidate` for a human to act on,
   never an automatic mutation. `detectRecurringCandidates`'s existing `MIN_OCCURRENCES = 2` gate
   (Sprint 9) already prevents one isolated transaction from ever becoming a candidate at all, before
   provenance is even relevant.
4. **`reservedBalances`/`automaticallyInvestedBalance` are now modeled, with a resolved and an
   unresolved half.** Pluggy's SDK types (`node_modules/pluggy-sdk`) document `bankData.closingBalance`
   as the account's "available balance" (distinct from `balance`'s "current balance") — this is the
   provider's own already-computed spendable figure, and is read into a new `PaymentSource.
   availableBalance` field, preferred over `balance` wherever usable liquidity is computed
   (`buildFinancialPositionFromAccounts`). `bankData.reservedBalances` (e.g. a goal-based "Caixinha")
   is summed into a new `PaymentSource.reservedBalance` field and subtracted from usable cash **only
   when `availableBalance` is absent** (i.e. we fell back to the raw `balance`, which cannot be assumed
   to already exclude it) — this is the one and only place reserved money is ever subtracted, so it can
   never happen twice regardless of how many accounts or how they're shaped.
   `bankData.automaticallyInvestedBalance` is captured into a new `PaymentSource.
   automaticallyInvestedBalance` field for explainability but **deliberately NOT subtracted anywhere** —
   whether this money is same-day spendable varies by institution, and guessing wrong in either
   direction (subtracting money that's actually available, or not subtracting money that isn't) is a
   real product risk neither the investigation nor this DEC has enough information to resolve safely.
   Left as an explicit, documented open decision (see "Remaining ambiguity" below), not silently
   assumed either way.
5. **Fixed the confirmed Pluggy classification bug.** `classifyFinancialEffect`
   (`packages/open-finance/src/pluggy/mappers.ts`) checked `CARD_PAYMENT_KEYWORDS` only on the
   CREDIT_CARD-account side; a checking-account DEBIT paying a card bill (e.g. real-world
   `"PAGAMENTO FATURA CARTAO VISA"`) fell through to the generic `CONSUMPTION` default on the BANK
   side. Fixed by applying the SAME existing regex (never a single literal string) to the BANK branch
   too. This is forward-looking only — an already-imported transaction with the old, wrong
   classification is not retroactively corrected by this change; see "Remaining ambiguity."
**Rationale:** "How much can I safely spend from now until period end" is fundamentally a question
about current liquidity plus known forward changes — not a question the declared/expected income table
can answer when nothing has been declared yet, however healthy the user's real accounts are. Deriving
the liquidity-aware total entirely from already-net balances (rather than re-deriving it from
transactions) is what makes the "no double counting" guarantee structural rather than something that
has to be maintained by careful reconciliation logic scattered across the codebase.
**Status:** Accepted.
**Consequences:** New/updated tests: `position.test.ts` (basis selection, no more min() capping,
available/reserved/invested balance precedence, exactly-once card deduction, explainability
reconciliation); `snapshot.test.ts` (12 scenarios: positive liquidity with zero declared income;
already-received salary and already-paid expense not double counted; reliable vs. unreliable future
income; event horizon scoping; card purchase + bill payment; PLAN_BASED fallback; the full
`financial-profile_9_mu1xbipy`-shaped regression); `mappers.test.ts` (reserved/available/invested
balance mapping; the BANK-side CARD_PAYMENT regression); `provider-repositories.test.ts` (persistence
round-trips, including a simulated legacy Income row defaulting to `USER_DECLARED`); `mutations.test.ts`
/`tools.test.ts` (provenance defaults, explicit source, conflicting-history-never-silently-overwrites).
A new additive-only migration (`0010_cheerful_leopardon.sql`) adds nullable columns to
`payment_sources`, `financial_positions`, and `incomes` — no existing column changed or dropped.
`home.ts` now reads `snapshot.liquidity.recommendedTotal`/`.basis` instead of
`snapshot.safeToSpend.total`; no new Safe-to-Spend math was added inside `apps/ritmo`.
**Remaining ambiguity requiring product/business input:**
- Whether `automaticallyInvestedBalance` should ever reduce usable liquidity (or under what
  institution-specific conditions) — deliberately left unresolved rather than guessed.
- Whether already-imported transactions with the pre-fix `CARD_PAYMENT` misclassification (any
  environment's existing data, imported before this DEC) should be backfilled/reclassified — no
  backfill was implemented; only new imports are affected by the fix.
- The exact conversational rule for when the copilot should offer `USER_CONFIRMED_HISTORY` (vs. leaving
  a `HISTORY_INFERRED` Income as-is, or surfacing a fresh candidate) when a learned pattern reinforces
  or conflicts with a declared Income — the domain/mutation layer supports all three provenance states
  correctly, but the conversational trigger logic for transitioning between them is a product design
  question, not resolved here.
- Whether "Já comprometido" and other Home figures beyond "Disponível para gastar" should also become
  liquidity-aware — out of scope for this DEC, which only touched the one field the Founder identified.

**Update (2026-09-15) — corrections before push approval:** review of this DEC before authorizing the
push surfaced several real gaps, all corrected here (still pre-push, still `staging`-only):

1. **Due day is no longer treated as proof of realization.** The original implementation assumed a
   declared `Income`/`FixedExpense` was "already realized" purely because its day-of-month had passed,
   and "still pending" purely because it hadn't. Both directions were wrong: an early salary (expected
   day 20, paid day 15) would have been added a second time; an overdue, never-paid rent (due day 10,
   still unpaid on day 15) would have been silently dropped as "probably already paid." Replaced with
   real reconciliation: `snapshot.ts` now matches each declared Income/FixedExpense against real
   transactions THIS MONTH by amount only (reusing `recurring.ts`'s existing `amountsAreSimilar` 10%
   tolerance — now exported — never a bespoke threshold, never description matching), month-scoped by
   construction. A matched item is REALIZED (already in the balance, never added/subtracted again,
   regardless of which side of its expected day the real transaction fell on). An unmatched item whose
   day is still ahead is EXPECTED (future income adds; unpaid expense still subtracts). An unmatched
   item whose day has passed is OVERDUE/UNRESOLVED: for income, conservatively NOT added (never assume
   it'll still arrive — a warning is logged instead); for expenses, conservatively KEPT as a full
   obligation (never assume it was paid). `matchAndConsume` removes a matched transaction from its pool
   so the same real transaction can never realize two different planned items.
2. **Provenance semantics corrected.** `createIncomeTool`'s `fromRecurringPattern: true` previously set
   `HISTORY_INFERRED`. Since `createIncome` only ever executes after explicit user confirmation (its own
   contract, unchanged since DEC-127), confirming a shown pattern IS the `USER_CONFIRMED_HISTORY` state,
   not the bare unconfirmed inference — corrected. `HISTORY_INFERRED` remains a valid, settable
   `IncomeSource` (for a hypothetical future path, and directly via `createIncome`/`updateIncome`), but
   the liquidity-aware forward-income calculation now explicitly EXCLUDES it as a defense-in-depth
   gate — an Income record left in that state can never become authoritative planned money on its own,
   regardless of certainty or day-of-month, matching the instruction that history may teach Ritmo but
   only user confirmation may strengthen it into planned knowledge.
3. **"Já comprometido" is now a canonical engine figure.** New `LiquidityAwareSafeToSpend.
   committedForwardTotal` (sum of the CARD_OBLIGATIONS + OTHER_LIABILITIES + UPCOMING_FIXED_COMMITMENTS
   + UPCOMING_EVENT_RESERVATIONS + DEBT_COMMITMENTS components — explicitly never VARIABLE_BUDGETS, a
   target rather than a firm obligation, and never PROTECTED_SAVINGS or FUTURE_CONFIRMED_INCOME) and a
   new `FinancialSnapshot.recommendedCommittedTotal` (this total when liquidity-aware, else the
   unchanged plan-based `commitments.fixed`). `LiquiditySafeToSpendComponentType`'s `UPCOMING_COMMITMENTS`
   was split into `UPCOMING_FIXED_COMMITMENTS` and its own `VARIABLE_BUDGETS` entry so the split is
   possible at all. `home.ts` now reads `snapshot.recommendedCommittedTotal` for "Já comprometido"
   instead of `commitments.fixed` directly — the same "engine decides, apps/ritmo just reads" pattern as
   `recommendedTotal`.
4. **automaticallyInvestedBalance: unchanged decision, strengthened evidence/tests.** Confirmed still
   correct not to subtract it — it is captured on `FinancialPosition.automaticallyInvestedBalance` for
   explainability and proven (new tests) to never leak into `cashBalance` even when combined with a
   `reservedBalance` and a `availableBalance` on the same account. The open product question (same-day
   liquidity varies by institution) is unchanged and still unresolved by design.
5. **reservedBalance handling reversed based on real evidence.** The original design preferred
   `availableBalance` (Pluggy's `closingBalance`) and skipped subtracting `reservedBalance` whenever
   `availableBalance` was present, assuming the provider's own "available balance" already excluded
   reservations. Checking the REAL payload for this profile's own connected account disproves that
   assumption: `balance` and `closingBalance` are IDENTICAL (both 35,995.75) despite
   `hasReservedBalance: true` and a genuine R$1,000.04 reservation — `closingBalance` here does **not**
   exclude it. Corrected to the safer rule: `reservedBalance` is now subtracted exactly once from
   whichever cash figure is used (`availableBalance ?? balance`), unconditionally, every time it's
   known — erring toward under-stating spendable cash rather than ever silently treating protected
   money as available. The test fixture `fixtureBankAccountWithReservedBalance`
   (`packages/open-finance`) was corrected to match the real observed payload (`closingBalance ===
   balance`) instead of an idealized scenario that happened to validate the old (wrong) code.
6. **Retroactive CARD_PAYMENT reclassification implemented.** New `reclassifyMisclassifiedCardPayments`
   (`packages/app-services/src/sync.ts`) — reuses the exact canonical detector
   (`isCardBillPaymentDescription`, newly exported from `packages/open-finance`, the SAME regex the live
   mapper uses) against already-persisted transactions' `rawDescription`/`direction`/
   `paymentSource.type` (the raw Pluggy payload itself is never persisted — see docs/OPEN-FINANCE.md,
   "raw payload retention policy" — so the original per-transaction classifier cannot be literally
   re-run; this works from the same domain fields its BANK branch keys off). Idempotent (only rows still
   `CONSUMPTION` match; a second run reclassifies nothing) and non-destructive (only ever changes
   `financialEffect`, nothing else). No general-purpose CLI/migration entry point was added — deliberately, per
   the instruction not to add production migration complexity before it's needed; the function is ready
   to be invoked (via a short script, exactly as this DEC's own validation did) against staging or
   production whenever someone with that database's access runs it. **Applied to the local reproduction
   of `financial-profile_9_mu1xbipy`** (the closest available proxy to "staging test data" this session
   can reach) as part of validating this DEC: 4 transactions (`PAGAMENTO FATURA CARTAO VISA`, dated
   2026-05-31 through 2026-08-31) were reclassified from `CONSUMPTION` to `CARD_PAYMENT`. None were in
   the current month, so this did not change the plan-based `safeToSpend.total` for that profile, but it
   is the correct, permanent fix for that data and demonstrates the mechanism against real rows, not
   just fixtures. Neon (staging) itself was not touched — no access exists from this session; the same
   function needs to be run there by whoever has that access.
**Corrected result for `financial-profile_9_mu1xbipy`** (real local data, real clock, after
reclassification, no fabricated values — see the delivery message for the full itemized breakdown):
`basis: LIQUIDITY_AWARE`, `recommendedTotal` ≈ R$34,977.90, `recommendedCommittedTotal` ≈ R$1,017.85
(card R$961.95 + a pre-existing unrelated Netflix installment debt commitment R$55.90 — not fabricated
for this exercise, already present in the profile's real data from an earlier session). Reserved/
invested balances are NOT yet reflected in this specific profile's stored data (its last sync predates
this fix) — a fresh sync would populate them going forward; the mechanism itself is proven against the
real observed payload via fixtures/tests, independent of when this one profile happens to resync.
**Tests added for this update:** `snapshot.test.ts` (early income realized despite a future day;
overdue unrealized income excluded with a warning; bill paid early reconciles; overdue unpaid bill
stays a full obligation; HISTORY_INFERRED income excluded even with reliable certainty; realized event
line item excluded from the liquidity-aware total; "Já comprometido" tests: card-only, paid-off card no
longer committed, excludes variable budgets/protected savings/future income, PLAN_BASED fallback);
`position.test.ts` (reservedBalance subtracted once regardless of availableBalance/closingBalance
equality — evidence-based; automaticallyInvestedBalance never double-counted alongside
reservedBalance+availableBalance; reservedBalance correct across multiple accounts;
`committedForwardTotal` composition); `mappers.test.ts` (fixture corrected to the real payload shape);
`sync.test.ts` (`reclassifyMisclassifiedCardPayments`: reclassifies the stale case, idempotent on
rerun, never touches an unrelated description); `mutations.test.ts`/`tools.test.ts` (all three
provenance states settable; `fromRecurringPattern` maps to `USER_CONFIRMED_HISTORY`, never
`HISTORY_INFERRED`).

**Update (2026-09-15) — two remaining correctness risks fixed before push approval:**

1. **Card balance vs. installment/debt double counting.** Confirmed against the real profile's own
   data: the R$55.90 Netflix installment plan's `paymentSourceId` IS the same credit card whose
   R$961.95 outstanding balance was already being deducted — that balance, being Pluggy's real-time
   total, already nets in every posted purchase/installment on that card, so subtracting the
   installment on top was a genuine double count (committed was R$1,017.85; should have been
   R$961.95). New canonical domain rule, `isInstallmentCoveredByCardBalance`
   (`packages/financial-engine/src/domain/installment.ts`): an ACTIVE installment plan is "covered" —
   and excluded from the liquidity-aware debt total — only when its `paymentSourceId` is a KNOWN
   credit-card account (derived from real transactions actually seen, never guessed) whose
   outstanding balance is itself KNOWN (whether zero — bill fully paid, so the installment's portion
   is discharged too — or positive). A plan with no linked payment source, or linked to a non-card
   account, or whose card's balance is UNKNOWN, is never considered covered and stays a fully
   independent obligation (the conservative direction). `snapshot.ts` derives
   `creditCardPaymentSourceIds` from `input.transactions`' own `paymentSource.type` and passes only
   the UNCOVERED installments' sum into `computeLiquidityAwareSafeToSpend` — the plan-based
   `commitments.debtCommitments` is completely unchanged (still sums every ACTIVE plan regardless of
   card coverage, exactly as before).
2. **Reconciliation could false-positive on amount alone.** The 10% tolerance (borrowed from
   `recurring.ts`'s pattern-DETECTION logic, a different problem) would have matched an unrelated
   R$790 payment against an R$800 declared rent, or an unrelated R$8,300 PIX against an R$8,500
   expected salary — both within 10%. Replaced with a conservative, multi-signal rule
   (`reconcilePlannedAmount`, `snapshot.ts`): EXACT amount equality (a declared Income/FixedExpense is
   a specific, known figure — never a fuzzy pattern) AND matching `direction`, against a pool already
   filtered to the correct `financialEffect` (INCOME for income; consumption-like for expenses — so a
   CARD_PAYMENT/TRANSFER/REFUND can never satisfy a salary or bill expectation regardless of amount)
   and to the current calendar month (date proximity — still wide enough for the early-salary case,
   day 20 expected/day 15 received). A matched transaction is removed from its pool so it can never
   realize two different planned items. No description/merchant matching was added (deliberately, per
   the instruction not to revert to that) — exact amount plus effect/direction/month scoping already
   resolves the concrete false-positive examples without it. "Compatible payment source" and
   "counterparty/merchant identity" signals were considered but are not applicable today: neither
   `Income` nor `FixedExpense` carries a `paymentSourceId` or merchant field to compare against.
3. **Reserved-balance regression re-validated against the FULL real payload.** The previously-reported
   R$34,977.90 for `financial-profile_9_mu1xbipy` used data synced BEFORE the reservedBalance mapper
   fix existed, so it never actually exercised the new deduction. New end-to-end test
   (`packages/open-finance/src/pluggy/dec130-full-pipeline.test.ts`) runs the FULL real payload
   (balance/closingBalance R$35,995.75, reservedBalance R$1,000.04, automaticallyInvestedBalance
   R$3,599.575, card R$961.95) through the actual mapper -> `paymentSourceFromExternalAccount` ->
   `buildFinancialPositionFromAccounts` -> `buildFinancialSnapshot` pipeline, with every expected
   figure derived independently from the raw constants (never copied from the implementation), and an
   explicit "identical result with automaticallyInvestedBalance entirely absent" comparison proving it
   never alters spendable cash.
**Corrected result for `financial-profile_9_mu1xbipy`** (real local data, re-run after the installment
fix — see the delivery message for the full breakdown): `Já comprometido` dropped from R$1,017.85 to
**R$961.95** (card only — the Netflix installment is genuinely covered), and `recommendedTotal` rose
from R$34,977.90 to **R$35,033.80** accordingly. Reserved/invested balances remain unpopulated in this
specific profile's stored data (unchanged fact — still predates a fresh sync); the full-payload
synthetic regression is what validates that mechanism now, independent of this one profile's sync
timing.
**Tests added:** `installment.test.ts` (`isInstallmentCoveredByCardBalance` — covered/not-covered/
unknown-balance/zero-balance cases, tests A/B/D plus the zero-balance variant); `snapshot.test.ts`
(tests A-D integrated through `buildFinancialSnapshot`, including test C's "multiple installments on
one card, counted once," plus the already-paid-card-balance interaction; four reconciliation
false-positive tests: R$790-vs-R$800, R$8,300-vs-R$8,500 PIX, exact-amount CARD_PAYMENT never
satisfying a bill, and "one transaction resolves at most one planned item" with two identical R$800
rents); `dec130-full-pipeline.test.ts` (new file, full real-payload regression).

### DEC-131

**Date:** 2026-09-15
**Context:** After a real Pluggy re-sync, staging showed Safe-to-Spend = R$70,029.51 for
`financial-profile_2_mu1rzk0f` — exactly `35,995.75 + 35,995.75 − 1,000.04 − 961.95`, i.e. the
checking balance counted twice. Direct DB inspection confirmed the root cause: exactly ONE
`ProviderConnection` (`status: CONNECTED`), but THREE `PaymentSource` rows — one `CREDIT_CARD`
(legitimate) and TWO `DEBIT`/`CHECKING_ACCOUNT` rows (`payment-source_38_mu20nczj` and
`payment-source_37_mu20ncy4`), both with the SAME `externalAccountId`, same connection, same real
Pluggy account.
**Root cause (code-confirmed, not speculative):** `syncConnection`
(`packages/app-services/src/sync.ts`) used a find-then-insert pattern —
`repo.findPaymentSourceByExternalId(...)` to look up an existing row by
`(financialProfileId, provider, externalAccountId)`, then `repo.upsertPaymentSource` keyed only on the
row's own freshly-generated `id` when none was found. `payment_sources` had **no database-level
uniqueness** on that natural key (unlike `provider_connections`, which already had
`unique(financialProfileId, provider, externalConnectionId)` since Sprint 3) — so two overlapping
`syncConnection` calls for the same connection (Pluggy is documented to send bursts of
`item/created`/`item/updated`/`transactions/created` webhooks for one Item in quick succession, each
independently triggering a sync — see `webhook.ts` — and a manual/auto sync can just as easily land in
the same window) could both run `findPaymentSourceByExternalId`, both observe no row, and both insert.
This is a genuine application-level TOCTOU gap, not merely a hypothesis: a `Promise.all` of two
concurrent `upsertPaymentSource` calls for the same identity reproduced two rows before this fix (see
the new test in `provider-repositories.test.ts`).
Separately confirmed: `financial_transactions` are keyed by `(financialProfileId, externalProviderId,
externalTransactionId)` in `findTransactionByExternalId` — **not** by `paymentSourceId` — so the
duplicate PaymentSource situation could not itself have produced duplicate transaction rows; at worst,
individual transactions may have been inconsistently attributed to whichever duplicate row
`findPaymentSourceByExternalId`'s unordered, `LIMIT`-less query happened to return on a given sync.
**Decision:**
1. **Canonical identity confirmed:** `(financialProfileId, provider, externalAccountId)` is the correct
   uniqueness key for a provider-synced `PaymentSource`, for every current provider (`pluggy`, `mock` —
   both key exclusively on `externalAccountId`). A manually-entered `PaymentSource` (`provider` and
   `externalAccountId` both null) is never constrained by this — standard Postgres multi-column unique
   constraint NULL semantics treat every null as distinct.
2. **Database-level enforcement added.** `payment_sources` now has
   `unique(financialProfileId, provider, externalAccountId)` (`packages/persistence/src/schema.ts`).
3. **Conflict-safe upsert.** `repo.upsertPaymentSource` now issues
   `INSERT ... ON CONFLICT (financial_profile_id, provider, external_account_id) DO UPDATE SET ...`
   (falling back to the previous `id`-keyed upsert only for manually-entered sources) and **returns the
   row actually persisted** — critical because the losing side of a race gets back a DIFFERENT `id`
   than the one it generated. `syncConnection` was updated to use this returned value for every
   downstream operation (transaction import, bill import, baseline check) — never its own draft object.
4. **Migration is self-repairing, not merely additive** (`packages/persistence/migrations/
   0011_freezing_madame_masque.sql`): before adding the constraint, it identifies duplicate groups
   (partitioned by the same natural key), picks a canonical row per group (most complete — fewest null
   balance fields — then freshest `lastSyncedAt`, then `id` for determinism), repoints every
   `financial_transactions`/`installment_plans`/`bills` reference from the losers onto the canonical
   row via a session-scoped temp table (all statements in one migration file run in one transaction),
   deletes the losers, then adds the constraint — so `CREATE UNIQUE INDEX` itself is the final proof no
   conflicting rows remain (if repair were ever incomplete, the constraint fails to create and the
   whole migration rolls back, rather than silently leaving the invariant unprotected). A database with
   no duplicates (any fresh environment, including production) sees a no-op repair and a clean
   constraint add.
5. **Never used balance-matching for identity or deduplication anywhere in this fix** — every decision
   (which row is canonical, which rows are duplicates) is keyed on `(financialProfileId, provider,
   externalAccountId)`, never on comparing balance amounts.
6. **The Safe-to-Spend formula itself was not touched.** This was scoped, confirmed, and fixed as a
   sync-identity/data-aggregation defect — `position.ts`'s liquidity math is unchanged.
**Tests added:** `provider-repositories.test.ts` (DEC-131 block) — sequential syncs of the same
account produce one row; a genuine `Promise.all` race between two concurrent upserts of the same
identity resolves to exactly one row with both callers reporting the same canonical id; the same
`externalAccountId` under two different profiles is allowed; two genuinely different
`externalAccountId`s in one profile both persist; a raw duplicate INSERT bypassing the repository
helper is rejected by the database itself; multiple manually-entered payment sources remain
unconstrained. `migration.test.ts` (new DEC-131 describe block) — the self-repairing migration:
repoints transactions/installment plans/bills from a seeded duplicate pair onto the more-complete,
fresher canonical row; leaves an unrelated `CREDIT_CARD` payment source and the transaction count
untouched; the canonical row's own `reservedBalance` survives; the constraint then rejects a further
duplicate insert while still allowing manually-entered sources side by side; and
`buildFinancialPositionFromAccounts` run against the post-repair data counts the checking liquidity
exactly once. `sync.test.ts` (DEC-130 follow-up block, added the same day, before this root cause was
confirmed) — 7 sync-level regression tests covering the same identity/idempotency surface end-to-end
through `syncConnection`.
**Staging repair:** see the delivery message for the exact SQL performed against
`financial-profile_2_mu1rzk0f`'s two duplicate rows (`payment-source_38_mu20nczj`,
`payment-source_37_mu20ncy4`) and the resulting snapshot breakdown.

### DEC-132

**Date:** 2026-09-15
**Context:** Product consolidation request: the Planning ("Planejamento") screen becomes the ONE
canonical place Ritmo represents what it knows/needs-to-know about the user's financial future —
planned income, fixed/recurring expenses, installments, categorization rules, and learned/pending
knowledge — replacing the standalone, read-only "Categorias e regras" screen under "Mais" as a second
source of truth. Explicit non-goal: do not touch Safe-to-Spend.
**Architecture reused (confirmed via research pass before implementing, per explicit instruction —
"do not create duplicate category models," "use existing recommendation/pending-confirmation
architecture where possible"):** `CategoryRule`/`MerchantNormalizationRule`/`categorize`/
`normalizeMerchant` (unchanged matching logic); `FinancialEffect` (existing TRANSFER/CARD_PAYMENT/
DEBT_PAYMENT/REFUND separation preserved exactly); `Income.source`/`IncomeSource` (DEC-130 provenance,
now also reused on `FixedExpense`); `RecurringExpenseCandidate`/`detectRecurringCandidates` (DEC-127,
previously computed fresh every call with random ids and never persisted — the `recurring_candidates`
table existed but was completely dead code); `Recommendation`/`recommendation-service.ts` (Sprint 5,
previously interactive only in `apps/web`, read-only in `apps/ritmo`); `getUncategorizedTransactions`
(pre-existing derived filter, previously wired only into `apps/web`).
**Decision:**
1. **Three distinct concepts preserved, never collapsed.** Financial effect (what happened to the
   money) still strictly precedes and is independent of category (what kind of spend/income). A rule/
   learned-knowledge object (`CategoryRule`) now carries its own provenance (`CategoryRuleOrigin`:
   `SYSTEM_DEFAULT` | `USER_DECLARED` | `HISTORY_INFERRED` | `USER_CONFIRMED_HISTORY`, mirroring
   `IncomeSource`) — every pre-existing rule (`fixtures/rules.ts`, any row predating this column)
   defaults to `SYSTEM_DEFAULT`, never guessed as user-authored.
2. **New `FinancialEffect` values `INVESTMENT`/`INVESTMENT_REDEMPTION`** (neither is
   `isConsumptionLike`) — an investment application is never ordinary spending, a redemption is never
   ordinary income. Manual/AI entry now explicitly declares one of `ManualEntryFinancialEffect`
   (`CONSUMPTION | TRANSFER | REFUND | INVESTMENT | INVESTMENT_REDEMPTION`) — `recordManualTransaction`
   no longer hardcodes `CONSUMPTION`; `defaultDirectionForManualEntry` derives cash direction from the
   declared effect, never independently guessed. The AI copilot's job is this classification (from the
   user's own words, e.g. "Transferi 2 mil do Itaú para o Nubank" → TRANSFER) — never a keyword-guess
   in application code. `hasExplicitMutationIntent` (the defense-in-depth mutation gate) gained PT-BR/
   English patterns for transfer/investment/classification/confirmation language so these new tools are
   actually reachable.
3. **Category rules gained real CRUD**, previously entirely absent (`categorias.ts` was explicitly
   documented as "read-only: no per-profile rule authoring UI yet"): `mutations.createCategoryRule`/
   `deleteCategoryRule`, reusing the pre-existing but previously-unused `repo.upsertCategoryRule`
   primitive (added `repo.deleteCategoryRule`, which didn't exist at all). A one-time transaction
   correction (`categorizeTransaction`) changes only that transaction; choosing "always" additionally
   creates a `USER_DECLARED` rule via the exact same `createCategoryRule` call — never a parallel
   rule-creation path, and NEVER touches `financialEffect`.
4. **"Ritmo precisa confirmar" is a read-model aggregation, not a fourth pending-task system.**
   `queries.getPendingConfirmations` unions three previously-separate, previously-mostly-unsurfaced
   mechanisms (uncategorized transactions, recurring income/expense candidates, pending
   Recommendations) into one list; each item resolves via ITS OWN existing/extended mutation
   (`categorizeTransaction`, `confirmRecurringIncomeCandidate`/`confirmRecurringFixedExpenseCandidate`/
   `rejectRecurringCandidate`, `acceptRecommendation`/`rejectRecommendation`). No new persisted "task"
   table was created.
5. **`RecurringExpenseCandidate` is now actually persisted** (the `recurring_candidates` table was
   dead code before this). `repo.upsertRecurringCandidate` is a DEC-131-style conflict-safe upsert on
   `(financialProfileId, kind, evidenceKey)` — a new unique constraint enforces it at the DB level too.
   A candidate keeps a STABLE id/status across re-detections (a re-run refreshes only its evidence
   numbers, never `id`/`status`/`createdAt`). Fixed a real latent bug found while wiring this up:
   `detectRecurringCandidates` only ever suppressed REJECTED evidence keys, never CONFIRMED ones — a
   confirmed pattern would have kept re-appearing as a fresh "candidate" forever. Now both are
   suppressed.
6. **Confirming a candidate creates real planning knowledge with `USER_CONFIRMED_HISTORY` provenance**
   (DEC-130's third state — inferred AND confirmed) via the SAME `createIncome`/`createFixedExpense`
   canonical mutations manual/AI declaration already used — never a parallel creation path. Rejecting
   marks the candidate `REJECTED` and creates nothing. A LOW-confidence candidate still surfaces (never
   silently forced into a category/plan, never silently dropped) — only an explicit confirm/reject ever
   changes its status.
7. **`FixedExpense` gained a `source?: IncomeSource` field** (previously only `Income` had provenance —
   a real, confirmed gap from the research pass) — reuses the exact same three-state concept, not a
   parallel type.
8. **"Mais" no longer owns a second source of truth.** `/categorias` (the old standalone screen) is now
   a pure redirect to `/planejamento`; its data-fetching function (`categorias.ts`) was deleted entirely
   rather than left dead. The "Categorias e regras" row in "Mais" still shows a live rule count
   (`getCategoryRuleCount`, unchanged, a summary — not a second list) and now navigates to Planning.
9. **AI and manual/UI entry converge on identical mutations** — every new copilot tool
   (`categorizeTransaction`, `createCategoryRule`, `confirmRecurringIncomeCandidate`,
   `confirmRecurringFixedExpenseCandidate`, `rejectRecurringCandidate`, and the extended
   `recordManualTransaction`) is a direct, thin delegation to the exact same `@money-copilot/app-services`
   mutation the Planning UI's server actions call — verified by tests exercising both paths against the
   same assertions.
10. **Safe-to-Spend untouched.** No change to `position.ts`, `snapshot.ts`, or any liquidity math.
**Remaining open items (explicitly out of scope this pass, not silently skipped):** no dedicated
income-creation UI form was added to Planning's "Criar manualmente" flow (`planejamento-novo.tsx` still
only supports event/fixed-expense kinds) — declaring new income remains reachable via the AI copilot's
`createIncome` tool or a confirmed recurring-income candidate, not yet a manual form field. Category
rules remain global or (not per-profile), matching the pre-existing architecture — not something this
task was scoped to change.
**Tests added:** `financial-effect.test.ts` (new file — `isConsumptionLike`/`defaultDirectionForManualEntry`
for the new effects); `recurring.test.ts` (CONFIRMED-suppression regression); `learning-repository.test.ts`
(new file — CategoryRule provenance round-trip/default/delete; RecurringExpenseCandidate conflict-safe
upsert, status-preservation, per-kind independence); `learning.test.ts` (new file, app-services — covers
required scenarios 1-9, 11-13); `mutation-guard.test.ts` (new explicit-intent patterns);
`copilot/tools.test.ts` (DEC-132 tool-registry additions, AI-path convergence tests — scenario 10);
`adapters/planejamento.test.ts` (income/rule/pending-confirmation view-model mapping); `adapters/mais.test.ts`
(scenario 14 — Mais resolves to Planning). Scenario 15 (no duplicated source of truth) verified
structurally: `getCategoryRulesList` has exactly one call site (`planejamento.ts`) after `categorias.ts`
was deleted.
