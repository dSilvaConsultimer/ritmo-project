# Money Copilot — Project State

**This file is the canonical persistent project memory.** Before every future sprint, read this
file, plus `docs/PRODUCT.md`, `docs/ARCHITECTURE.md`, `docs/FINANCIAL-ENGINE.md`,
`docs/ROADMAP.md`, and `docs/DECISIONS.md`, in that order. This documentation is more authoritative
than assumptions carried over from a chat session. If a new request conflicts with a rule documented
here: identify the conflict, explain the existing rule, do not silently change it, implement the new
behavior only if it clearly supersedes the old decision, and record the change in
`docs/DECISIONS.md` (mark the old decision superseded, add a new one — never rewrite history).

Last updated: **2026-09-05, end of Sprint 2.**

---

## NON-NEGOTIABLE PRODUCT RULES

1. Financial calculations are deterministic application logic.
2. LLMs do not calculate or invent financial limits.
3. Monetary values must internally use integer cents. Never use floating-point arithmetic for money.
4. Credit cards are PAYMENT SOURCES, not financial expense categories (e.g. Nubank → iFood → Food,
   never Nubank → "Credit Card Expense"). This prevents double counting. **Sprint 2 extends this**:
   a bank/card transaction is not automatically an expense at all — its `FinancialEffect`
   (CONSUMPTION/INCOME/TRANSFER/CARD_PAYMENT/DEBT_PAYMENT/REFUND/FEE) determines whether, and how,
   it counts. A card bill payment is never a second expense on top of the purchases it settles.
5. Protected expenses must never automatically be recommended for reduction.
6. BRL 1,000 monthly support to the user's mother is protected and non-negotiable.
7. Spending above the recommended amount is allowed. The system recalculates the plan instead of
   blocking or judging the user.
8. Future events must affect Safe-to-Spend BEFORE they occur.
9. Unknown future-event budgets must NEVER silently be interpreted as zero. They must generate a
   warning / incomplete-confidence state. (Sprint 2: this now also covers installment plans with an
   incomplete schedule and a `FinancialPosition` with unknown liquidity — same mechanism, more
   places it applies.)
10. Accepted future recommendations must eventually be verifiable against imported financial data.
11. Rejected recommendations should not repeatedly return unless material context changes. (Sprint
    2: the same principle now also governs rejected recurring-expense candidates — see
    `domain/recurring.ts`.)
12. Manual transactions and later Open Finance imported transactions must eventually support
    deduplication. **Sprint 2 implements this**: see `domain/reconciliation.ts`.
13. The system must support simulation of future lifestyles without modifying real financial data.
14. Independent-living simulation must be possible before the user actually moves out.
15. The product should optimize around the life the user wants, not blindly minimize every expense.
16. The system should distinguish: actual data, estimated data, confirmed future data, unknown data.
17. Financial uncertainty must be visible instead of hidden.

These are enforced today by: `Money` (rule 3, `packages/financial-engine/src/money/money.ts`),
`PaymentSource` vs. `category` + `FinancialEffect` (rule 4, `domain/transaction.ts`,
`domain/financial-effect.ts`), `FixedExpense.protected` + `ProtectedPreference` (rules 5–6,
`domain/expense.ts` + `domain/preference.ts`), `simulateExpense` never throwing/blocking (rule 7,
`simulation/expense-simulation.ts`), event line-item breakdown + installment-plan future commitments
(rule 8, `domain/event.ts`, `domain/installment.ts`), `Certainty.UNKNOWN` handling in
`buildFinancialSnapshot` + `FinancialPosition` (rules 9, 16, 17, `snapshot/snapshot.ts`,
`domain/position.ts`), `domain/reconciliation.ts` (rule 12, new in Sprint 2), and
`LifestyleScenario` simulation never mutating input (rules 13–14,
`simulation/lifestyle-simulation.ts`). Rule 10 is modeled (`Recommendation` status lifecycle) but
still not operational — no recommendation discovery engine and no real imported data exist yet to
verify against (Sprint 3/5).

---

## Product objective

Answer "Can I afford to do this without damaging the rest of my financial plan?" — not a backward-
looking expense tracker. Primary current user goal: become financially ready to live independently
(currently lives with mother, already pays own rent). Full detail: `docs/PRODUCT.md`.

## Current architecture

