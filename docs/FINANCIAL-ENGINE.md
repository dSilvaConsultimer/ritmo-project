# Money Copilot — Financial Engine Reference

This document explains **how** `@money-copilot/financial-engine` calculates what it calculates, so
a future sprint (or a future Claude session) can extend it without re-deriving the reasoning from
scratch. Source of truth is the code; this is the map to it.

## Money

`packages/financial-engine/src/money/money.ts`

Money is always an integer number of cents (`{ cents: number, __brand: "Money" }`). `fromCents`
rejects non-integers and non-finite numbers. `fromReais(x)` is the *only* place decimal reais enter
the system, and it rounds once via `Math.round(x * 100)` — intended only for literal constants
(fixtures, tests, parsing user-typed decimal input), never for chaining computed floats. All
arithmetic afterward (`add`, `subtract`, `scale`, `sum`, `compare`, `min`, `max`, `floorAtZero`) stays
in integer cents. `format()` renders via `Intl.NumberFormat("pt-BR", { style: "currency", currency:
"BRL" })`.

## Certainty

`packages/financial-engine/src/domain/certainty.ts`

Four levels: `ACTUAL` (happened), `CONFIRMED` (future, firm amount), `ESTIMATED` (future,
approximate amount), `UNKNOWN` (future, no amount assigned — `amount` is `null`). Every commitment
in the system (income, fixed expenses, variable budgets, event line items, lifestyle deltas) carries
a `Certainty`. The snapshot's `confidence` field and its `warnings` are derived entirely from which
certainty levels are present — see below.

## FinancialSnapshot

`packages/financial-engine/src/snapshot/snapshot.ts` — `buildFinancialSnapshot(input)`

### Inputs

`asOfDate`, `income[]`, `fixedExpenses[]`, `variableBudgets[]`, `transactions[]`, `events[]`, `goal`,
`protectedPreferences[]`. See `docs/ARCHITECTURE.md` for where each domain type lives.

### Calculation, in order

1. **`gross`** = sum of `income[].grossAmount`.
2. **`taxes`** = sum of `fixedExpenses` whose `category === "Tax"` (a reserved category constant,
   `TAX_CATEGORY`). Tax is modeled as a `FixedExpense`, not a separate input array, so it can carry
   its own certainty like any other commitment — it's singled out purely by category convention when
   computing income.
3. **`usable`** = `gross - taxes`.
4. **`fixed`** = sum of all *other* `fixedExpenses` (housing, family support, car, debt, insurance,
   health, etc).
5. **`variableBudgets` total** = sum of `variableBudgets[].targetAmount` (e.g. the food target).
6. **`actualSpending`** = sum of this-month `transactions` where `kind === "EXPENSE"`
   (`isSameMonth(t.date, asOfDate)`) **plus** the sum of every event line item whose `status ===
   "ALREADY_PAID"`. This is where the rodeo ticket (already paid) lands — once, here, and nowhere
   else. See `breakdownEvent()` in `domain/event.ts`.
7. **Event line items still to come** (`status === "PLANNED"`) split by certainty:
   - `ACTUAL`/`CONFIRMED` → `futureConfirmed` (e.g. the rodeo van fare).
   - `ESTIMATED` → `futureEstimated` (e.g. rodeo drinks).
   - `UNKNOWN` (amount `null`) → **not summed at all**. Instead its label
     (`"<event label>: <line item label>"`) is collected into `unknownLabels`, `hasUnknown` is set,
     and a warning is pushed: `Safe-to-Spend has reduced confidence because the budget for "<label>"
     is still unknown.` This is the mechanism behind NON-NEGOTIABLE RULE #9 — the unknown amount is
     never coerced to zero; it's excluded from arithmetic and surfaced as an explicit gap instead.
8. **`protectedSavings`** = `goal.monthlySavingsTarget` (a single scalar for Sprint 1 — see
   `FinancialGoal`).
9. **`committedTotal`** = `fixed + variableBudgets + actualSpending + futureConfirmed +
   futureEstimated`.
10. **`discretionaryBeforeSavings`** = `usable - committedTotal`. This can be negative.
11. **`projectedMonthEndCash`** = `discretionaryBeforeSavings`. **Important assumption**: Sprint 1
    models no starting bank balance, so this is a *flow* number (what's left over from this month's
    income after commitments), not a bank account balance projection. A future sprint that imports
    real account balances should treat this as the "monthly surplus/deficit" component of a larger
    balance projection, not replace it.
12. **`projectedSavings`** = `min(protectedSavings, discretionaryBeforeSavings)`. If discretionary
    cash comfortably covers the target, the target is what gets saved. If discretionary cash is less
    than the target (or negative), that's what actually gets saved — i.e. the goal is under-met, and
    this number says by how much, directly.
13. **`safeToSpend.total`** = `discretionaryBeforeSavings - protectedSavings`. This can be negative,
    meaning: spending as currently committed would already require dipping into protected savings.
    A warning is added when this happens. It is *not* clamped to zero because clamping would hide a
    real, actionable deficit — see NON-NEGOTIABLE RULE #17 (uncertainty/deficit must stay visible).
