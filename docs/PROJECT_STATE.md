# Money Copilot — Project State

**This file is the canonical persistent project memory.** Before every future sprint, read this
file, plus `docs/PRODUCT.md`, `docs/ARCHITECTURE.md`, `docs/FINANCIAL-ENGINE.md`,
`docs/ROADMAP.md`, and `docs/DECISIONS.md` (and, from Sprint 3 on, `docs/OPEN-FINANCE.md` for
provider-integration detail), in that order. This documentation is more authoritative than
assumptions carried over from a chat session. If a new request conflicts with a rule documented here:
identify the conflict, explain the existing rule, do not silently change it, implement the new
behavior only if it clearly supersedes the old decision, and record the change in
`docs/DECISIONS.md` (mark the old decision superseded, add a new one — never rewrite history).

Last updated: **2026-09-05, end of Sprint 3.**

---

## NON-NEGOTIABLE PRODUCT RULES

1. Financial calculations are deterministic application logic.
2. LLMs do not calculate or invent financial limits.
3. Monetary values must internally use integer cents. Never use floating-point arithmetic for money.
4. Credit cards are PAYMENT SOURCES, not financial expense categories. **Sprint 3 extends this to
   real provider data**: a bank/card transaction's `FinancialEffect` (not its raw sign) determines
   whether it's spending at all — verified against real Pluggy sign conventions, which differ by
   account type (see `docs/OPEN-FINANCE.md`, "Amount / sign mapping").
5. Protected expenses must never automatically be recommended for reduction.
6. BRL 1,000 monthly support to the user's mother is protected and non-negotiable.
7. Spending above the recommended amount is allowed. The system recalculates the plan instead of
   blocking or judging the user.