pnpm workspace monorepo: `apps/web` (Next.js 16 App Router, React 19, TypeScript, Turbopack, renders
from the in-memory fixture) + `packages/financial-engine` (zero framework/database dependencies,
the priority package) + `packages/persistence` (Drizzle ORM + PGlite, new in Sprint 2) +
`packages/shared` (generic `Id`/id-generation utility only — no domain types). Full detail:
`docs/ARCHITECTURE.md`. Calculation detail: `docs/FINANCIAL-ENGINE.md`.

## Current sprint

**Sprint 2 — complete.** See the Sprint 2 final report delivered to the founder for the full
account; this file carries forward only what a future sprint needs to know.

## Completed capabilities

**Carried forward from Sprint 1** (see `docs/DECISIONS.md` DEC-001–008 for why): `Money` integer-cent
arithmetic; `Certainty` model; `FinancialGoal`; `ProtectedPreference`; `Recommendation` (model only);
`LifestyleScenario`/`LifestyleDelta`; the founder's fixed-cost fixture (housing, mother support, car,
insurance, gym, footvolley, food target); the rodeo/beach-trip `FinancialEvent`s; Next.js display UI
shell.

**New in Sprint 2:**

- `FinancialEffect` classification (`CONSUMPTION|INCOME|TRANSFER|CARD_PAYMENT|DEBT_PAYMENT|
  REFUND|FEE`) and `isConsumptionLike` — the mechanism preventing card-payment/transfer double
  counting.
- Canonical `FinancialTransaction` (provider-independent shape: external ids, payment source,
  authorization/posting dates, direction, raw+normalized description/merchant, status, financial
  effect, category/subcategory, origin, metadata) and `ExternalTransactionInput` DTO for a future
  provider mapping.
- `MerchantNormalizationRule` + `normalizeMerchant` (deterministic, raw text always preserved).
- `CategoryRule` + `categorize` (deterministic, priority-ordered, falls back to `UNCATEGORIZED`,
  bounded/safe `REGEX_DESCRIPTION` support).
- `RecurringExpenseCandidate` + `detectRecurringCandidates` (grouped by merchant + amount bucket;
  confidence-scored; never auto-confirmed; rejected evidence suppressed from reappearing).
- `InstallmentPlan` + `remainingInstallments` + `summarizeFutureInstallmentCommitments`
  (incomplete-schedule-aware; feeds `debtCommitments` and a 30/90-day future-commitment read model,
  without deducting the whole future commitment from this month).
- `ReconciliationLink` + `matchTransactions`/`findTransactionDuplicates`/
  `reconcileEventLineItems`/`excludedTransactionIds` (provider-id → stable-id → fingerprint →
  candidate matching; HIGH/MEDIUM auto-confirm, LOW stays a human-reviewable candidate).
- `FinancialProfile` (minimal ownership model, no auth yet, no unnecessary PII).
- `FinancialPosition` + `computeLiquidityAwareSafeToSpend` (Financial Plan vs. Financial Position
  separation; `min(plan, liquidity)`; honest `null` when cash balance is unknown).
- `LifestyleViability` tri-state (`UNSUSTAINABLE|FRAGILE|SUSTAINABLE`) replacing Sprint 1's boolean
  (DEC-010).
- `SafeToSpendBreakdown` — an ordered, signed, per-component-certainty audit trail that always sums
  exactly to `safeToSpend.total` (verified by test, not just by convention).
- Read models (`packages/financial-engine/src/reporting/`): `monthlyTransactionList`,
  `monthlyCategoryTotals`, `uncategorizedTransactions`, `reconciliationCandidates`.
- First persistence layer (`packages/persistence`): Drizzle schema (20 tables) + versioned SQL
  migrations + idempotent seed + `loadFinancialSnapshotInput` (DB → domain reconstruction, proven to
  reproduce the exact fixture-based Safe-to-Spend).
- Extended debug/validation web UI: 10 sections (Financial Snapshot, Safe-to-Spend Breakdown,
  Transactions, Category Totals, Uncategorized, Installments/Future Commitments, Recurring
  Candidates, Reconciliation/Possible Duplicates, Current vs. Independent Living, Data
  Confidence/Warnings).
