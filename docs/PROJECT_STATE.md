# Money Copilot — Project State

**This file is the canonical persistent project memory.** Before every future sprint, read this
file, plus `docs/PRODUCT.md`, `docs/ARCHITECTURE.md`, `docs/FINANCIAL-ENGINE.md`,
`docs/ROADMAP.md`, and `docs/DECISIONS.md`, in that order. This documentation is more authoritative
than assumptions carried over from a chat session. If a new request conflicts with a rule documented
here: identify the conflict, explain the existing rule, do not silently change it, implement the new
behavior only if it clearly supersedes the old decision, and record the change in
`docs/DECISIONS.md` (mark the old decision superseded, add a new one — never rewrite history).

Last updated: **2026-09-05, end of Sprint 1.**

---

## NON-NEGOTIABLE PRODUCT RULES

1. Financial calculations are deterministic application logic.
2. LLMs do not calculate or invent financial limits.
3. Monetary values must internally use integer cents. Never use floating-point arithmetic for money.
4. Credit cards are PAYMENT SOURCES, not financial expense categories (e.g. Nubank → iFood → Food,
   never Nubank → "Credit Card Expense"). This prevents double counting.
5. Protected expenses must never automatically be recommended for reduction.
6. BRL 1,000 monthly support to the user's mother is protected and non-negotiable.
7. Spending above the recommended amount is allowed. The system recalculates the plan instead of
   blocking or judging the user.
8. Future events must affect Safe-to-Spend BEFORE they occur.
9. Unknown future-event budgets must NEVER silently be interpreted as zero. They must generate a
   warning / incomplete-confidence state.
10. Accepted future recommendations must eventually be verifiable against imported financial data.
11. Rejected recommendations should not repeatedly return unless material context changes.
12. Manual transactions and later Open Finance imported transactions must eventually support
    deduplication.
13. The system must support simulation of future lifestyles without modifying real financial data.
14. Independent-living simulation must be possible before the user actually moves out.
15. The product should optimize around the life the user wants, not blindly minimize every expense.
16. The system should distinguish: actual data, estimated data, confirmed future data, unknown data.
17. Financial uncertainty must be visible instead of hidden.

These are enforced today by: `Money` (rule 3, `packages/financial-engine/src/money/money.ts`),
`PaymentSource` vs. `category` (rule 4, `domain/transaction.ts`), `FixedExpense.protected` +
`ProtectedPreference` (rules 5–6, `domain/expense.ts` + `domain/preference.ts`), `simulateExpense`
never throwing/blocking (rule 7, `simulation/expense-simulation.ts`), event line-item breakdown
(rule 8, `domain/event.ts`), `Certainty.UNKNOWN` handling in `buildFinancialSnapshot` (rule 9, 16,
17, `snapshot/snapshot.ts`), and `LifestyleScenario` simulation never mutating input (rules 13–14,
`simulation/lifestyle-simulation.ts`). Rules 10–12 are modeled (`Recommendation` status lifecycle,
`FinancialTransaction`) but not yet operational — see "Partially completed capabilities" below.

---

## Product objective

Answer "Can I afford to do this without damaging the rest of my financial plan?" — not a backward-
looking expense tracker. Primary current user goal: become financially ready to live independently
(currently lives with mother, already pays own rent). Full detail: `docs/PRODUCT.md`.

## Current architecture

pnpm workspace monorepo: `apps/web` (Next.js 16 App Router, React 19, TypeScript, Turbopack) +
`packages/financial-engine` (zero framework dependencies, the priority package) +
`packages/shared` (generic `Id`/id-generation utility only — no domain types). Full detail:
`docs/ARCHITECTURE.md`. Calculation detail: `docs/FINANCIAL-ENGINE.md`.

## Current sprint

**Sprint 1 — complete.** See final report delivered to the founder for the full account; this file
carries forward only what a future sprint needs to know.

## Completed capabilities

- `Money`: integer-cent arithmetic, safe constructors, formatting (pt-BR), no floating point.
- Domain model: `Income`, `FixedExpense` (incl. `TAX_CATEGORY` convention and `protected` flag),
  `VariableBudget`, `FinancialTransaction` + `PaymentSource`, `FinancialEvent` +
  `FinancialEventLineItem` (+ `breakdownEvent`), `FinancialGoal`, `ProtectedPreference` (+
  `protectsExpense`), `LifestyleScenario` + `LifestyleDelta`, `Recommendation` (model only, see
  below).
- `Certainty` model (`ACTUAL | CONFIRMED | ESTIMATED | UNKNOWN`) attached to every commitment.
- `buildFinancialSnapshot`: full Safe-to-Spend calculation, confidence levels, warnings — see
  `docs/FINANCIAL-ENGINE.md` for the exact formula, line by line.
- `simulateExpense`: three-zone (SAFE/CAUTION/HIGH_IMPACT) impact classification, anchored to
  `compensationRequired` against a named, swappable `SpendPolicy`.
