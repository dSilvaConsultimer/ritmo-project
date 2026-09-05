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
**Status:** Accepted.
**Consequences:** This date is a fixture constant, not derived from `Date.now()` — the engine itself
is date-agnostic and takes `asOfDate` as an explicit input everywhere. A future sprint replacing the
fixture with real user data will supply its own `asOfDate`.