- Enriched fixture: 7 real September transactions (iFood, Mineiros Dog, Adega do Rai, rodeo ticket,
  OXXO, TikTok Shop, PagSeguro) replacing Sprint 1's single iFood entry; the old ~BRL 1,400 debt is
  now an `InstallmentPlan` with an honestly-unknown schedule instead of a flat `FixedExpense`.
- 95 financial-engine tests + 4 persistence tests = **99 automated tests**, all passing.

## Partially completed capabilities

- **Recommendation lifecycle** (`domain/recommendation.ts`): type + all six statuses exist and are
  exercised by one test; no discovery engine, no persistence-backed CRUD for recommendations was
  exercised end-to-end this sprint (the `recommendations` table exists in the schema but has no
  repository functions yet — straightforward to add, just not needed until Sprint 5's discovery
  engine produces real rows). Slated for Sprint 5.
- **Recommendation verification** (rule 10): the shape exists; nothing can verify anything yet
  because there is no real imported financial data to verify against. Slated for Sprint 3/5.
- **Live database-backed web UI**: the persistence layer is fully proven by its own test suite, but
  the web UI still renders from the in-memory fixture rather than reading from PGlite at request
  time — a deliberate scope decision (DEC-019), not an oversight. Likely bundled into Sprint 3.
- **Per-installment due-date rows** and **transaction-classification history**: both explicitly
  simplified out of Sprint 2 (DEC-015, DEC-016) — additive, not blocking, when a concrete need
  arises.

## Financial/business rules

See "NON-NEGOTIABLE PRODUCT RULES" above, and `docs/FINANCIAL-ENGINE.md` for the exact calculation
each rule maps to.

## UX rules

- The user is never blocked from spending (rule 7) — the UI/future conversational layer must always
  present impact, never a refusal.
- Uncertainty (rule 17) must always be shown alongside any monetary total derived from a snapshot
  whose `confidence !== "HIGH"` — never present Safe-to-Spend as a clean, confident number when the
  underlying data has an unknown gap. **Sprint 2 adds**: when `liquidity.liquidityAwareSafeToSpend`
  is `null`, present it as "Unknown," never silently fall back to the plan figure without saying so.
- No design polish was required or attempted in Sprint 1 or Sprint 2 (dark, minimal, inline-styled
  cards/tables) — the web UI's explicit purpose is validation/debugging, not final product design.

## Confirmed user requirements (the fixture, as given by the founder)

**Unchanged from Sprint 1**: PJ gross monthly revenue BRL 15,000; monthly taxes BRL 870 (ACTUAL);
rent + condominium BRL 1,600 (ACTUAL); mother support BRL 1,000/month, **protected, non-negotiable**;
car (Localiza/Fiat Pulse) BRL 2,715 (ACTUAL); life insurance BRL 360, gym BRL 150, footvolley BRL 155
(all ACTUAL); food target BRL 1,500 (ESTIMATED); protected monthly savings target BRL 2,000 (working
target, not permanent); rodeo event (ticket BRL 476.10 ACTUAL/ALREADY_PAID, transportation BRL 100
CONFIRMED/PLANNED, drinks BRL 150 ESTIMATED/PLANNED); beach trip Sept 25–27, budget UNKNOWN;
independent-living delta assumptions (dinner/food +BRL 500, cleaning +BRL 300, household supplies
+BRL 125, all ESTIMATED, total BRL 925/month); fixture "as of" date **2026-09-05**.

**New/changed in Sprint 2**:

- Existing credit-card debt installment (~BRL 1,400/month, ESTIMATED) is now an `InstallmentPlan`
  with `installmentNumber`/`totalInstallments` both `null` (genuinely unknown schedule), not a flat
  `FixedExpense` — see DEC-011.