- `simulateLifestyle` / `compareLifestyles`: CURRENT_LIFESTYLE vs. INDEPENDENT_LIVING, non-mutating.
- Initial real-life fixture (`fixtures/initial-user.ts`) matching the founder's actual numbers (see
  "Confirmed user requirements" below).
- Minimal Next.js UI (`apps/web/app/page.tsx`) displaying the fixture snapshot and the lifestyle
  comparison, server-rendered, no client state.
- 39 passing Vitest tests covering all 20 required test scenarios (see "Test status").
- Full documentation set (this file plus the five others listed at the top).

## Partially completed capabilities

- **Recommendation lifecycle** (`domain/recommendation.ts`): the type and all six statuses
  (`PENDING/ACCEPTED/MODIFIED/REJECTED/VERIFIED/FAILED`) exist and are exercised by one test, but
  there is no discovery engine, no storage, and nothing produces a real `Recommendation` yet. Slated
  for Sprint 5.
- **Transaction deduplication** (rule 12): `FinancialTransaction` exists; no fingerprinting or
  matching logic exists yet. Slated for Sprint 2 (design) / Sprint 3 (real use against Open Finance
  imports).
- **Recommendation verification** (rule 10): the `RecommendationVerification` shape exists; nothing
  can verify anything yet because there is no imported financial data to verify against. Slated for
  Sprint 3.

## Financial/business rules

See "NON-NEGOTIABLE PRODUCT RULES" above, and `docs/FINANCIAL-ENGINE.md` for the exact calculation
each rule maps to.

## UX rules

- The user is never blocked from spending (rule 7) — the UI/future conversational layer must always
  present impact, never a refusal.
- Uncertainty (rule 17) must always be shown alongside any monetary total derived from a snapshot
  whose `confidence !== "HIGH"` — never present Safe-to-Spend as a clean, confident number when the
  underlying data has an unknown gap.
- No design polish was required or attempted in Sprint 1 (dark, minimal, inline-styled cards).

## Confirmed user requirements (the initial fixture, as given by the founder)

- PJ gross monthly revenue: BRL 15,000. Monthly taxes: BRL 870 (ACTUAL).
- Rent + condominium: BRL 1,600 (ACTUAL, paid personally by the user).
- Mother support: BRL 1,000/month, **protected, non-negotiable** (rule 6).
- Car (Localiza / Fiat Pulse): BRL 2,715 (ACTUAL).
- Existing credit card bill installment: ~BRL 1,400, **certainty ESTIMATED** (as explicitly stated
  by the founder).
- Life insurance BRL 360, gym BRL 150, footvolley BRL 155 (all ACTUAL).
- Food target: BRL 1,500 (ESTIMATED variable budget).
- Nubank is a payment source, never a generic ~BRL 1,000–1,500 expense line — its transactions are
  categorized individually (demonstrated with one iFood/Food transaction in the fixture).
- Protected monthly savings target: BRL 2,000 (this month's working target, not a permanent
  constant — the founder was explicit about this).
- Rodeo event: ticket BRL 476.10 (ACTUAL, ALREADY_PAID), transportation/van BRL 100 (CONFIRMED,
  PLANNED), drinks BRL 150 (ESTIMATED, PLANNED).
- Beach trip: Sept 25–27, budget UNKNOWN (must warn, never zero).
- Independent-living delta assumptions (all ESTIMATED): dinner/food +BRL 500, cleaning +BRL 300,
  household supplies +BRL 125 (total BRL 925/month).
- Fixture "as of" date: **2026-09-05** (see DEC-008) — chosen to match real-world current date at
  build time and keep the rodeo/beach-trip timeline coherent within the same month.

## Current assumptions (need eventual confirmation from the founder)

- `cautionCompensationRatio = 0.15` (15% of the protected savings target) as the SAFE/CAUTION
  boundary, and the implicit CAUTION/HIGH_IMPACT boundary above it — founder has not confirmed these
  specific numbers; they are a reasonable, clearly-documented, easily-changed default (DEC-005).
  **Not the same as** the example ratios (~350/450/above-450) mentioned in the product vision
  conversation — those were illustrative of the *user-facing* three-tier presentation for a specific
  scenario, not necessarily this policy's exact thresholds. Revisit once real usage data exists.
  Non-negotiable rule #7 is already fully honored regardless of where the threshold sits.
- `isIndependentLivingViable` is defined as "projected savings stays non-negative" — a simple
  placeholder definition (see `docs/FINANCIAL-ENGINE.md`), not confirmed by the founder as the
  right bar for "viable."
- No starting bank account balance is modeled; `projectedMonthEndCash` is a monthly cash-flow
  number, not an account balance projection. Founder has not been asked whether Sprint 2+ needs a
  real starting balance.
- TypeScript pinned to 6.0.3 rather than the newer 7.0.2 purely due to `typescript-eslint` lacking
  TS7 support at implementation time (DEC-007) — revisit when tooling catches up.

## Protected behaviors

- Mother support (BRL 1,000, `protected: true`) must never be auto-flagged for reduction by any
  future recommendation engine (rules 5–6). Enforced today via `FixedExpense.protected` +
  `ProtectedPreference` linking to it; a real recommendation engine (Sprint 5) must check both.
