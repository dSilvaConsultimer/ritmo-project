# Money Copilot — Architecture

## Repository layout

```
money-copilot/
  apps/
    web/                    Next.js App Router UI (thin display layer)
  packages/
    financial-engine/       The priority package: deterministic domain + calculations
    shared/                 Generic, non-financial cross-cutting utilities (id generation)
  docs/                     Canonical project memory (read this before every sprint)
```

Package manager: **pnpm workspaces**. Test runner: **Vitest** (financial-engine only — it is the
package with logic worth testing). Language: **TypeScript**, strict mode, ESM throughout.

## Why this split

`@money-copilot/financial-engine` is deliberately usable **without Next.js, an LLM, Open Finance, a
database, or internet access** — see NON-NEGOTIABLE constraint in `docs/PROJECT_STATE.md`. It has a
single runtime dependency (`@money-copilot/shared`, for a trivial id helper) and no framework
dependency at all. This means:

- It can be unit tested in isolation with no mocking of infrastructure.
- It can be reused by a future CLI, a future API server, a future background job, or a future LLM
  tool-calling layer, without dragging in React/Next.
- The web app's job is reduced to *calling* the engine and *displaying* its output — it must never
  reimplement or duplicate a calculation.

`@money-copilot/shared` holds only generic, domain-agnostic utilities (currently: a branded `Id<T>`
type and a monotonic id generator for fixtures/tests). It intentionally does **not** hold financial
domain types — those belong in financial-engine, which is the single source of truth for the domain
model. This keeps the dependency graph one-directional: `web → financial-engine → shared`.

## The financial-engine package, internally

```
packages/financial-engine/src/
  money/         Money type (integer cents) + safe arithmetic
  domain/        Domain models: Income, FixedExpense, VariableBudget, FinancialTransaction,
                 FinancialEvent, FinancialGoal, ProtectedPreference, Recommendation,
                 LifestyleScenario, Certainty
  snapshot/      FinancialSnapshot: the core aggregate calculation (Safe-to-Spend, etc.)
  simulation/    simulateExpense() and lifestyle comparison, built on top of a snapshot
  fixtures/      The initial real-life test user fixture
  index.ts       Public API surface (barrel export)
```

Dependency direction within the package: `money → domain → snapshot → simulation`, with
`fixtures` depending on all of the above to assemble the test user. Nothing flows backward — e.g.
`domain` never imports from `snapshot`.

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

## How the web app consumes the engine

`apps/web/next.config.mjs` declares:

```js
transpilePackages: ["@money-copilot/financial-engine", "@money-copilot/shared"]
```

This tells Next.js to run these workspace packages' TypeScript source through its own build
pipeline (rather than treating them as pre-built `node_modules`), since Sprint 1 ships the packages
as source only — see "No persistence, no build output" below.

`apps/web/app/page.tsx` is a **React Server Component** (the App Router default). It imports the
fixture (`initialUserSnapshotInput`), calls `buildFinancialSnapshot` and `compareLifestyles`
directly at render time, and renders the results. There is no API route, no client-side data
fetching, and no state management in Sprint 1 — the "backend" is a pure function call executed
during server rendering. This is intentionally the simplest architecture that satisfies the sprint:
display a computed snapshot. A future sprint introducing persistence or a conversational interface
will need to introduce an API boundary (see `docs/ROADMAP.md`, Sprint 3+).

## No persistence yet

Sprint 1 has **no database and no serialization layer**. All domain objects are in-memory
TypeScript values constructed by `packages/financial-engine/src/fixtures/initial-user.ts`. This is
deliberate — the task was to prove the calculation model works, not to build storage. Recommendation
lifecycle states, transaction deduplication, and multi-month projections all require persistence and
are explicitly deferred (see `docs/ROADMAP.md` Sprint 2+).

## Enforcing "the engine calculates, AI interprets" in code

There is currently no LLM integration to enforce this boundary against yet — but the architecture is
already shaped for it: every user-facing number (Safe-to-Spend, recommended limit, projected
savings, impact classification) is produced by a pure function in `financial-engine` that takes
explicit typed input and returns explicit typed output. A future conversational layer (Sprint 4) must
call these functions and template their output into natural language — it must never compute a
number itself. Code review for that sprint should specifically check that no arithmetic on `Money`
happens outside `packages/financial-engine`.