- Six real September transactions, per the founder: Mineiros Dog BRL 26.00, Adega do Rai BRL 55.50,
  rodeo ticket BRL 476.10 (2026-09-04, reconciled with the rodeo event's line item — counted once),
  OXXO BRL 40.78, TikTok Shop BRL 173.02, PagSeguro BRL 12.49 (2026-09-04), plus the pre-existing
  iFood dinner BRL 45.00 (2026-09-05). PagSeguro deliberately matches no categorization rule and
  stays `UNCATEGORIZED`.
- The rodeo event's date was corrected from 2026-09-06 (Sprint 1) to **2026-09-04**, matching the
  real transaction date (DEC-020).
- **Safe-to-Spend is now BRL 2,171.11** (217,111 cents), not Sprint 1's BRL 2,478.90 — see DEC-013
  for the exact, tested reconciliation. This is not a bug fix; it reflects newly-added real spending
  data plus a revenue-neutral debt-bucket reclassification.
- No `FinancialPosition` (real bank balance) data exists yet — the fixture's liquidity is explicitly
  `UNKNOWN`, and `liquidityAwareSafeToSpend` is `null` with a warning, by design.

## Current assumptions (need eventual confirmation from the founder)

- `cautionCompensationRatio = 0.15` — reconfirmed in Sprint 2 (DEC-018) as intentionally temporary
  and configurable, not a universal rule. Still unconfirmed by the founder as the "right" number.
- Tri-state lifestyle viability thresholds (FRAGILE = below target but non-negative; SUSTAINABLE =
  at/above target) use only the existing `monthlySavingsTarget` — no new percentage was introduced,
  per the brief's explicit instruction, but the founder hasn't confirmed this is the right bar either.
- No real starting bank balance/liquidity data exists (`FinancialPosition` is honestly `UNKNOWN` in
  the fixture) — founder has not yet been asked to supply real balance figures.
- TypeScript remains pinned to 6.0.3 rather than 7.x (`typescript-eslint` still lacks TS7 support as
  of this sprint) — re-check each future sprint (DEC-007).
- The web UI intentionally does not read from the database yet (DEC-019) — revisit once Sprint 3's
  real provider work needs a live-data UI anyway.

## Protected behaviors

- Mother support (BRL 1,000, `protected: true`) must never be auto-flagged for reduction by any
  future recommendation engine (rules 5–6).
- The user is never blocked from overspending (rule 7) — `simulateExpense` has no throw/reject path.
- Already-paid amounts (e.g. the rodeo ticket) are never reserved twice, and — new in Sprint 2 — a
  transaction reconciled with an event line item is excluded from the transaction-level sum so it
  isn't ALSO counted there (`domain/reconciliation.ts`, `excludedTransactionIds`).
- A card bill payment, a transfer, and an old-debt installment never inflate a spending category —
  enforced by `FinancialEffect`/`isConsumptionLike` and by installments never producing transactions
  at all (rule 4 extension, DEC-011).
- Low-confidence possible-duplicate transactions are never silently auto-merged — they surface as
  `CANDIDATE` reconciliation links for a human to resolve (rule 12).
- Rejected recurring-expense candidates don't immediately reappear from the same evidence (merchant +
  amount bucket) — only a materially different amount/pattern can resurface (rule 11 extension).

## Rejected approaches

**Carried forward from Sprint 1**: modeling Nubank's bill as a single expense line; a `Money`
companion namespace object (naming collision with the `Money` type under `isolatedModules`); `.js`-
suffixed relative imports (broke Next.js/Turbopack — DEC-006).

**New in Sprint 2**:

- **A separate `Account` entity** distinct from `PaymentSource` — rejected as unneeded ceremony until
  a real provider needs to distinguish "the card" from "the account paying the card's bill" (DEC-009).
- **A separate `TransactionClassification` table** — folded onto the transaction row; no history
  requirement exists yet to justify the extra join (DEC-015).
- **Per-installment due-date rows** (`Installment` as its own table) — no real schedule data exists
  yet to materialize; the aggregate `InstallmentPlan` + arithmetic projection is sufficient (DEC-016).
- **Wiring the web UI to read live from PGlite** — deferred over Turbopack/WASM/migration-path
  bundling risk in the demo screen; persistence is proven by its own tests instead (DEC-019).
- **Grouping recurring-candidate detection by merchant alone** — initially implemented this way,
  then corrected to group by (merchant, amount bucket) so a genuine price change forms its own
  evidence group instead of polluting the old-price group's "consistent amount" check.

## Technical debt

- The web UI has no runtime dependency on `@money-copilot/persistence` — acceptable per DEC-019, but
  means the UI and the database can drift out of sync in *content* (not in calculation logic, which
  is shared) until Sprint 3 wires them together.
- `recommendations`, `merchant_normalization_rules`, and `category_rules` tables exist in the
  persistence schema with upsert functions, but no CRUD *read* path is exercised beyond what
  `seed.ts`/tests use — fine for now, revisit once a real UI needs to manage rules interactively.
