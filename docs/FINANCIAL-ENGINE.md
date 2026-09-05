# Money Copilot — Financial Engine Reference

This document explains **how** `@money-copilot/financial-engine` calculates what it calculates, so
a future sprint (or a future Claude session) can extend it without re-deriving the reasoning from
scratch. Source of truth is the code; this is the map to it. Sprint 1 sections remain below, updated
in place where Sprint 2 changed behavior; Sprint 2 additions follow.

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
in the system carries a `Certainty`. `worstCertainty(values)` (Sprint 2) picks the least-certain
value in a set — used to label a derived/aggregate figure (e.g. a Safe-to-Spend breakdown component)
honestly rather than pretending a mixed-certainty sum is fully `ACTUAL`.

## Financial effect classification (Sprint 2)

`packages/financial-engine/src/domain/financial-effect.ts`

A bank transaction is not automatically an expense. `FinancialEffect` distinguishes:

- `CONSUMPTION` — a real purchase; counts against a category budget.
- `INCOME` — money received; never counted as consumption.
- `TRANSFER` — moved between the user's own accounts; never consumption.
- `CARD_PAYMENT` — paying off a credit card bill; the underlying purchases are (or will be) their own
  `CONSUMPTION` transactions — the payment itself is cash movement, not a second expense.
- `DEBT_PAYMENT` — settling a liability that isn't fresh consumption (e.g. an old installment).
- `REFUND` — nets against a prior `CONSUMPTION` (see below), rather than adding to spend.
- `FEE` — counts as spending, but as its own thing, not misattributed to another category.

`isConsumptionLike(effect)` is true only for `CONSUMPTION`/`FEE` — this is the single switch that
keeps `TRANSFER`/`CARD_PAYMENT`/`DEBT_PAYMENT`/`INCOME` out of both the snapshot's `actualSpending`
and the `monthlyCategoryTotals` read model. `REFUND` is handled separately: it's subtracted, not
just excluded, so a purchase that comes back nets to zero rather than vanishing from the record.

## FinancialTransaction (Sprint 2 canonical shape, extended Sprint 3)

`packages/financial-engine/src/domain/transaction.ts`

Redesigned from Sprint 1's simple `{ description, amount, kind: INCOME|EXPENSE }` into the
provider-independent canonical shape: `financialProfileId`, optional `externalProviderId`/
`externalTransactionId` (populated once a real provider exists), `paymentSource`, `date` +
optional `authorizationDate`/`postingDate`, `amount` (always non-negative) + `direction`
(`DEBIT`/`CREDIT` — the raw cash-flow sign, independent of interpretation), `rawDescription` +
`normalizedDescription`, optional `rawMerchant` + `normalizedMerchant` (raw is *never* overwritten —
see Merchant normalization below), `status` (`PENDING`/`POSTED`/`REVERSED`), `certainty`,
`financialEffect`, `category`/`subcategory` (nullable until categorized), `origin`
(`MANUAL`/`IMPORTED`), free-form `metadata` (never used in calculations), `createdAt`/`updatedAt`.
Sprint 3 adds `providerCategory` (the provider's own category, preserved but never authoritative —
see DEC-026) and `installmentMetadata` (installment number/total/original amount/bill id, when a
provider reports it).

`ExternalTransactionInput` (`domain/external-transaction.ts`) is the DTO a real Open Finance
provider maps its own payload into before it becomes a `FinancialTransaction`; it now includes
`financialEffect`/`certainty` directly (the provider adapter is responsible for that interpretation
— see `docs/OPEN-FINANCE.md`, "Amount / sign mapping"), so `financial-engine` never has to guess.
`draftTransactionFromExternalInput` builds the pre-categorization draft — generic, never inspects
`input.provider`.

`PaymentSource` (same file) is extended with optional Sprint 3 fields: `subtype`, `provider`,
`externalAccountId`, `connectionId`, `currency`, `balance` (a `CertainAmount`), `creditCard`
(limit/available/closing/due-date/minimum-payment), `certainty`, `lastSyncedAt` — see DEC-022. All
optional; a manual Sprint 1/2 payment source is still valid with none of them set.
`ExternalAccountInput`/`paymentSourceFromExternalAccount` (`domain/external-account.ts`) is the
provider-agnostic account DTO and its mapping into `PaymentSource`.

