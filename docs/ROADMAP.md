# Money Copilot — Roadmap

This is a proposed sequence, not a commitment to exact scope per sprint. Each sprint should begin by
reading `docs/PROJECT_STATE.md` and end by updating it.

## Sprint 1 — Financial Core + persistent project memory ✅ (this sprint)

Deterministic financial engine: `Money`, domain model, `FinancialSnapshot`/Safe-to-Spend,
`simulateExpense`, lifestyle simulation, initial real-life fixture, strong test coverage, minimal
Next.js display UI, full documentation set. No persistence, no Open Finance, no LLM.

## Sprint 2 — Transactions + persistence + financial normalization ✅ (complete)

Canonical `FinancialTransaction` model + `FinancialEffect` classification (no more card-payment/
transfer double counting); merchant normalization + deterministic categorization; recurring-expense
*candidate* detection (never auto-confirmed); `InstallmentPlan` (incomplete-schedule-aware) +
future-commitment read model; deduplication/reconciliation (provider-id → fingerprint → candidate,
never silently merged); `FinancialProfile` ownership model; `FinancialPosition`/liquidity-aware
Safe-to-Spend alongside the plan figure; tri-state lifestyle viability
(UNSUSTAINABLE/FRAGILE/SUSTAINABLE); auditable `SafeToSpendBreakdown`; first persistence layer
(Drizzle + PGlite, no hosted credentials needed) with idempotent seed; extended debug/validation UI.
See `docs/DECISIONS.md` DEC-009 through DEC-020 and `docs/PROJECT_STATE.md` for the full account.

## Sprint 3 — Open Finance provider abstraction + sandbox integration

- Define a provider-agnostic interface (`OpenFinanceProvider`) that maps a real provider's payload
  into Sprint 2's `ExternalTransactionInput` DTO (`domain/external-transaction.ts`) so Pluggy/Belvo/
  others are swappable.
- Sandbox-only integration first; no real bank credentials.
- Real transaction import feeding into Sprint 2's normalization, categorization, and reconciliation
  pipeline (`findTransactionDuplicates`, `matchTransactions`) — this is where `PROVIDER_ID`/
  `STABLE_SOURCE_ID` matching finally has real provider ids to work with, not just the fallback
  fingerprint.
- `Recommendation.VERIFIED`/`FAILED` become reachable for the first time (RULE #10) — imported data
  can finally confirm or refute whether an accepted recommendation's savings materialized.
- Likely also the sprint to wire the web UI to read live from `@money-copilot/persistence` instead
  of the in-memory fixture (deferred in Sprint 2 — see DEC-019) — a real provider needs a live-data
  UI anyway, so bundling the two makes sense.
- Replace the old credit-card debt `InstallmentPlan`'s unknown schedule (Sprint 2:
  `installmentNumber`/`totalInstallments` both `null`) with the real schedule, once available.

## Sprint 4 — AI conversational copilot with deterministic financial tools

- LLM integration (first time any LLM API is introduced in this project).
- The LLM's role is strictly: parse user intent ("a date tonight, dinner + drinks + maybe a motel")
  into a structured call to `simulateExpense`/category inference, and template the deterministic
  result back into natural language. It must never compute a number itself — see
  `docs/ARCHITECTURE.md`, "Enforcing 'the engine calculates, AI interprets' in code." Code review
  for this sprint should specifically check for `Money` arithmetic leaking outside
  `financial-engine`.
- WhatsApp or other conversational surface wiring is plausible here or Sprint 6 depending on scope.

## Sprint 5 — Recommendation engine with ACCEPT / MODIFY / REJECT / VERIFY lifecycle

- Actual recommendation *discovery* (Sprint 1 only defined the data model in
  `domain/recommendation.ts`).
- Must respect `ProtectedPreference` (RULE #5, #11) and must not resurface `REJECTED`
  recommendations absent material context change.
- Verification against Sprint 3's imported transaction data.

## Sprint 6 — Financial concierge

- Budget-aware recommendations for restaurants, dates, shopping, travel — built on top of
  `simulateExpense` plus category-specific intent parsing from Sprint 4.

## Sprint 7 — Notifications, alerts, UX stabilization, production hardening

- Proactive alerts (e.g. "your beach trip is in 3 days and still has no budget set" — finally acting
  on the `UNKNOWN`-certainty warning mechanism built in Sprint 1).
- General production hardening: auth, error handling, observability, UX polish.

## Explicitly not scheduled yet

Multi-user support, multi-currency, and any specific bank/institution integration beyond sandbox are
not placed on this roadmap — they should be scoped when they become concretely necessary.