14. **`safeToSpend.recommendedForToday`** = `floorAtZero(safeToSpend.total) / daysRemainingInMonth`,
    rounded to the nearest cent. This one *is* floored at zero, because "negative money per day" is
    not a meaningful recommendation to show — the deficit is already visible via `safeToSpend.total`
    and its warning.
15. **`confidence`**: `LOW` if any commitment anywhere is `UNKNOWN`; else `MEDIUM` if any commitment
    is `ESTIMATED`; else `HIGH`. Deliberately binary-escalating (unknown always wins) rather than a
    weighted score — simple, auditable, and matches the product need ("is there a gap or not").

### Why tax is a `FixedExpense` and not a separate field

This keeps a single list (`fixedExpenses`) as the one place recurring commitments live, each with
its own certainty and protection flag, while still letting the snapshot report "usable income" (net
of tax) as a distinct number the product needs. If a future sprint needs tax to have sub-categories
(income tax vs. a specific municipal tax, say), extend by adding more `FixedExpense` entries with
`category: "Tax"` — the sum still works without changing the calculation.

## simulateExpense — the three-zone model

`packages/financial-engine/src/simulation/expense-simulation.ts`

Given a snapshot and a hypothetical `{ amount, category, date }`:

- `recommendedLimit` = `floorAtZero(snapshot.safeToSpend.total)`.
- `discretionaryAfter` = `snapshot.discretionaryBeforeSavings - amount`.
- `projectedSavingsAfter` = `min(snapshot.protectedSavings, discretionaryAfter)`.
- `goalImpact` = `projectedSavingsAfter - projectedSavingsBefore` (≤ 0).
- `compensationRequired` = `floorAtZero(protectedSavings - projectedSavingsAfter)` — the amount that
  would need to be found/cut elsewhere this month to still hit the savings target. Zero means the
  target is untouched by this spend.
- **Status** is classified from `compensationRequired`, not from `amount` vs. `recommendedLimit`
  directly — this matters because it means the three-zone boundary is anchored to *actual goal
  impact*, not an arbitrary spend ceiling:
  - `compensationRequired == 0` → **SAFE**.
  - `0 < compensationRequired <= protectedSavings * cautionCompensationRatio` → **CAUTION**
    ("acceptable stretch").
  - otherwise → **HIGH_IMPACT** ("material impact").

  `cautionCompensationRatio` defaults to **0.15** (15% of the protected savings target) and lives in
  `DEFAULT_SPEND_POLICY` (`SpendPolicy` interface), passed as an explicit optional argument to
  `simulateExpense`. This is a deliberately named, swappable policy object — not a magic number
  buried in the calculation — so a future sprint (or a per-user setting) can change the threshold
  without touching the domain model or the snapshot calculation. See DEC-005.

The user is never blocked: `simulateExpense` always returns a structured result regardless of
status (NON-NEGOTIABLE RULE #7). Warnings are descriptive strings explaining the impact, not
refusals.

## Lifestyle simulation

`packages/financial-engine/src/simulation/lifestyle-simulation.ts`

`simulateLifestyle(baseInput, scenario)` builds a **new** `FinancialSnapshotInput` — spreading the
original and appending synthetic `FixedExpense` entries (category `"Lifestyle Simulation"`) derived
from `scenario.additionalMonthlyExpenses` — and runs it through `buildFinancialSnapshot`. It never
mutates `baseInput` or any of its arrays/objects (verified by test: `initialUserSnapshotInput`'s
array length is checked before/after). `compareLifestyles(baseInput, current, independent)` runs
both scenarios and reports the deltas plus `isIndependentLivingViable`, defined as: independent
living's `projectedSavings` staying non-negative. This is a simple, explicit, swappable definition
of "viable" — a future sprint may want a richer definition (e.g. viable only if `confidence !=
"LOW"` too); change it in one place (`compareLifestyles`) and update this doc.

## What's deliberately not implemented in Sprint 1

- **Recommendation discovery.** The `Recommendation` domain type and its status lifecycle
  (`PENDING → ACCEPTED/MODIFIED/REJECTED → VERIFIED/FAILED`) exist in
  `domain/recommendation.ts`, but nothing generates recommendations yet. See `docs/ROADMAP.md`
  Sprint 5.
- **Deduplication of transactions.** `FinancialTransaction` exists but there's no matching/merge
  logic against a future Open Finance import. Sprint 2.
- **Multi-month projections / a real starting balance.** `projectedMonthEndCash` is a monthly flow
  number, not a running account balance. A future sprint that wants "will I have enough by Sept 27"
  across multiple weeks needs an explicit balance model.

## Extending the engine safely

- New commitment types should carry a `Certainty` and be summed into the appropriate snapshot
  bucket (`fixed`, `variableBudgets`, `futureConfirmed`/`futureEstimated`/unknown) — never invent a
  parallel "silent zero" path for unknown amounts.
- New policy thresholds (like `cautionCompensationRatio`) should be named, documented, optional
  arguments with a `DEFAULT_*` constant — never inlined magic numbers.
- Any new aggregate number added to `FinancialSnapshot` should be derived, not stored redundantly —
  keep `buildFinancialSnapshot` the single place where the math happens.