`CreditCardBill`/`ExternalBillInput` (`domain/bill.ts`) represents a card's payment cycle (due
date, closing date, total, minimum payment). **Never fed into `FinancialSnapshot`** —
`FinancialSnapshotInput` has no `bills` field, so there is no code path for a bill total to be
summed alongside the individual `CONSUMPTION` transactions that make it up. See
`docs/OPEN-FINANCE.md`, "Credit card bills."

`ProviderConnection`/`SyncRun`/`ProviderError` (`domain/provider.ts`) are the generic (provider-
agnostic) connection lifecycle, sync-run observability, and error taxonomy — see
`docs/OPEN-FINANCE.md` for the full account of how a real provider adapter populates them.

## Merchant normalization

`packages/financial-engine/src/domain/merchant.ts`

`MerchantNormalizationRule { matchType: EXACT|CONTAINS|PREFIX, pattern, normalizedMerchant,
priority }`. `normalizeMerchant(raw, rules)` applies the highest-priority matching rule
case-insensitively and returns the canonical name, or `undefined` if nothing matches — it never
fabricates a value, and it never mutates or discards the raw text (callers keep `rawMerchant`
alongside `normalizedMerchant`). Canonical example: "LOCALIZAGF42", "LOCALIZA RAC", "LOCALIZA RENT"
all normalize to "LOCALIZA" via one `CONTAINS "LOCALIZA"` rule.

## Categorization

`packages/financial-engine/src/domain/category.ts`

`CategoryRule { matchType: EXACT_MERCHANT|CONTAINS_MERCHANT|CONTAINS_DESCRIPTION|
REGEX_DESCRIPTION, pattern, category, subcategory?, priority }`. `categorize(transaction, rules)`
evaluates rules by descending priority, first match wins, falls back to `UNCATEGORIZED` — no
guessing. `REGEX_DESCRIPTION` is capped (200-char pattern, 500-char subject, wrapped in try/catch) as
a pragmatic safety measure, not a formal ReDoS proof; keep regex rules simple and review them when
added.

## Reconciliation & deduplication

`packages/financial-engine/src/domain/reconciliation.ts`

`ReconciliationLink { type: TRANSACTION_TRANSACTION|TRANSACTION_EVENT_LINE_ITEM,
primaryTransactionId, linkedTransactionId?, linkedEventLineItemId?, confidence: HIGH|MEDIUM|LOW,
method: PROVIDER_ID|STABLE_SOURCE_ID|FINGERPRINT|MANUAL, status: CONFIRMED|CANDIDATE|REJECTED }`.

`matchTransactions(a, b)` checks, in order: (1) matching `externalProviderId` +
`externalTransactionId` → HIGH/`PROVIDER_ID`; (2) matching `externalTransactionId` + same
`paymentSource` → HIGH/`STABLE_SOURCE_ID`; (3) a deterministic fallback fingerprint (same amount,
direction, payment source type) with an exact merchant + same date → HIGH/`FINGERPRINT`, or within a
3-day tolerance → MEDIUM/`FINGERPRINT` (the "manual entry, confirmed by next-day import" case); (4)
otherwise LOW (a plausible but unconfirmed duplicate) or NONE.

`findTransactionDuplicates(transactions)` scans pairwise and auto-`CONFIRM`s HIGH/MEDIUM matches;
LOW matches become `CANDIDATE` — **never silently merged**. `excludedTransactionIds(links)` returns
the set of transaction ids a `CONFIRMED` link says to exclude from downstream sums (the non-primary
side of a `TRANSACTION_TRANSACTION` link, or the transaction side of a
`TRANSACTION_EVENT_LINE_ITEM` link — the event's own line item remains the counted source for that
case).

`reconcileEventLineItems(events, transactions)` links an `ALREADY_PAID` event line item to the one
unambiguous transaction of the same amount within 3 days of the event's start date — e.g. the rodeo
ticket (BRL 476.10) exists both as a raw transaction and as the rodeo event's line item; this link
excludes the transaction from `actualSpending`'s transaction-level sum so the event breakdown remains
the sole source for it, avoiding double counting. If more than one transaction could match, or none
do, no link is created — ambiguity never resolves itself silently.

## Recurring expense detection

`packages/financial-engine/src/domain/recurring.ts`

