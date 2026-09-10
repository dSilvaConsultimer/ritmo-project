# Money Copilot — Ritmo UI Integration (Sprint 8)

This document covers `apps/ritmo`, the consumer-facing product UI added in Sprint 8. Read
`docs/PROJECT_STATE.md` first for the full continuity account; this file is the detailed reference
for how the new frontend is built, why, and what it deliberately does and doesn't do yet.

## What Ritmo is

A Founder-approved Lovable-generated prototype (`meu-ritmo-design`, product name "Ritmo") is the
VISUAL source of truth for Money Copilot's product UI, replacing `apps/web`'s developer dashboard as
the surface end users see. `apps/ritmo` is that prototype's exact framework/routing/markup/styling,
copied into the monorepo and then wired to real data — never redesigned, simplified, or
"improved." The one thing that changed screen-by-screen is the DATA SOURCE: every screen now reads
from the real, existing `@money-copilot/app-services` / financial-engine / persistence stack — the
same one `apps/web` already used — never a second business-logic implementation.

**`apps/web` remains temporarily as an internal/debug frontend** during this transition and is
retired once `apps/ritmo` reaches full parity. Both apps depend on `@money-copilot/app-services`
directly; see "PGlite single-process rule" below for the one hard constraint that follows from that.

Stack: React 19, TanStack Start (file-based routing, `createServerFn` RPC), Vite 8, Tailwind v4,
shadcn/ui + Radix, scaffolded originally via `@lovable.dev/vite-tanstack-config`.

## Architecture

