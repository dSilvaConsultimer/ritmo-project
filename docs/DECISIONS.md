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