`detectRecurringCandidates(transactions, priorDecisions?)` groups transactions by **(normalized
merchant, amount bucket)** — not merchant alone, so a genuine price change (e.g. a subscription going
from BRL 39.90 to BRL 55.90) forms its own evidence group instead of being blended with the old price
into one inconsistent-amount group. A group needs 2+ occurrences and consistent amounts (±10%) to be
considered at all; confidence is HIGH (3+ occurrences, ~monthly cadence 20–40 days), MEDIUM (2
occurrences with cadence, or 3+ without), or LOW. Every candidate carries an `evidenceKey`
(`merchant:amountBucket`) — a prior `REJECTED` decision for that exact key suppresses it from
reappearing; a materially different amount produces a different key and may resurface. Nothing is
ever auto-declared `CONFIRMED` — a human decides.

## Installments

`packages/financial-engine/src/domain/installment.ts`

`InstallmentPlan { description, originTransactionId?, paymentSourceId?, totalOriginalAmount?,
installmentAmount, installmentNumber?, totalInstallments?, firstDueDate?, certainty, status:
ACTIVE|COMPLETED|CANCELLED }`. `installmentNumber`/`totalInstallments` are `null` when the schedule
is genuinely unknown (the founder's real ~BRL 1,400/month old card debt has no known installment
count) — never guessed. `remainingInstallments(plan)` computes what's left *after* the current one
(3/10 at BRL 200 → 7 remain, BRL 1,400) — it never re-derives or multiplies the original purchase
total. `paymentSourceId` (Sprint 3) ties a plan to the card it's on, used by `matchInstallmentPlans`
below.

`matchInstallmentPlans(manual, providerDerived, asOf)` (Sprint 3) compares a manually-entered plan
(no `originTransactionId`) against a provider-derived one (has one): HIGH confidence requires a
shared `paymentSourceId` AND amounts within 5%; MEDIUM is amounts within 15% alone; otherwise no
match. **Every match is a `CANDIDATE` — never auto-`CONFIRMED`, regardless of confidence** (see
DEC-032) — the founder's manual old-debt estimate is never silently replaced by a provider's
schedule. `getInstallmentPlanMatchCandidates` (`app-services/src/sync.ts`) surfaces these.

`summarizeFutureInstallmentCommitments(plans)` is the read model: `currentPeriodAmount` (this
month's due total across `ACTIVE` plans — this feeds the snapshot's `debtCommitments`),
`next30DaysCommitment`, `next90DaysCommitment`, and `hasIncompleteData` +
`incompletePlanDescriptions` for plans with an unknown schedule. **Unknown-schedule plans are
assumed to continue** through the 30/90-day projection window (never silently treated as ending) —
flagged as incomplete rather than omitted. This is deliberately a read model, not a snapshot
deduction: a BRL 2,400 purchase in 12x is not "BRL 200 this month and nothing else" — the other BRL
2,200 is real future commitment, exposed here, without forcing it all out of this month's
Safe-to-Spend.

## FinancialPosition / Liquidity (Sprint 2, coverage added Sprint 3)

`packages/financial-engine/src/domain/position.ts`

Separates the **Financial Plan** (monthly income/commitments — `FinancialSnapshot`) from **Financial
Position** (actual liquidity at a point in time): `FinancialPosition { asOf, cashBalance,
cardOutstandingBalance, otherLiabilities: each a CertainAmount, source, coverage }`.
`computeLiquidityAwareSafeToSpend(planSafeToSpend, position)` returns the more conservative of the
plan figure and `cashBalance − cardOutstanding − otherLiabilities` — covering both "healthy plan, low
cash" and "large balance, already committed" with one `min()`. When `cashBalance` itself is
`UNKNOWN`, `liquidityAwareSafeToSpend` is `null` (never a fabricated stand-in for real cash) and a
warning explains why; partial data (e.g. unknown card balance) still computes a number but degrades
`confidence` to `PARTIAL` and warns that it may overstate what's really available.
`unknownFinancialPosition(profileId, asOf)` is the honest default when no real balance data exists —
`FinancialSnapshotInput.position` is optional for exactly this reason.