8. Future events must affect Safe-to-Spend BEFORE they occur.
9. Unknown future-event budgets must NEVER silently be interpreted as zero — this now also covers
   installment plans with an incomplete schedule, a `FinancialPosition` with unknown liquidity, and
   (Sprint 3) incomplete account **coverage** (a subset of connected accounts is never presented as
   the user's complete financial picture).
10. Accepted future recommendations must eventually be verifiable against imported financial data.
    Real imported data now exists (Sprint 3) but no recommendation-discovery engine does yet (Sprint
    5) — this rule remains modeled, not operational.
11. Rejected recommendations should not repeatedly return unless material context changes — the same
    principle governs rejected recurring-expense candidates (Sprint 2) and, in spirit, old-debt
    installment match candidates (Sprint 3, which are never even auto-confirmed in the first place —
    see rule 9-adjacent DEC-032).
12. Manual transactions and later Open Finance imported transactions must eventually support
    deduplication. **Fully implemented and exercised against real-provider-shaped data in Sprint 3**
    — see `docs/OPEN-FINANCE.md`, "Manual + provider reconciliation."
13. The system must support simulation of future lifestyles without modifying real financial data.
14. Independent-living simulation must be possible before the user actually moves out.
15. The product should optimize around the life the user wants, not blindly minimize every expense.
16. The system should distinguish: actual data, estimated data, confirmed future data, unknown data.
17. Financial uncertainty must be visible instead of hidden.
18. **(Sprint 3) Pluggy — or any provider — must not leak into `packages/financial-engine`.** The
    engine remains usable without Pluggy, Open Finance, Next.js, a database, or network access. All
    provider-specific logic lives in `packages/open-finance`, behind the `OpenFinanceProvider`
    interface.

These are enforced today by: `Money` (rule 3), `PaymentSource`/`FinancialEffect` +
`pluggy/mappers.ts`'s direction-from-`type`-not-sign mapping (rule 4, 18), `FixedExpense.protected` +
`ProtectedPreference` (rules 5–6), `simulateExpense` never throwing/blocking (rule 7),
`domain/event.ts` + `domain/installment.ts` (rule 8), `Certainty.UNKNOWN` handling +
`FinancialPosition.coverage` (rules 9, 16, 17), `domain/reconciliation.ts` +
`findTransactionDuplicates` exercised against Pluggy-shaped fixtures (rule 12), and
`LifestyleScenario` simulation never mutating input (rules 13–14). Rule 10 remains modeled but not
operational (no discovery engine).

---

## Product objective

Answer "Can I afford to do this without damaging the rest of my financial plan?" — not a backward-
looking expense tracker. Primary current user goal: become financially ready to live independently.
Full detail: `docs/PRODUCT.md`.

## Current architecture

pnpm workspace monorepo, now five packages deep: `apps/web` (Next.js 16 App Router, DB-backed via
`app-services`) → `packages/app-services` (application/query service layer, zero Next.js
dependency) → `packages/open-finance` (provider abstraction + Pluggy adapter + MockProvider) and
`packages/persistence` (Drizzle + PGlite) → `packages/financial-engine` (zero framework/database/
provider dependencies, the priority package) → `packages/shared` (generic `Id`/id-generation only).
Full detail: `docs/ARCHITECTURE.md`. Calculation detail: `docs/FINANCIAL-ENGINE.md`. Provider
integration detail: `docs/OPEN-FINANCE.md`.

## Current sprint

**Sprint 3 — engineering complete; live Pluggy sandbox validation NOT executed** (no
`PLUGGY_CLIENT_ID`/`PLUGGY_CLIENT_SECRET` were available in this environment — see "Integration
status" below). See the Sprint 3 final report delivered to the founder for the full account; this
file carries forward only what a future sprint needs to know.

## Completed capabilities

**Carried forward from Sprint 1–2** (see `docs/DECISIONS.md` DEC-001–021): `Money`; domain model;
`FinancialSnapshot`/Safe-to-Spend/`SafeToSpendBreakdown`; `simulateExpense`; `FinancialEffect`
classification; merchant normalization + categorization; recurring-candidate detection;
`InstallmentPlan`; reconciliation/deduplication; `FinancialProfile`; `FinancialPosition`/liquidity;
tri-state lifestyle viability; persistence (Drizzle + PGlite) with idempotent seed; the founder's
enriched fixture (7 September transactions, old debt as an `InstallmentPlan`).

**New in Sprint 3:**

- `OpenFinanceProvider` interface (`createConnectionToken`, `getConnection`, `listAccounts`,
  `listTransactions`, `listBills`, `syncConnection`, `deleteConnection`) — `packages/open-finance`.
- `PluggyProvider`: real Pluggy REST contract (auth, Connect Token, accounts, cursor-paginated
  transactions, bills) via the official `pluggy-sdk` npm package, verified against Pluggy's own SDK
  source and reference Next.js quickstart (fetched from GitHub, not assumed from prior knowledge).
- `MockProvider`: fully deterministic, no network, no credentials — powers tests and would power a
  credential-free demo.
- A documented, tested amount-sign/`FinancialEffect` mapping per account kind — see
  `docs/OPEN-FINANCE.md`'s mapping table. Direction comes from Pluggy's `type` field, never from the
  sign of `amount` (which Pluggy documents inconsistently across account types).
- `ExternalAccountInput`/`ExternalBillInput` DTOs + `PaymentSource` extended with optional
  provider/balance/credit-card fields (DEC-022) + `CreditCardBill` domain type (never fed into
  snapshot math).
- `ProviderConnection` + `SyncRun` domain types; `ProviderError` taxonomy (8 codes).
- Full connect → sync → snapshot pipeline (`@money-copilot/app-services`): idempotent connection
  creation (DB unique constraint + app-level check, DEC-023), account/transaction/bill import
  through the **unchanged** Sprint 2 normalization/categorization/reconciliation pipeline, installment
  metadata mapping, non-duplicating repeated-sync reconciliation (pair-key dedup).
- Idempotent webhook processing (`webhook_events` keyed by provider `eventId`) — `transactions/
  created` triggers a full incremental sync, `transactions/updated` triggers a **targeted** re-fetch
  by id (a real bug found and fixed during this sprint's own testing — see DEC-027).
- `transactions/deleted` → `REVERSED` tombstone (never hard-deleted).
- `FinancialPosition.coverage` (`COMPLETE`/`PARTIAL`/`UNKNOWN`) derived from connected accounts —
  only provider-synced accounts count (DEC-022/DEC-028).
- Old-debt installment reconciliation candidates (`matchInstallmentPlans`) — never auto-applied
  (DEC-032).
- New persistence tables: `provider_connections`, `sync_runs`, `webhook_events`, `bills`; extended
  `payment_sources`/`financial_positions`/`installment_plans`; a second migration verified to apply
  forward onto an existing Sprint-2-shaped database (`migration.test.ts`).
- Web app: DB-backed dashboard (`export const dynamic = "force-dynamic"`, DEC-024), "Connected
  Accounts" section with a real Pluggy Connect widget (`react-pluggy-connect`), manual "Refresh /
  sync" button, sync-run developer view, DEMO/FIXTURE vs. PROVIDER DATA banner. Four API routes
  (`/api/token`, `/api/connections`, `/api/sync`, `/api/webhook`) — each a thin wrapper over one
  `app-services` function.
- `.env.example` documenting every Sprint 3 environment variable, no secrets committed.
- 185 automated tests passing (105 financial-engine + 46 open-finance + 13 persistence + 21
  app-services — see exact breakdown in "Test status").

## Partially completed capabilities

- **Recommendation lifecycle**: still model-only (Sprint 1/2 state unchanged) — real imported data
  now exists to eventually verify against, but no discovery engine exists yet (Sprint 5).
- **Old-debt reconciliation**: candidates are computed (`getInstallmentPlanMatchCandidates`) and
  exposed, but there is no UI/flow to act on one (accept/reject) — deliberately deferred (DEC-032),
  likely bundled into Sprint 5's recommendation lifecycle UI.
- **Live Pluggy sandbox validation**: NOT executed (see "Integration status"). All engineering is
  complete and contract-tested against `MockProvider`/injected fakes/sanitized fixtures instead.
- **Scheduled/automatic sync**: intentionally not built (DEC-031) — only webhook-driven and manual
  sync exist.

## Financial/business rules

See "NON-NEGOTIABLE PRODUCT RULES" above, `docs/FINANCIAL-ENGINE.md` for the exact calculation each
rule maps to, and `docs/OPEN-FINANCE.md` for how real provider data is translated into those rules'
inputs.

## UX rules

- The user is never blocked from spending (rule 7).
- Uncertainty must always be shown alongside any monetary total whose confidence/coverage isn't full
  — extended in Sprint 3 to liquidity coverage (never claim `liquidityAwareSafeToSpend` reflects the
  user's complete financial picture when `coverage !== "COMPLETE"`).
- **Never make sandbox data look like real money** (Sprint 3 brief's explicit instruction) — the
  DEMO/FIXTURE vs. PROVIDER DATA banner is the current mechanism; Pluggy's own sandbox connectors are
  clearly test/fake institutions, not real banks.
- No design polish attempted in Sprint 1–3 — the web UI's explicit purpose is validation/debugging.

## Confirmed user requirements (the fixture, as given by the founder)

Unchanged from Sprint 2 (see prior version of this file / `docs/DECISIONS.md` DEC-011/DEC-013 for
the full account) — PJ gross revenue BRL 15,000; taxes BRL 870; housing BRL 1,600; mother support
BRL 1,000 (protected); car BRL 2,715; old card debt ~BRL 1,400/month (now an `InstallmentPlan`,
unknown schedule); life insurance BRL 360; gym BRL 150; footvolley BRL 155; food target BRL 1,500;
protected savings target BRL 2,000; rodeo event; beach trip Sept 25–27 (unknown budget);
independent-living delta BRL 925/month. **Safe-to-Spend remains BRL 2,171.11 (217,111 cents)** for
the fixture/demo path — Sprint 3 did not change this number; it was explicitly preserved and is
proven byte-identical via `app-services/src/sync.test.ts`'s fixture/provider-path-equivalence test.

## Current assumptions (need eventual confirmation from the founder)

- Everything carried forward from Sprint 2 (caution threshold, viability thresholds, TypeScript 6.x
  pin) remains unconfirmed/unresolved — see prior entries in `docs/DECISIONS.md`.
- The amount-sign/`FinancialEffect` mapping table (`docs/OPEN-FINANCE.md`) is a best-effort heuristic
  built from Pluggy's documentation and SDK source, **not validated against real sandbox data** — the
  founder connecting a real sandbox institution (once credentials exist) is the first real test of
  this mapping's accuracy.
- `normalizePluggyError`'s HTTP-status-to-code mapping is similarly unverified against real Pluggy
  error responses.
- No automatic/scheduled sync exists (DEC-031) — is manual + webhook-only sufficient once real
  sandbox/production use begins, or does a later sprint need a scheduled fallback?

## Protected behaviors

Everything carried forward from Sprint 2, plus:

- A card bill payment, a transfer, a fee, and a refund are classified via `FinancialEffect` derived
  from the provider's own `type` field (never guessed from raw amount sign) — tested per account kind
  in `packages/open-finance/src/pluggy/mappers.test.ts`.
- A provider-derived installment schedule never silently replaces the founder's manual ~BRL
  1,400/month old-debt estimate — every match is a `CANDIDATE`, regardless of confidence (DEC-032).
- A duplicate connection for the same real-world Item is prevented both at the app level
  (`findProviderConnection` before create) and the database level (unique constraint, DEC-023).
- A duplicate webhook delivery (same `eventId`) is a no-op (`claimWebhookEvent`'s
  `INSERT ... ON CONFLICT DO NOTHING`).
- A deleted-by-provider transaction is marked `REVERSED`, never hard-deleted.

## Rejected approaches

Carried forward from Sprint 1–2, plus (Sprint 3):

- **A separate `Account` entity** — `PaymentSource` extended in place instead (DEC-022, extends
  DEC-009).
- **Auto-applying a HIGH-confidence old-debt installment match** — every match stays a `CANDIDATE`
  regardless of confidence; the brief's conservative instruction and the lack of live data to
  validate the heuristic both argued against auto-apply (DEC-032).
- **A fabricated webhook signature scheme** — Pluggy documents no signature mechanism; protection is
  an unguessable shared secret in the webhook URL instead, explicitly documented as URL-obscurity,
  not cryptographic verification (DEC-030, `docs/OPEN-FINANCE.md`).
- **Using a date-filtered sweep for `transactions/updated` webhooks** — initially implemented this
  way, then corrected after a failing integration test revealed it misses status changes (e.g.
  PENDING → POSTED) on transactions older than the sync cutoff; replaced with a targeted re-fetch by
  external id, matching Pluggy's own reference pattern (DEC-027).
- **Counting manual (non-provider) payment sources toward liquidity coverage** — initially
  implemented this way, then corrected after a failing test showed it made a zero-connections profile
  report `PARTIAL` coverage instead of the honest `UNKNOWN` (DEC-022's consequence).
- **A scheduled/polling sync job** — explicitly out of scope per the brief ("do NOT create an abusive
  high-frequency polling scheduler"); webhook + manual sync only (DEC-031).

## Technical debt

Carried forward from Sprint 1–2 (web UI/DB drift risk — now mitigated somewhat, since the UI *does*
read from the DB as of this sprint; `reconciliation_links` has no `financialProfileId` column, still
global across profiles — harmless with one profile, needs a migration before multi-profile support),
plus:

- No CRUD UI for old-debt installment match candidates (`getInstallmentPlanMatchCandidates` exists,
  nothing acts on it yet).
- `normalizePluggyError` and the sign/effect mapping table are unverified against real Pluggy
  responses/data (see "Current assumptions").
- No automatic/scheduled sync (by design, DEC-031, but worth tracking as a real limitation for
  production readiness).

## Known bugs

None open at end of Sprint 3. Two found and fixed during this sprint's own testing (both are process/
design corrections, documented as decisions rather than silent fixes):

1. The incremental sync's date-filtered fetch would miss a status update (PENDING → POSTED) on an
   older transaction — fixed by adding a targeted re-fetch-by-id path used specifically for
   `transactions/updated` webhooks (DEC-027).
2. Liquidity coverage counted manual (non-synced) payment sources, incorrectly reporting `PARTIAL`
   coverage for a profile with zero real connections — fixed by filtering to provider-synced accounts
   only (DEC-022's consequence).

## Test status

**185 automated tests passing**, zero failing, across four packages:

- `packages/financial-engine`: **105** (money, domain models, snapshot incl. card-payment/transfer/
  refund/fee/reversal handling, expense simulation, lifestyle simulation incl. tri-state viability,
  merchant normalization, categorization, recurring detection, installments incl. match candidates,
  reconciliation/deduplication, `FinancialPosition`/coverage, reporting read models, bill domain
  type, Sprint 1→2 Safe-to-Spend reconciliation).
- `packages/open-finance`: **46** (Pluggy account/transaction/bill mapping per account kind incl.
  pending/posted/installment/fee/refund/card-payment/transfer, error normalization, API-key-cache
  singleton behavior, `PluggyProvider` contract via an injected fake client, webhook idempotency-key
  extraction, `MockProvider` contract).
- `packages/persistence`: **13** (roundtrip, idempotent seed, clean-database migration, Sprint 2→3
  forward migration, provider-connection idempotency incl. DB-constraint rejection, webhook claim/
  process/fail, bills, sync-run recording incl. `PARTIAL` error preservation).
- `packages/app-services`: **21** (basic sync import, connection idempotency, rodeo reconciliation
  regression via a simulated provider re-discovery, pending→posted via targeted re-fetch, card-
  payment double-counting prevention via the full pipeline, old-debt match-candidate surfacing
  without replacement, DB-backed snapshot/fixture-path equivalence, webhook idempotency + dispatch by
  event type incl. deletion→REVERSED, remaining plain read-model queries incl. liquidity coverage,
  installment commitments, connections, reconciliation candidates, recurring candidates,
  uncategorized transactions, lifestyle comparison).

Run with `pnpm run test` from the repo root, or per-package with `--filter`.

## Integration status

**Pluggy sandbox: engineering complete, live validation NOT EXECUTED.** No
`PLUGGY_CLIENT_ID`/`PLUGGY_CLIENT_SECRET` were available in this environment. Every piece of the
integration (auth flow, Connect Token creation, account/transaction/bill mapping, pagination,
webhook processing, sync pipeline) is implemented against the real, documented Pluggy REST API
contract (verified via Pluggy's own SDK source and reference implementation) and is automated-test-
covered via `MockProvider` + an injected fake `PluggyApiClient` + sanitized fixture payloads — never
against a live Pluggy sandbox call. Once the Founder supplies real sandbox credentials
(`.env.example` documents the exact variables), the very first live validation should attempt: Connect
Token creation, a real Connect flow through a Pluggy sandbox test connector, account retrieval,
transaction retrieval, persistence, and snapshot recalculation — in that order, per the brief's own
validation checklist.

No Belvo, no real (non-sandbox) bank connections, no WhatsApp, no LLM API — all correctly out of
scope for Sprint 1–3.

## Open questions

Carried forward from Sprint 2 (caution threshold, viability thresholds, protected savings target
methodology), plus:

- When can the Founder obtain Pluggy sandbox credentials, and is he willing to complete a real
  Connect flow through a Pluggy sandbox test connector once they're available (a short, one-time
  interactive step)?
- Should Sprint 4 (LLM tool layer) happen before or after the first live sandbox validation? The
  brief's own roadmap suggests validation should happen "before or alongside" Sprint 4.
- Is the current amount-sign/effect mapping table (`docs/OPEN-FINANCE.md`) good enough to trust with
  a real sandbox connector's data, or should it be revisited once real transactions are observed?
- Should old-debt installment match candidates get a lightweight accept/reject affordance before
  Sprint 5's full recommendation lifecycle UI, or wait?

## Next recommended sprint

**Sprint 4 — AI conversational copilot with deterministic financial tools.** See `docs/ROADMAP.md`
for detailed scope: LLM integration (first in this project) that parses user intent into calls
against `@money-copilot/app-services`/`@money-copilot/financial-engine` — never computing a number
itself. `app-services` has zero Next.js dependency specifically so this sprint's tool-calling layer
can import it directly. A real Pluggy sandbox validation pass (Sprint 3's pending item, DEC-033)
should happen before or alongside this sprint once the Founder can supply credentials.

## Risks

Carried forward from Sprint 2 (threshold drift, version currency, reconciliation false negatives —
now somewhat validated by real Pluggy-shaped fixture testing, though not live data), plus:

- **Unvalidated provider mapping**: the sign/effect mapping table and error-code mapping are built
  from documentation and SDK source, not observed real data. A real sandbox connection could reveal a
  transaction shape the current keyword heuristics misclassify — see `docs/OPEN-FINANCE.md`, "Known
  provider limitations," for exactly where to extend the heuristics if that happens.
- **Global reconciliation links**: `reconciliation_links` has no `financialProfileId` column — a
  latent scalability gap, harmless today (one profile), but must be fixed before multi-profile
  support (would need a migration).
- **No automatic sync**: staleness between real provider updates and what the dashboard shows is
  only resolved by a webhook firing or a manual click — acceptable for sandbox/demo use, revisit
  before any real production deployment.