- The user is never blocked from overspending (rule 7) — `simulateExpense` has no throw/reject path
  for any status.
- Already-paid amounts (e.g. the rodeo ticket) are never reserved twice — enforced by
  `breakdownEvent` routing `ALREADY_PAID` items to `actualSpending` only, never to
  `futureConfirmed`/`futureEstimated`.

## Rejected approaches

- **Modeling Nubank's credit card bill as a single monthly expense line** — explicitly rejected by
  the founder brief (rule 4); would double-count against categorized underlying purchases once
  Open Finance imports arrive.
- **A `Money` companion namespace object** (`Money.add(...)` alongside the `Money` type) — attempted,
  but TypeScript's `isolatedModules` flags re-exporting a type and a same-named value from one barrel
  file as `TS2323: Cannot redeclare exported variable`. Reverted to named function exports only
  (`add`, `subtract`, etc., typically imported as `import * as M from "..."`). If revisited, name the
  namespace something other than `Money` (e.g. `MoneyOps`).
- **`.js`-suffixed relative imports** inside `financial-engine`/`shared` (the standard Node-ESM
  convention for TS source) — worked in `tsc`/Vitest but broke Next.js 16 Turbopack's
  `transpilePackages` resolution. See DEC-006. Now extensionless throughout both packages.

## Technical debt

- No persistence layer at all — every domain object is an in-memory fixture. Acceptable for Sprint
  1's stated goal; must be addressed starting Sprint 2 once transactions need to accumulate over
  time.
- No API boundary between the web app and the engine — `page.tsx` calls the engine directly as a
  server component. Fine while there's no client interactivity or external consumer; will need
  revisiting once a conversational layer (Sprint 4) or a second client needs the same calculations.
- `apps/web` renders everything with inline styles (`React.CSSProperties` literals) — acceptable per
  the "no design polish required" instruction, but not a pattern to scale past a few more screens.
- Root `package.json`'s `build`/`test` scripts filter to `./packages/* ./apps/*`, meaning
  `packages/shared` (which has no `build` script) is silently skipped by `pnpm run build`. Not a bug
  today (shared has nothing to build — it's consumed as source) but worth a comment or explicit
  `build` no-op script if shared ever needs a real build step.

## Known bugs

None known at end of Sprint 1.

## Test status

39/39 Vitest tests passing in `packages/financial-engine` (the only package with logic to test).
Covers all 20 required Sprint 1 scenarios: integer-cent arithmetic (incl. no float drift), fixed
commitments, protected mother support, current-lifestyle snapshot, independent-living simulation,
already-paid-event-not-double-reserved, confirmed future rodeo transport, estimated rodeo drinks,
unknown beach-trip warning (and non-zero treatment), safe/caution/high-impact expense simulation,
above-recommendation spending allowed + recalculated, before/after savings projection,
compensation-required calculation, no-floating-point assertions, credit-card-as-payment-source (not
category), lifestyle simulation non-mutation, and protected-preference representation. Run with:
`pnpm --filter @money-copilot/financial-engine run test`.

## Integration status

No Open Finance, no Pluggy/Belvo, no bank/credit card connections, no WhatsApp, no LLM API
(OpenAI/Anthropic/other) — all correctly out of scope for Sprint 1 and not present anywhere in the
codebase.

## Open questions

- What should `cautionCompensationRatio` actually be, once there's real usage data or founder
  input on how "acceptable stretch" should feel in practice?
- Does the founder want a real starting bank balance modeled before Sprint 2, or is the monthly
  cash-flow framing (no balance) sufficient for longer?
- Is BRL 2,000 protected savings a fixed monthly target going forward, or should it become a
  computed function of the BRL 925/month independent-living delta plus some reserve-months target
  (rule mentions a `targetReserveAmount` on `FinancialGoal` that Sprint 1 leaves unset)?

## Next recommended sprint

**Sprint 2 — Transactions + normalization + categorization + recurring expenses + installments +
deduplication.** See `docs/ROADMAP.md` for the detailed scope. This is also very likely the sprint
that must introduce the first persistence layer, since transactions need to accumulate across time
in a way in-memory fixtures cannot support.

## Risks

- **Threshold drift without data**: the CAUTION/HIGH_IMPACT boundary (15%) is a guess. If Sprint 4's
  conversational layer starts quoting these zones to the user in natural language, an unvalidated
  threshold could produce advice that feels wrong even though the underlying math is correct.
- **Persistence design debt compounding**: every sprint that adds a new domain concept without
  persistence (Sprint 1's `Recommendation` model, for instance) risks needing a larger, more
  disruptive persistence retrofit later if Sprint 2 doesn't get the storage foundation right.
- **Version currency**: Sprint 1 pinned to very recent (in some cases release-day-adjacent) versions
  of Next.js/React/ESLint/TypeScript-tooling because they were the actual latest at implementation
  time. Future sprints should re-check the registry rather than assume these pins are still current,
  and should watch for `typescript-eslint` gaining TypeScript 7 support (see DEC-007).