**`coverage: "COMPLETE" | "PARTIAL" | "UNKNOWN"`** (Sprint 3) answers "how much of the accounts we
know about do we actually have balance data for" — COMPLETE only when every discovered account
reports a known balance, PARTIAL when some do and some don't, UNKNOWN when there are none at all.
`buildFinancialPositionFromAccounts(accounts, profileId, asOf, source)` derives a `FinancialPosition`
from a list of `PaymentSource`s (summing `BANK`-kind balances into `cashBalance`, `CREDIT_CARD`-kind
into `cardOutstandingBalance`) — `otherLiabilities` is never inferred from accounts (no account type
represents e.g. a personal loan). `computeLiquidityAwareSafeToSpend` downgrades its own `confidence`
to at most `PARTIAL` whenever `coverage !== "COMPLETE"`, even when the arithmetic itself resolves
cleanly — see DEC-028. Only **provider-synced** payment sources (`provider` field set) are considered
by `buildFinancialPositionFromAccounts`'s caller (`app-services/queries.ts`, `resolvePosition`) — a
manual, categorization-only payment source was never expected to carry balance data and must not
depress coverage artificially (found via a failing test during Sprint 3 — see DEC-022).

## FinancialSnapshot

`packages/financial-engine/src/snapshot/snapshot.ts` — `buildFinancialSnapshot(input)`

### Inputs (Sprint 2)

`asOfDate`, `income[]`, `fixedExpenses[]`, `variableBudgets[]`, `transactions[]`,
`reconciliationLinks[]`, `events[]`, `installmentPlans[]`, `goal`, `protectedPreferences[]`, optional
`position`.

### Calculation, in order

1. **`gross`** = sum of `income[].grossAmount`.
2. **`taxes`** = sum of `fixedExpenses` whose `category === "Tax"` (`TAX_CATEGORY`).
3. **`usable`** = `gross - taxes`.
4. **`fixed`** = sum of all *other* `fixedExpenses` (housing, family support, car, insurance,
   health, etc). As of Sprint 2, debt no longer lives here — see `debtCommitments` below (DEC-011).
5. **`variableBudgets` total** = sum of `variableBudgets[].targetAmount`.
6. **`actualSpending`** = (this month's unreconciled, non-`REVERSED` transactions where
   `isConsumptionLike(financialEffect)`, summed, minus the sum of `REFUND`-effect transactions)
   **plus** every event line item whose `status === "ALREADY_PAID"`. "Unreconciled" excludes any
   transaction id in `excludedTransactionIds(reconciliationLinks)` — this is where the rodeo ticket's
   raw transaction is excluded so only its event line item counts it, once.
7. **Event line items still to come** (`status === "PLANNED"`), unchanged from Sprint 1: `ACTUAL`/
   `CONFIRMED` → `futureConfirmed`; `ESTIMATED` → `futureEstimated`; `UNKNOWN` (amount `null`) → not
   summed, label collected into `unknownLabels`, warning pushed, confidence degrades.
8. **`debtCommitments`** (Sprint 2) = `summarizeFutureInstallmentCommitments(installmentPlans)
   .currentPeriodAmount` — this month's due amount across `ACTIVE` installment plans. An incomplete
   schedule adds a warning and pushes `confidence` toward `MEDIUM`/`LOW`, same mechanism as any other
   estimated/unknown commitment.
9. **`protectedSavings`** = `goal.monthlySavingsTarget`.
10. **`committedTotal`** = `fixed + variableBudgets + actualSpending + futureConfirmed +
    futureEstimated + debtCommitments`.
11. **`discretionaryBeforeSavings`** = `usable - committedTotal`. Can be negative.
12. **`projectedMonthEndCash`** = `discretionaryBeforeSavings` (still a monthly cash-flow number, not
    a bank balance — see `FinancialPosition` above for the actual-balance view).
13. **`projectedSavings`** = `min(protectedSavings, discretionaryBeforeSavings)`.
14. **`safeToSpend.total`** (the "plan" Safe-to-Spend) = `discretionaryBeforeSavings -
    protectedSavings`. Not clamped at zero — a negative value is a real, visible deficit.