```
apps/ritmo/src/
  routes/*.tsx        Ported ~verbatim from the Lovable prototype — JSX/markup/Tailwind classes
                       unchanged. Each route's `loader` calls its `functions/*.ts` server function
                       and passes the raw result through its `adapters/*.ts` presentation adapter.
  functions/          The ONLY layer allowed to import @money-copilot/app-services. TanStack
                       `createServerFn()` bodies — never imported by client-only code. (Named
                       `functions/`, not `server/`, because Lovable's own vite-tanstack-config
                       treats any path literally containing `server/` as a protected/denied import
                       for the client bundle — see "Server/client security boundary" below and
                       docs/DECISIONS.md DEC-084.)
  functions/config.ts        ASOF_DATE — the same fixed "as of" date apps/web's dashboard uses.
  functions/profile-context.ts  getCurrentProfileContext() — the ONE profile-resolution seam (below).
  adapters/           Pure functions (no I/O, no financial calculation) that reshape a server
                       function's raw domain data into the exact view-model shape a route's
                       UNCHANGED JSX already expects. This is where every "data-model gap" (below)
                       is resolved — honestly, never by fabricating a number the engine doesn't know.
  components/, lib/, styles.css, router.tsx, server.ts, start.ts   Ported verbatim (untouched).
```

No new package was added to the pnpm workspace glob — `apps/*` already matches `apps/ritmo`.
`@money-copilot/app-services`'s `main`/`types` point at raw `src/index.ts`; Vite resolves
workspace-linked TypeScript source with zero special config (unlike `apps/web`, which needs
Next.js's `transpilePackages` for the same thing) — confirmed via a spike before any screen was
built.

## Profile resolution seam

`apps/ritmo/src/functions/profile-context.ts` exports the ONE function, `getCurrentProfileContext()`,
that every other server function calls to get `{ financialProfileId, displayName }`. No server
function references `DEMO_PROFILE_ID` directly. For Sprint 8 it resolves unconditionally to the
existing demo/founder fixture profile — **this is explicitly not an authentication
implementation.** It's the seam a future sprint's real auth replaces by changing the inside of this
one function, with zero changes required to any adapter or route.

**Login exception:** no login/auth UI exists or is designed. The natural slot for it is the "Perfil
e dados" row on `/mais` (see `src/adapters/mais.ts` and `src/routes/mais.tsx`) — noted for later,
not built now.

## Server/client security boundary

`@money-copilot/app-services` (and everything it touches — persistence, AI, Open Finance, provider
credentials) may only be imported from `apps/ritmo/src/functions/` modules. TanStack Start's native
import-protection plugin enforces this at the Vite plugin level in dev (a hard error overlay on
violation) — Lovable's own `vite-tanstack-config` configures it as: any import path containing
`server/` is denied from client-context code. `functions/` was chosen specifically to get this
protection without colliding with that literal pattern.

**Automated build-time proof**, not just a stated rule: `apps/ritmo/scripts/check-client-bundle.mjs`
runs after every `vite build`, scanning ONLY the client-targeted output (`.output/public/`, never
`.output/server/`) for: the real `OPENAI_API_KEY`/`PLUGGY_CLIENT_SECRET` values (when set in the
build environment), the literal strings `OPENAI_API_KEY`/`PLUGGY_CLIENT_SECRET`, and the
server-only package names `@electric-sql/pglite`, `pluggy-sdk`, `openai`. Run it via:

```
pnpm --filter @money-copilot/ritmo build   # runs vite build && node scripts/check-client-bundle.mjs
```

Verified clean after wiring the Assistente screen (the first screen to touch `OPENAI_API_KEY`,
transitively via `@money-copilot/ai`'s `OpenAIProvider`).

## Local environment

`apps/ritmo/.env.local` (gitignored, never committed) holds `OPENAI_API_KEY`/`OPENAI_MODEL` —
copied from `apps/web/.env.local`, needed only for the Assistente screen's real chat. Every other
screen works with no environment configuration (pure PGlite fixture reads).

## PGlite single-process rule (extends DEC-051)

Both `apps/web` and `apps/ritmo` can open the file-backed PGlite database. **Never run
`pnpm --filter @money-copilot/web dev` and `pnpm --filter @money-copilot/ritmo dev` concurrently
against the same data directory** — see DEC-083. Each app's default `MONEY_COPILOT_DB_PATH`
resolves relative to its own `cwd`, so today they write to two different physical files
(`apps/web/.data/...` vs. `apps/ritmo/.data/...`) rather than corrupting a shared one — but never
override `MONEY_COPILOT_DB_PATH` to point both at one file while both might run at once.

## Mock data lifecycle (complete)

`src/lib/mock.ts` (the Lovable prototype's static `compromissos`/`movimentos`/`insights` data) was
kept only through the visual-fidelity baseline-screenshot checkpoint and has been deleted — every
screen now reads real data. Real fixture `FixedExpense` rows were never populated with the mock's
due-dates (05/10, 10/10, etc.) — those were visual placeholders only, never confirmed real facts.

## Data-model gaps found, and how each was resolved

Each of these is a case where the Lovable mock claimed something the real engine doesn't (yet) know
— resolved by adapting the displayed COPY, never by fabricating a number, and never by changing the
approved component's layout/visual result.

1. **No due-date on `FixedExpense`.** Added `dueDayOfMonth?: number` (additive, optional —
   `packages/financial-engine/src/domain/expense.ts`). Real fixture rows leave it `undefined`
   (unknown) until a real due date is confirmed. `src/adapters/format.ts`'s `dueDayBadge()` renders
   a neutral "–" placeholder instead of a guessed day; `sortByDueDay()` sorts known-day commitments
   first, unknown ones last. Used on Home, Transações, and Planejamento.
2. **No pay-date on `Income`.** The mock's "até o próximo salário, em 12 dias" assumes a specific
   next-paycheck date the domain doesn't model. Reframed to what the engine actually knows: calendar
   days remaining in the month (`SafeToSpend.daysRemainingInMonth`) — "até o fim do mês, em N dias."
3. **Two of the mock's four example Insights have no engine equivalent** (a week-over-week spending
   pace comparison, and a positive "your planned event still fits" confirmation — alerts only fire on
   problems, never confirmations). The Insights feed only ever renders real active Alerts and real
   pending Recommendations; these two specific examples simply don't appear from real data. Worth a
   future sprint, not Sprint 8.
4. **No real display name.** `FinancialProfile.label` is `"Founder (Sprint 1 fixture)"` — an
   internal fixture label. `getCurrentProfileContext()` returns a placeholder `displayName`
   ("Douglas"), clearly a presentation-layer stand-in until real profiles/auth exist, resolved
   through the same seam Sprint 9's auth will replace.
5. **No scheduled daily-digest notification.** The mock's "Resumo diário às 20h" implies a working
   schedule that doesn't exist (Sprint 7's alerts are event-driven only). `/mais`'s Notificações row
   shows the real `NotificationPreferences.quietHoursStart/End` window when configured, or an honest
   "Sem resumo agendado" otherwise.
6. **The Planejamento "Linha do mês" timeline mostly has no real dated facts to show** (no pay-date,
   no confirmed bill due-days for most fixture rows). Per the Founder's explicit instruction, the
   approved timeline/event-card SHELL is preserved unconditionally — it only ever renders entries
   with a real, known date (currently: real upcoming `FinancialEvent`s, via
   `getUpcomingFinancialEventsForProfile`), never a fabricated salary or bill date. With zero real
   dated events the shell shows an honest "Nenhum evento com data confirmada" message inside the
   same card, never a removed/resized section.
7. **The Assistente "Simulação" card's mock fields (`Hoje`/`Depois`) don't match the real
   `simulateExpense` tool's actual output shape** (`recommendedLimit`/`projectedSavingsAfter`/
   `compensationRequired`, not a simple before/after pair). The card only ever renders when the
   assistant actually ran that tool this turn, showing those three real figures.
8. **The live model's chat replies use `**bold**` markdown**; the approved bubble is a plain `<p>`,
   never a markdown renderer. `src/adapters/assistente.ts`'s `parseInlineMarkdown()` splits
   `**...**` spans into bold/plain segments — the only markdown handling implemented, not a general
   parser — so the approved bubble never shows literal asterisks.
9. **`"UNCATEGORIZED"` is a real domain sentinel value** (not `null`) for an uncategorized
   transaction's `category`. Localized to the same "Sem categoria" label used for a genuinely-null
   category, everywhere a transaction's category is displayed.

## Assistente: real AI chat, not a scripted demo

Sprint 8 also replaced the mock's fully-scripted example conversation with a real, working chat
against the SAME OpenAI-backed orchestrator `apps/web`'s (unused, UI-less) `/api/chat` route already
called: `runCopilotTurn` from `@money-copilot/app-services`, via `@money-copilot/ai`'s
`OpenAIProvider`. No AI orchestration is reimplemented in `apps/ritmo` — `functions/assistente.ts`
only invokes the existing tool-calling loop and returns its structured result.

- `getAssistenteData` loads the profile's most recently updated conversation (if any) so the chat
  resumes across page loads — real persistence via the same conversation service `apps/web` uses.
- `sendAssistenteMessage` is a `POST` server function; on a missing `OPENAI_API_KEY` or any
  `AIError`, it returns a structured, honest error the UI renders as an assistant-style message
  (matching `apps/web`'s own graceful `AI_CONFIGURATION_ERROR` degradation) — never a crash.
- The empty state (no conversation yet) shows no messages at all — never a fabricated scripted
  exchange — with the approved shell (quick-action shortcuts, input, send button) fully intact.
- **Known limitation:** the "Simulação" card's data is only available in the response of the turn
  that produced it — it is not separately persisted, so it does not reappear next to older messages
  after a page reload. This is an honest consequence of not fabricating facts we don't have on
  reload, not a bug to silently paper over.

Verified live with two real, billed OpenAI calls during integration, kept deliberately small in
number. The card's field mapping and the markdown-bold-rendering fix are both recorded in
`docs/DECISIONS.md` DEC-086.

## Implementation bugs found live, and fixed

Three real, non-obvious bugs were found during this sprint's own build-out (distinct from the
Founder-facing "data-model gaps" above, which are product/copy decisions, not bugs):

- **DEC-084**: TanStack Start's import-protection plugin denies any client-context import from a
  `server/`-pattern path — discovered as a full-page dev error when the plan's originally-chosen
  `src/server/` directory name collided with Lovable's own scaffold convention. Fixed by renaming to
  `src/functions/` (see "Architecture" above).
- **DEC-085**: a date formatted one day early ("04 de setembro" for `asOfDate = "2026-09-05"`) because
  `Intl.DateTimeFormat` defaulted to the host process's local timezone instead of UTC. Fixed with an
  explicit `timeZone: "UTC"` in `src/adapters/format.ts`.
- **DEC-086**: the Assistente screen's live OpenAI replies rendered literal `**asterisks**` instead
  of bold text, and the "Simulação" card's originally-planned field mapping didn't match what
  `simulateExpense` actually returns. Both fixed — see "Assistente: real AI chat" above.

## Verification performed

- Visual-fidelity baseline screenshots (mobile 412×915, desktop 1440×900, both themes) captured
  before any data wiring began, for all six routes — compared after each screen's real-data wiring.
  No unapproved visual difference found; only the pre-approved copy reframings above.
- `pnpm --filter @money-copilot/ritmo typecheck / lint / test` all green (0 errors; 7 pre-existing
  `react-refresh/only-export-components` warnings in untouched shadcn/Lovable-scaffolded files,
  matching the upstream prototype's own `eslint .` convention — not `--max-warnings=0`).
- Full monorepo `pnpm -r run typecheck / lint / test` green across all 9 packages/apps.
- `check-client-bundle.mjs` run clean against a real production build, both before and after the
  Assistente screen introduced real `OPENAI_API_KEY` usage.

## Explicitly out of scope (Sprint 8)

Retiring `apps/web`; any visual redesign; production authentication; production hosting/deployment
(the Cloudflare/nitro build target only applies to `vite build`, never `vite dev`); real push/email
notifications; a real discovery provider; multi-profile support.