- No API boundary between any future client and the engine — still fine while the only consumer is
  the fixture-driven web UI and the test suites.
- Root `package.json`'s `build`/`test` scripts filter to `./packages/* ./apps/*`; `packages/shared`
  has no `build`/`test` script and is silently skipped — unchanged from Sprint 1, still harmless.

## Known bugs

None open at end of Sprint 2. One found and fixed during this sprint: the `db:seed` CLI script hung
indefinitely after completing its work against a file-backed PGlite store (PGlite kept the Node
event loop alive); fixed with an explicit `process.exit` in the CLI entry point — see DEC-021. (The
Sprint 1 → Sprint 2 Safe-to-Spend change is a data/reclassification effect, not a bug — see DEC-013.)

## Test status

**99/99 automated tests passing**: 95 in `packages/financial-engine` (money arithmetic, domain
models, snapshot calculation incl. card-payment/transfer/refund/fee/reversal handling, expense
simulation, lifestyle simulation incl. tri-state viability, merchant normalization, categorization,
recurring detection, installments, reconciliation/deduplication incl. pending→posted and low-
confidence-not-merged, FinancialPosition/liquidity, reporting read models, and the explicit Sprint
1→2 Safe-to-Spend reconciliation) + 4 in `packages/persistence` (DB roundtrip reproduces the exact
fixture snapshot; idempotent seed run 2–3× produces identical row counts/content). Run with:
`pnpm run test` from the repo root, or per-package with `--filter`.

## Integration status

No Open Finance, no Pluggy/Belvo, no bank/credit card connections, no WhatsApp, no LLM API
(OpenAI/Anthropic/other) — all correctly out of scope for Sprint 1–2 and not present anywhere in the
codebase. `ExternalTransactionInput` (Sprint 2) defines the target DTO shape a future provider
mapping will produce, but no provider-specific logic exists.

## Open questions

- What should `cautionCompensationRatio` actually be, once there's real usage data or founder input?
- Are the FRAGILE/SUSTAINABLE viability thresholds (anchored purely to `monthlySavingsTarget`) the
  right bar, or should a future sprint weight in `FinancialPosition`/liquidity too?
- When should the founder provide real `FinancialPosition` data (bank balance, card outstanding), and
  should Sprint 3 prioritize manual entry of this before real Open Finance import lands?
- Should Sprint 3 wire the web UI to the database now that persistence exists (DEC-019's deferred
  item), or wait until real provider data makes a live UI unavoidable anyway?
- Is BRL 2,000 protected savings a fixed monthly target going forward, or should it become a function
  of the independent-living delta plus a reserve-months target (`FinancialGoal.targetReserveAmount`
  remains unset)?

## Next recommended sprint

**Sprint 3 — Open Finance provider abstraction + sandbox integration.** See `docs/ROADMAP.md` for
detailed scope: a provider-agnostic interface mapping into `ExternalTransactionInput`, sandbox-only
real transaction import feeding Sprint 2's normalization/categorization/reconciliation pipeline,
`Recommendation.VERIFIED`/`FAILED` becoming reachable, and likely wiring the web UI to the database.

## Risks

- **Threshold drift without data**: the CAUTION/HIGH_IMPACT boundary (15%) and the new viability
  tri-state boundaries are still unvalidated guesses, reconfirmed as temporary but not yet tuned with
  real usage.
- **Persistence/UI drift**: since the UI doesn't read from the database, a future contributor could
  update the fixture without updating seed data (or vice versa) and not notice — mitigated today by
  `persistence.test.ts` asserting the DB-loaded snapshot matches the fixture-based one exactly, but
  worth remembering this guard exists and shouldn't be removed casually.
- **Version currency**: continues from Sprint 1 — recheck registry versions each sprint rather than
  trusting any prior chat/documentation snapshot, and watch for `typescript-eslint` gaining
  TypeScript 7 support.
- **Reconciliation false negatives**: `matchTransactions`' 3-day date tolerance and merchant-equality
  check are deliberately conservative (favor an unresolved `CANDIDATE` over a wrong auto-merge) — a
  real Open Finance import in Sprint 3 may surface more ambiguous cases than Sprint 2's clean fixture
  did, and the reconciliation-candidate review queue (UI section 8) will need real user interaction
  to resolve, not just display.
