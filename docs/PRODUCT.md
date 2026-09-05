# Money Copilot — Product

## The core question

Money Copilot is not a traditional expense tracker. Its primary question is:

> **"Can I afford to do this without damaging the rest of my financial plan?"**

Traditional expense trackers look backward (what did I spend?). Money Copilot looks forward: given
everything already committed this month — income, taxes, fixed bills, protected savings, planned
events — how much can I spend on a new, spontaneous thing without materially hurting my plan?

## Target interaction (future, not Sprint 1)

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

## Out of scope for Sprint 1 and Sprint 2

Open Finance/Pluggy/Belvo integration, real bank/credit card connections, WhatsApp, any LLM API
(OpenAI, Anthropic, or otherwise), and a recommendation *discovery* engine. Sprints 1–2 prove the
deterministic core and its persistence work; these are future sprints — see
[docs/ROADMAP.md](./ROADMAP.md).
