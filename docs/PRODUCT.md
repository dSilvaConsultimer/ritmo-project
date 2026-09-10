# Money Copilot — Product

## The core question

Money Copilot is not a traditional expense tracker. Its primary question is:

> **"Can I afford to do this without damaging the rest of my financial plan?"**

Traditional expense trackers look backward (what did I spend?). Money Copilot looks forward: given
everything already committed this month — income, taxes, fixed bills, protected savings, planned
events — how much can I spend on a new, spontaneous thing without materially hurting my plan?

## Conversational interaction (Sprint 4)

The target interaction below is now real — a conversational AI copilot exists
(`docs/AI-COPILOT.md`), backed entirely by the deterministic engine below. The LLM infers intent
(e.g. "a date" implies dinner/drinks/entertainment categories) and calls a narrowly-scoped tool; it
never computes a number. See `docs/AI-COPILOT.md` for the full architecture.

## Target interaction

```
User: "Tonight I'm going on a date. I'll probably pay for dinner, drinks and maybe a motel.
       How much can I spend?"

Copilot: Recommended: BRL 350
         Acceptable: BRL 450
         Above BRL 450: material impact on this month's savings goal.
```

The user is **never blocked** from spending more. If they spend BRL 600 anyway, the system
recalculates the plan afterward — it does not gatekeep, it informs and adapts.

## Core philosophy

> **The financial engine calculates. AI interprets and communicates.**

An LLM must never invent financial calculations or financial limits. All numbers the user sees —
Safe-to-Spend, recommended amounts, savings projections, impact classifications — come from
deterministic application logic in `@money-copilot/financial-engine`. A future conversational layer
translates those numbers into natural language and infers intent (e.g. "a date" implies categories
like dinner, drinks, entertainment) — it never computes them itself. See
[docs/ARCHITECTURE.md](./ARCHITECTURE.md) for how this boundary is enforced in code.

## The user's actual financial goal

The initial test user's stated goal is to **become financially ready to live independently**. He
currently lives with his mother, already pays his own rent/condominium, and receives indirect
support from her in the form of home-cooked dinners and house cleaning. Money Copilot must be able
to simulate what his finances would look like if he took over those costs himself — before he
actually moves out — so he can make an informed decision about timing. See
[docs/FINANCIAL-ENGINE.md](./FINANCIAL-ENGINE.md) for the lifestyle simulation model.

## Product principles

1. **Optimize around the life the user wants, not blind expense minimization.** The system does not
   treat every discretionary purchase as waste to be cut. It classifies impact, it does not moralize.
2. **Uncertainty must be visible, not hidden.** When a future cost is not yet known (e.g. a trip with
   no budget set), the plan says so explicitly rather than pretending the cost is zero.
3. **Protected things stay protected.** Some commitments (e.g. supporting a family member) are not
   up for automatic optimization, ever — regardless of what a future recommendation engine might
   otherwise suggest.
4. **Spending above a recommendation is allowed.** The system's job is to explain consequences, not
   to enforce limits.

See [docs/PROJECT_STATE.md](./PROJECT_STATE.md) for the full, authoritative list of non-negotiable
product rules, and [docs/DECISIONS.md](./DECISIONS.md) for why each one was adopted.

## Financial Plan vs. Financial Position (Sprint 2)

Money Copilot deliberately separates two different questions:

- **Financial Plan** — given this month's income, commitments, and goals, what does the math say I
  can safely spend? (`FinancialSnapshot`, unchanged in spirit since Sprint 1.)
- **Financial Position / Liquidity** — what does my bank account actually show right now?
  (`FinancialPosition`, new in Sprint 2.)

A healthy plan does not always mean healthy liquidity (income committed but not yet received), and a
large bank balance does not always mean healthy plan headroom (it may already be earmarked). The
product surfaces both rather than conflating them — see `docs/FINANCIAL-ENGINE.md` for
`computeLiquidityAwareSafeToSpend`.

## A bank transaction is not automatically an expense (Sprint 2)

Extending RULE #4 (credit cards are payment sources, not categories): a raw bank/card transaction
must be classified by its actual financial effect before it means anything. A credit card bill
payment is not a second expense on top of the purchases it paid for; a transfer between the user's
own accounts is not consumption; a refund reduces net spend rather than sitting alongside the
original purchase as if both were real. See `docs/FINANCIAL-ENGINE.md`, "Financial effect
classification."

## Open Finance sandbox integration (Sprint 3)