15. **`safeToSpend.recommendedForToday`** = `floorAtZero(safeToSpend.total) /
    daysRemainingInMonth`, rounded to the nearest cent (floored here only, since "negative money per
    day" isn't a meaningful daily figure — the deficit is already visible via `safeToSpend.total`).
16. **`confidence`**: `LOW` if any commitment anywhere (now including installment plans) is
    `UNKNOWN`/incomplete; else `MEDIUM` if anything is `ESTIMATED`; else `HIGH`.
17. **`safeToSpendBreakdown`** (Sprint 2) — see below.
18. **`liquidity`** (Sprint 2) = `computeLiquidityAwareSafeToSpend(safeToSpend.total, position)`, or
    the honest "unknown" shape when `input.position` is omitted.

### Safe-to-Spend breakdown (Sprint 2 — auditability)

`safeToSpendBreakdown.components` is an ordered, signed list — `USABLE_INCOME` (positive), then
`FIXED_COMMITMENTS`, `VARIABLE_BUDGETS`, `ACTUAL_SPENDING`, `DEBT_COMMITMENTS`, `FUTURE_CONFIRMED`,
`FUTURE_ESTIMATED`, `PROTECTED_SAVINGS` (all negative deductions), each carrying its own `certainty`
(via `worstCertainty` over its contributing items). **Summing every component's `amount` always
equals `safeToSpendBreakdown.total`, which always equals `safeToSpend.total`** — by construction
(the breakdown is built from the exact same intermediate values as the headline number, never
recomputed independently), and pinned by a test that would fail immediately if the two ever
diverged. `unknownLabels` lists commitments intentionally excluded rather than treated as zero. This
is what lets a UI (or a future conversational layer) answer "why is my Safe-to-Spend BRL X?" without
an LLM — see `apps/web/app/page.tsx`, section 2.

### Why the Sprint 1 number (BRL 2,478.90) became BRL 2,171.11

See `docs/DECISIONS.md` DEC-013 for the full account. Short version: Sprint 1's only transaction was
one BRL 45 iFood dinner; Sprint 2 adds five more real transactions the founder provided (BRL 307.79
total) that legitimately increase `actualSpending`, and reclassifies the old debt from `fixed` into
`debtCommitments` (revenue-neutral). `247_890 − 30_779 = 217_111` cents, pinned by a regression test.

## simulateExpense — the three-zone model

`packages/financial-engine/src/simulation/expense-simulation.ts`

Unchanged from Sprint 1 in mechanism (see DEC-018 — the 15% `cautionCompensationRatio` remains an
explicitly temporary, configurable `SpendPolicy` default, reconfirmed, not made a universal rule):

- `recommendedLimit` = `floorAtZero(snapshot.safeToSpend.total)`.
- `compensationRequired` = `floorAtZero(protectedSavings - projectedSavingsAfter)`.
- `compensationRequired == 0` → SAFE; `<= protectedSavings * cautionCompensationRatio` → CAUTION;
  otherwise → HIGH_IMPACT. Never blocks the user (RULE #7).

## Spending envelope, daily guidance, replan, goal/category status (Sprint 4)

`packages/financial-engine/src/simulation/envelope.ts`, `replan.ts`,
`packages/financial-engine/src/reporting/status.ts`

Added for the AI copilot (`docs/AI-COPILOT.md`) so the LLM never has to invent these numbers itself:

- `getSpendingEnvelope(snapshot, policy?, categoryHeadroom?)` — the deterministic answer to "how much
  can I spend?" with no specific amount in mind. Reuses `simulateExpense`'s exact
  `DEFAULT_SPEND_POLICY`/`cautionCompensationRatio`, not a new threshold: `recommendedAmount =
  floorAtZero(safeToSpend.total)`; `cautionAmount = highImpactThreshold =
  floorAtZero(safeToSpend.total + protectedSavings * cautionCompensationRatio)`. Cross-validated in
  `envelope.test.ts` against `simulateExpense`'s own classification at the exact boundary amounts.
- `getDailyGuidance(snapshot)` — thin wrapper packaging `safeToSpend.recommendedForToday` with its
  confidence/warnings; no new arithmetic.
- `replanAfterExpense({ previousTarget, actualExpenseAmount, snapshotAfter })` — recalculates guidance
  after the user reports spending more (or less) than a prior recommendation. Takes the ALREADY
  rebuilt post-expense snapshot (the caller — `app-services` — records the transaction and rebuilds
  the snapshot first); returns `newSafeToSpend`, `newProjectedSavings`, `goalGap`/
  `compensationRequired` (`floorAtZero(protectedSavings - newProjectedSavings)`), and warnings. Never
  invents cost-cutting suggestions (Sprint 5 territory) — only exposes the deterministic facts.
- `getGoalStatus(goal, snapshot)` — monthly savings target vs. this month's projected savings and gap.
  Deliberately does NOT compute a reserve-progress percentage or MET/IN_PROGRESS status for
  `targetReserveAmount` — this codebase has no accumulated-reserve-balance data model, so that would be
  invented, not deterministic.
- `getCategoryBudgetStatus(variableBudgets, transactions, reconciliationLinks, asOfDate)` — pairs each
  `VariableBudget` target with actual net spend from `monthlyCategoryTotals`, exposing `remaining`
  (may be negative) and `overBudget`.

## Lifestyle simulation

`packages/financial-engine/src/simulation/lifestyle-simulation.ts`,
`packages/financial-engine/src/domain/scenario.ts`

`simulateLifestyle`/`compareLifestyles` are structurally unchanged (still non-mutating — see
`domain/scenario.ts` `LifestyleScenario`/`LifestyleDelta`). **Viability changed** (DEC-010): instead
of a boolean, `compareLifestyles` returns `currentViability`/`independentViability`, each a
`LifestyleViability` (`UNSUSTAINABLE`/`FRAGILE`/`SUSTAINABLE`) from `classifyLifestyleViability
(projectedSavings, protectedSavingsTarget)` — negative projected savings is `UNSUSTAINABLE`; below
the protected target but non-negative is `FRAGILE`; at or above the target is `SUSTAINABLE`. No
hardcoded income percentage is used, per the brief's explicit instruction.

## Read models (reporting)

`packages/financial-engine/src/reporting/reporting.ts`

Pure functions over transactions + reconciliation links, used by the web UI and directly testable
without any snapshot/DB involvement:

- `monthlyTransactionList(transactions, asOfDate)` — every transaction that month, in date order,
  regardless of status (nothing hidden).
- `monthlyCategoryTotals(transactions, reconciliationLinks, asOfDate)` — net spend per
  category/subcategory: `CONSUMPTION`/`FEE` add, `REFUND` subtracts, everything else
  (`TRANSFER`/`CARD_PAYMENT`/`DEBT_PAYMENT`/`INCOME`) and reconciled-away transactions are excluded.
  The old debt installment never appears here — it isn't a transaction at all.
- `uncategorizedTransactions(...)` — the subset still `UNCATEGORIZED`.
- `reconciliationCandidates(links)` — links still `CANDIDATE` (awaiting a human decision), for a
  "possible duplicates" review queue.

## What's deliberately not implemented yet

- **Recommendation discovery** (`domain/recommendation.ts` model exists; no discovery engine).
  Sprint 5.
- **Multi-month projections / a real starting balance beyond the current snapshot** —
  `FinancialPosition` gives a point-in-time liquidity read; a running multi-month balance projection
  is still future work.
- **Per-installment due-date rows** (see DEC-016) and **transaction classification history** (see
  DEC-015) — both documented simplifications, not gaps waiting to be "fixed," just deferred until a
  concrete need exists.
- **Automatic old-debt reconciliation** (see DEC-032) — `matchInstallmentPlans` only ever produces a
  human-reviewable candidate, never auto-replaces the manual estimate.
- **Real Pluggy sandbox validation** — the provider integration (Sprint 3) is fully implemented and
  contract-tested (`MockProvider`, injected fake client, sanitized fixtures), but was not exercised
  against a live Pluggy sandbox account in this sprint (no credentials available) — see
  `docs/OPEN-FINANCE.md`, "Known provider limitations."

Real Open Finance import (Sprint 3) and the live database-backed web UI (Sprint 3, DEC-024,
superseding DEC-019) are now implemented — see `docs/OPEN-FINANCE.md` and
`packages/app-services/`.

A conversational AI layer (Sprint 4) is now implemented (`docs/AI-COPILOT.md`) — it calls the exact
functions on this page and never performs its own arithmetic. It still deliberately does NOT
implement automatic cost-cutting recommendations (Sprint 5's Recommendation Engine) or real-world
venue/product search (Sprint 6's concierge).

## Extending the engine safely

- New commitment types should carry a `Certainty` and be summed into the appropriate snapshot bucket
  — never invent a parallel "silent zero" path for unknown amounts.
- New policy thresholds should be named, documented, optional arguments with a `DEFAULT_*` constant
  — never inlined magic numbers.
- Any new aggregate number added to `FinancialSnapshot` should be derived, not stored redundantly —
  keep `buildFinancialSnapshot` the single place where the math happens, and if it feeds
  `safeToSpendBreakdown`, make sure the breakdown component reuses the exact same intermediate value
  rather than recomputing it (that's what keeps the "components sum to total" invariant free).
- A financial effect that represents real spending must be added to `CONSUMPTION_LIKE_EFFECTS`
  (`domain/financial-effect.ts`) deliberately, with a comment explaining why — this set is the single
  gate against double-counting card payments/transfers/debt settlement as fresh consumption.
