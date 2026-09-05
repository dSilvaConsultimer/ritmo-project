# Money Copilot — Roadmap

This is a proposed sequence, not a commitment to exact scope per sprint. Each sprint should begin by
reading `docs/PROJECT_STATE.md` and end by updating it.

## Sprint 1 — Financial Core + persistent project memory ✅ (this sprint)

Deterministic financial engine: `Money`, domain model, `FinancialSnapshot`/Safe-to-Spend,
`simulateExpense`, lifestyle simulation, initial real-life fixture, strong test coverage, minimal
Next.js display UI, full documentation set. No persistence, no Open Finance, no LLM.

## Sprint 2 — Transactions + normalization + categorization

- Recurring-expense modeling (distinct from one-off `FixedExpense` entries — needs a notion of
  cadence/next-due-date).
- Installment tracking (e.g. the existing ~BRL 1,400 credit card installment fixture entry should
  become a real installment plan with a start date, count, and remaining count).
- Transaction categorization (rules-based first; the "Nubank → iFood → Food" pattern from Sprint 1
  needs to generalize to arbitrary merchants).
- Deduplication groundwork: a stable transaction fingerprint (date + amount + description hash) so
  manual entries and, later, imported ones can be matched (RULE #12). Full Open Finance-side
  deduplication logic belongs to Sprint 3, but the fingerprinting scheme should be designed now.
- Persistence: Sprint 1 has none. This is likely the sprint that introduces it (even if minimal —
  e.g. a local file/SQLite store) since transactions need to accumulate over time.

## Sprint 3 — Open Finance provider abstraction + sandbox integration

- Define a provider-agnostic interface (`OpenFinanceProvider`) so Pluggy/Belvo/others are
  swappable.
- Sandbox-only integration first; no real bank credentials.
- Real transaction import feeding into Sprint 2's categorization + deduplication pipeline.
- `Recommendation.VERIFIED`/`FAILED` become reachable for the first time (RULE #10) — imported data
  can finally confirm or refute whether an accepted recommendation's savings materialized.

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