Money Copilot connects to real financial institutions via Pluggy (sandbox only — no real Santander/
Nubank account has been connected yet; see [docs/OPEN-FINANCE.md](./OPEN-FINANCE.md)). The same
"engine calculates, provider data is just an input" philosophy applies: a bank's own transaction
categories, sign conventions, and reported balances are all translated into the deterministic
canonical model before anything is calculated — the provider never invents a financial number any
more than an LLM would.

## Recommendation engine (Sprint 5)

Money Copilot proactively identifies realistic opportunities to improve the user's finances from
their own real recurring spending — never a generic budgeting tip, never invented savings. V1 (Sprint
5) covers confirmed/high-confidence recurring discretionary costs only (subscriptions, memberships,
recurring digital services — e.g. "you have a ~R$59.90/month recurring subscription; canceling would
free up ~R$59.90/month"). The user decides — ACCEPT, MODIFY (e.g. reduce to a stated amount instead
of canceling), or REJECT — and later imported transactions determine whether the expected change
actually happened (VERIFIED or FAILED), never an LLM judgment call. A `ProtectedPreference` (e.g. the
Founder's real family-support commitment) can never become a cost-cutting recommendation, evaluated
before anything else. Accepting a recommendation is intent, not confirmed savings — it never inflates
current Safe-to-Spend. See [docs/RECOMMENDATIONS.md](./RECOMMENDATIONS.md) for the full architecture.

## Concierge & real-world discovery (Sprint 6)

Money Copilot can now help decide a real-world discretionary action — "Vou sair para jantar hoje,
quanto posso gastar e onde eu poderia ir?" — by combining the deterministic financial engine (always
first: what can the user safely spend) with a provider-neutral real-world discovery layer (what
options actually exist and what they cost). The financial envelope is never influenced by external
search results — only the reverse. Real-world prices are treated as genuinely imperfect: every price
carries provenance (exact/range/starting-at/price-level/estimated/unknown) and a venue with no price
evidence is never presented as "fitting the budget." Multi-part plans (e.g. dinner + optional lodging)
are evaluated deterministically, with required and optional costs always shown separately so an
optional component's cost is never mistaken for unavoidable spend. Saving/selecting a plan is intent,
never spending — no transaction is created; an explicit budget reservation reuses the existing planned-
event mechanism. **No live discovery provider credential exists yet** — see
[docs/CONCIERGE.md](./CONCIERGE.md) for the full architecture and exact live-provider status.

## Alerts & notifications (Sprint 7)

Money Copilot now recognizes when something financially relevant changed and surfaces it without the
user having to notice on their own — a materially lower Safe-to-Spend, a recurring cost that came back
after the user tried to cancel it, a tightly-budgeted upcoming commitment, a bank connection or saved
outing plan that needs attention. Alert CREATION is entirely deterministic — the same "engine
calculates, AI interprets" boundary as every other number in this product — the AI only explains an
alert, answers "why am I seeing this?", and acts on the user's own explicit instruction to mark one
seen or dismiss it. The system deliberately prioritizes signal over noise: a tiny fluctuation never
alerts, a dismissed alert never reappears on its own, and a brand-new profile with years of pre-existing
data is never flooded with retroactive alerts about its starting state. See
[docs/ALERTS-NOTIFICATIONS.md](./ALERTS-NOTIFICATIONS.md) for the full architecture; only in-app
delivery exists today, no real push/email provider is configured.

## Out of scope for Sprint 1–7

Real (non-sandbox) bank/credit card connections (technically eligible as of Sprint 4.5's passed
validation, but gated on separate explicit Founder approval — see `docs/PROJECT_STATE.md`), WhatsApp,
any external booking/reservation/payment/cancellation action (Sprint 6 only discovers and recommends —
no restaurant/hotel booking, no ticket purchase, no merchant contact), and any real push/email
notification delivery, automatic monitoring alerts beyond the Sprint 7 catalog, or automatic merchant
actions (Sprint 7 only surfaces already-computed deterministic signals — see
[docs/ALERTS-NOTIFICATIONS.md](./ALERTS-NOTIFICATIONS.md)). Sprint 4 added conversational AI (OpenAI,
via a provider-neutral abstraction a future Anthropic provider could also implement) strictly as an
interpretation/interface layer over the unchanged deterministic core; Sprint 5 added the recommendation
engine, Sprint 6 the concierge, and Sprint 7 the alert engine, all using that same interpretation-only
AI layer — see [docs/AI-COPILOT.md](./AI-COPILOT.md), [docs/RECOMMENDATIONS.md](./RECOMMENDATIONS.md),
[docs/CONCIERGE.md](./CONCIERGE.md), [docs/ALERTS-NOTIFICATIONS.md](./ALERTS-NOTIFICATIONS.md), and
[docs/ROADMAP.md](./ROADMAP.md).
