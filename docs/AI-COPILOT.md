# Money Copilot — AI Copilot (Sprint 4)

This document covers the conversational AI layer added in Sprint 4. Read `docs/PROJECT_STATE.md`
first for the full continuity account; this file is the detailed reference for how the AI layer is
built and why.

## The one rule everything else follows

**The financial engine calculates. The AI interprets, explains, and asks.** The LLM never computes a
monetary value. Every number a user sees comes from a deterministic tool call into
`@money-copilot/financial-engine` (via `@money-copilot/app-services`). See `docs/PRODUCT.md` and
`docs/ARCHITECTURE.md`, "Enforcing 'the engine calculates, AI interprets' in code."

## Live bank data release gate

**(Sprint 4.5 update)** `REAL_PERSONAL_FINANCIAL_DATA_ALLOWED = TRUE_PENDING_FOUNDER_APPROVAL` (raised
from `false` — see DEC-033, DEC-054, and `docs/PROJECT_STATE.md` rule 20). Live Pluggy sandbox
validation has now PASSED and been Founder-approved — the product is technically eligible to receive
real personal financial data — but no real institution may actually be connected until the Founder
gives a SEPARATE, explicit approval. All AI features still use only seeded fixture / sandbox
`PluggyProvider` / `MockProvider` data — never the Founder's real Santander/Nubank accounts. Product
currently recommends completing live OpenAI validation (see "Live OpenAI smoke test" below) before
that separate real-data approval, so the Founder's first real-data experience includes the working
conversational copilot.

## Package layout

```
packages/ai/src/
  domain/conversation.ts   Conversation, ConversationMessage, AIToolExecution, AIRequestLog —
                           provider-neutral entities the application owns
  provider/types.ts        AIProvider interface, AITurnItem (neutral message/tool_call/tool_result),
                           AIErrorCode taxonomy, AIError
  provider/mock-provider.ts  MockAIProvider — deterministic, no network, used by all automated tests
  provider/openai-provider.ts  OpenAIProvider — the ONLY file that imports the `openai` SDK
  model-config.ts          DEFAULT_OPENAI_MODEL + resolveOpenAIModel(env)

packages/app-services/src/copilot/
  tools.ts                 The tool allowlist — Zod schemas + execute() bound to app-services
  mutation-guard.ts         hasExplicitMutationIntent() — deterministic explicit-vs-hypothetical guard
  facts.ts                  FinancialFact model + per-tool extractors
  grounding.ts               groundResponseText() + buildFallbackResponseText()
  system-instructions.ts    Version-controlled system prompt
  conversation-service.ts   getOrCreateConversation/appendMessage/list* — persistence wrappers
  orchestrator.ts            runCopilotTurn() — the bounded tool-calling loop
```

`apps/web/app/api/chat/route.ts` is the only place that constructs a real `OpenAIProvider` (reads
`OPENAI_API_KEY` from `process.env`, server-only) and calls `runCopilotTurn`. `apps/web/app/
components/ChatPanel.tsx` is the chat UI.

## Provider-neutral `AIProvider` abstraction

```ts
interface AIProvider {
  readonly name: string;
  generate(options: AIGenerateOptions): Promise<AIGenerateResult>;
}
```

`AIGenerateOptions`/`AIGenerateResult` and the `AITurnItem` union (`message | tool_call |
tool_result`) are plain, vendor-neutral shapes. **No file outside `packages/ai/src/provider/
openai-provider.ts` may import from the `openai` npm package** — code review for this and future AI
work should check for that specifically, the same way Sprint 3 checked for Pluggy leaking into
`financial-engine`. A future `AnthropicProvider` implements the same interface with zero changes to
`app-services` or `apps/web`.

`MockAIProvider` takes either a fixed array of scripted `AIGenerateResult`s (one per call, in order —
the natural way to script a multi-turn tool-calling exchange) or a function of `(options, callIndex)`
for dynamic scripting. It never touches the network. Every automated test in this repository uses it;
no `OPENAI_API_KEY` is required for the default test suite.

## OpenAI implementation

- Uses the **Responses API** (`client.responses.create`), not Chat Completions — the SDK's own
  documentation describes Chat Completions as a legacy-but-supported fallback and the Responses API
  as the actively developed primary interface, with first-class tool-calling and structured output
  support.
- Default model: **`gpt-5.6-terra`** (`DEFAULT_OPENAI_MODEL` in `packages/ai/src/model-config.ts`),
  overridable via the `OPENAI_MODEL` environment variable. No model name is ever hardcoded anywhere
  else — `resolveOpenAIModel(env)` is the single source.
- **Conversation state is reconstructed locally on every call**, from `ConversationMessage` rows in
  the database, translated into `AITurnItem[]` — never from OpenAI's `previous_response_id`
  continuation mechanism. This is deliberate: see "No provider-locked conversation memory" below.
- Tool definitions are translated to OpenAI's `{ type: "function", name, description, parameters,
  strict: true }` shape from the app-services tool registry's Zod schema (via `z.toJSONSchema`).
  **Every tool argument must be `.nullable().default(null)` rather than plain `.optional()`** —
  discovered via live validation (Sprint 4.5, DEC-043): OpenAI's strict mode rejects any schema where
  a `properties` key is missing from `required`, which is exactly what plain Zod `.optional()`
  produces. `.nullable().default(null)` keeps the key in `required` (the model sends explicit `null`)
  while still letting internal call sites omit it. Enforced by a permanent regression test,
  `tool-schema-strict-mode.test.ts`, run offline against every registered tool.
- SDK error classes are mapped to the app's `AIErrorCode` taxonomy in `normalizeOpenAIError` —
  `AuthenticationError`/`PermissionDeniedError` → `AI_AUTHENTICATION_ERROR`, `RateLimitError` →
  `AI_RATE_LIMITED`, `APIConnectionTimeoutError` → `AI_TIMEOUT`, `APIConnectionError` →
  `AI_PROVIDER_UNAVAILABLE`, `BadRequestError` → `AI_INVALID_TOOL_ARGUMENTS`, `InternalServerError` →
  `AI_PROVIDER_UNAVAILABLE`, anything else → `AI_UNKNOWN_ERROR`. Never includes the API key or raw
  request headers in a normalized error's message.

## OPENAI_API_KEY

Server-only. Read once, in `apps/web/app/api/chat/route.ts`, from `process.env["OPENAI_API_KEY"]` —
never sent to the browser, never persisted in the database, never logged, never part of an
`AIRequestLog` row. `.env.example` documents it as an empty placeholder. If it's absent,
`POST /api/chat` returns `{ error: { code: "AI_CONFIGURATION_ERROR", ... } }` (HTTP 503) rather than
silently falling back to a stub assistant — the rest of the dashboard (Sprints 1-3) is unaffected.
`MockAIProvider` is a test utility, not a disguised production fallback.

## Conversation persistence — no provider-locked memory

`Conversation` / `ConversationMessage` / `AIToolExecution` / `AIRequestLog` (see
`packages/ai/src/domain/conversation.ts`) are persisted in `packages/persistence` (tables
`conversations`, `conversation_messages`, `ai_tool_executions`, `ai_requests` — migration
`0002_right_spirit.sql`). Every turn:

1. Loads (or creates) the `Conversation` row.
2. Appends the user's message.
3. Reconstructs the FULL prior message history from the database into `AITurnItem[]` — the AI
   provider is handed this on every call. A brand-new `AIProvider` instance (e.g. after a process
   restart, or literally a different provider) sees the identical history, because nothing about it
   lives in provider-side state. Verified directly in `orchestrator.test.ts`, "reuses an existing
   conversation across turns."
4. Appends the final (grounded) assistant message.

`AIToolExecution` is the audit trail: tool name, the ALREADY-VALIDATED arguments (never raw unchecked
model output), status, a small structured `resultSummaryJson` (truncated at 4000 characters — never a
full raw payload), and an `errorCategory` on failure. `AIRequestLog` is call-level observability:
provider, model, latency, tool names, success/failure, token usage if returned, grounding status —
never a secret, never a full banking payload.

## Application tool layer — the allowlist

The LLM never queries Drizzle or calls `financial-engine` internals directly. Its only capability is
calling one of the 16 named tools in `packages/app-services/src/copilot/tools.ts`, each with a
strict Zod argument schema, a `kind` (`READ` or `MUTATION`), and an `execute(ctx, args)` bound to an
`app-services` function. `findTool(name)` returns `undefined` for anything not in this list — the
orchestrator records that as an `INVALID_ARGUMENTS` execution and tells the model "Unknown tool,"
never silently ignoring or crashing.

**READ / SIMULATION tools** (execute unconditionally — they never persist anything):
`getFinancialSnapshot`, `getSafeToSpend`, `getSafeToSpendBreakdown`, `getFinancialPosition`,
`getLifestyleComparison`, `getGoalStatus`, `getSpendingEnvelope`, `getDailyGuidance`,
`simulateExpense`, `getUpcomingFinancialEvents`, `getCategoryBudgetStatus`,
`getRecentSpendingSummary`.

**MUTATION tools** (additionally gated by the explicit mutation policy below):
`recordManualTransaction`, `createPlannedFinancialEvent`, `updatePlannedFinancialEvent`,
`replanAfterExpense`.

Tool arguments are expressed in human units the model naturally produces (`amountReais: 500` for
R$500.00), converted to integer-cent `Money` inside `execute()` via `fromReais` — the model never
handles cents math, and the app never trusts a model-supplied cents value directly.

## Explicit mutation policy

`packages/app-services/src/copilot/mutation-guard.ts`'s `hasExplicitMutationIntent(text)` is a
deterministic, defense-in-depth check re-applied to the ORIGINAL triggering user message — independent
of the model's own judgment about whether to call a mutation tool — before any `MUTATION`-kind tool
actually executes. It returns `false` (never mutates) whenever the text matches a hypothetical marker
("what if", "could I", "should I", "would I", "how much should", …) and `true` only when it also
matches an explicit-action marker ("I spent", "I paid", "record", "reserve", "add it", "confirm", …).
Ambiguous text (neither pattern matches) is treated as NOT explicit — biased toward the safe failure
mode. When a mutation is skipped this way, the orchestrator records an `AIToolExecution` with status
`FAILED` and `errorCategory: "MUTATION_NOT_EXPLICIT"`, and feeds the model a tool result saying so, so
the assistant can tell the user nothing was recorded.

**PT-BR (Sprint 4.5):** both pattern lists have a parallel set of Portuguese phrases (e.g. "gastei",
"registre", "reserve"/"reservar" for explicit action; "e se eu", "será que", "poderia", "deveria" for
hypothetical). Portuguese frequently drops the subject pronoun ("Poderia reservar...?" means "Could
[I] reserve...?" with no "eu") — patterns match the verb alone rather than requiring "eu poderia"/
"poderia eu", a real nuance discovered while writing the PT-BR test cases in `mutation-guard.test.ts`.

## `getSpendingEnvelope` and daily guidance

See `docs/FINANCIAL-ENGINE.md`, "Spending envelope, daily guidance, replan, goal/category status." The
tool layer additionally resolves an optional `category` argument into `CategoryHeadroom` (via
`getCategoryBudgetStatus`) before calling the pure function — the LLM asks for a category by name; it
never computes the headroom itself.

## Manual transaction recording

`recordManualTransaction` (mutation tool) categorizes the reported expense through the SAME
`categorize`/`normalizeMerchant` rules a provider import uses (`app-services/src/mutations.ts`) — the
AI supplies the raw merchant/description text, never the category directly. It resolves (or lazily
creates) a generic "Manual entry" `PaymentSource` unless the user explicitly named how they paid.
Because the result is an ordinary `FinancialTransaction` with `origin: "MANUAL"`, it flows through the
existing snapshot math on the very next read, and remains reconcilable against a later-imported
equivalent provider transaction via the existing Sprint 2/3 `findTransactionDuplicates` reconciliation
pass the next time a sync runs — no new dedup logic was needed.

## Planned events through conversation

`createPlannedFinancialEvent` creates an event with an honest `UNKNOWN`-certainty "Budget" line item
when no amount is given — never inventing a number. `updatePlannedFinancialEvent` sets a budget on an
existing event, addressed by `eventId` (obtained from a prior `getUpcomingFinancialEvents` call, never
guessed). When an event has more than one `PLANNED` line item (e.g. the fixture's Rodeo event, which
has both a Transportation and a Drinks line item), the caller must additionally supply `lineItemId` —
`resolveBudgetLineItemId` throws rather than silently guessing which one the user meant. The common
"Reserve R$1,200 for the beach" case resolves automatically, because the beach trip fixture has
exactly one `PLANNED` line item with `UNKNOWN` certainty.

## Spending override / replan

`replanAfterExpense` (mutation tool) is a single tool that both records the actual expense (via
`recordManualTransaction`) and returns the recalculated deterministic guidance
(`financial-engine`'s `replanAfterExpense`) — `newSafeToSpend`, `newProjectedSavings`, `goalGap`/
`compensationRequired`, `remainingDiscretionaryBudget`, `remainingDailyGuidance`, `warnings`. It never
judges the user (see `docs/PRODUCT.md` principle #4) and never invents cost-cutting suggestions — see
`docs/FINANCIAL-ENGINE.md`.

## Financial fact grounding

`packages/app-services/src/copilot/facts.ts` deterministically extracts `FinancialFact[]` (`label`,
`amountCents`, `certainty`, `sourceTool`, `semanticType`) from each successful tool result — a total
function per tool name, never a guess. `grounding.ts`'s `groundResponseText(text, facts,
userMessageText)` extracts every BRL-shaped amount mentioned in the assistant's draft text and checks
each one against the set of amounts in `facts` UNION amounts the user themselves typed. Any amount not
traceable to either is `unsupportedAmountsCents`, and grounding status becomes `FAILED`. On failure,
the orchestrator replaces the draft text with `buildFallbackResponseText(facts)` — a deterministic,
template-rendered list of the facts actually available — and adds a warning. This is deliberately
narrow (regex-based currency extraction, not general NL verification) — see NON-NEGOTIABLE (Sprint 4):
"do not over-engineer general NL verification, protect only important monetary values."

## Structured assistant response

`CopilotResponse { conversationId, text, financialFacts, warnings, toolExecutions, groundingStatus }`
is what `runCopilotTurn` returns and `/api/chat` sends to the browser. The chat UI
(`ChatPanel.tsx`) renders `financialFacts` as small cards beneath the assistant's message rather than
raw JSON, and shows `warnings` in a muted list — narrative text never replaces the cards; they're
independent, both derived from the same tool executions.

## Conversation tool loop

`runCopilotTurn` (orchestrator.ts): load history → call the model with the full tool allowlist → if
it returns a final message, ground it and stop; if it returns tool calls, validate each against its
Zod schema, apply the mutation guard, execute, record an audit row, and feed the result back → repeat,
capped at `MAX_TOOL_ITERATIONS = 6`. If the cap is reached without a final message, the loop falls
back to a deterministic fact summary rather than looping forever or crashing. An unregistered tool
name, invalid arguments, a skipped mutation, or a thrown tool execution error are all handled
per-call (recorded, fed back to the model as an error tool result) without aborting the whole turn —
only a failure from the AI provider's `generate()` call itself (auth, rate limit, timeout, ...)
propagates as a normalized `AIError` to the caller.

## System instructions

`packages/app-services/src/copilot/system-instructions.ts` — a single version-controlled string
(`CURRENT_SYSTEM_INSTRUCTIONS`, currently `SYSTEM_INSTRUCTIONS_V2`), never inline in a route handler.
Covers: calculations only via tools, never inventing missing data, stating uncertainty, never
moralizing, distinguishing hypothetical from decided actions, protecting existing priorities/never
proposing cost-cutting, asking concise clarifying questions only when necessary, always fetching
current data via tools rather than memory, no real-world venue/product recommendations yet, and
explaining impact rather than a bare yes/no. **V2 (Sprint 4.5)** adds an explicit rule: respond in
the same language the user writes in (e.g. Portuguese) — the instructions themselves stay in English
(the model handles this fine), but the rule is now explicit rather than merely assumed.

## Model configuration

`packages/ai/src/model-config.ts`: `DEFAULT_OPENAI_MODEL = "gpt-5.6-terra"`,
`resolveOpenAIModel(env)` reads `OPENAI_MODEL`, falling back to the default for an unset or blank
value. No auto-escalation to a different model exists yet.

## AI error handling

`AIErrorCode`: `AI_CONFIGURATION_ERROR | AI_AUTHENTICATION_ERROR | AI_RATE_LIMITED |
AI_PROVIDER_UNAVAILABLE | AI_TIMEOUT | AI_INVALID_TOOL_ARGUMENTS | AI_TOOL_EXECUTION_FAILED |
AI_GROUNDING_FAILED | AI_UNKNOWN_ERROR`. `/api/chat` maps each to an HTTP status (503/502/429/502/
504/400/500/500/500) and returns `{ error: { code, message } }` — never the API key or request
internals. The deterministic dashboard (`apps/web/app/page.tsx`) never depends on the AI layer and
keeps working regardless of AI availability.

## AI observability and cost control

Every `generate()` call is logged (`AIRequestLog`): provider, model, start/end, latency, tool call
count and names, success/failure, token usage if the provider returned it, grounding status, and the
provider's own response id (for debugging only — never relied on as history's source of truth). Never
logs the API key or a full banking payload. Token/cost control: no endpoint ever sends the user's
entire transaction history or entire message history "just in case" — `getRecentSpendingSummary` is
explicitly bounded (default 7 days, max 90), and the conversation history sent each turn is exactly
the persisted messages for that conversation, nothing more.

## Testing

Every default-suite test uses `MockAIProvider` — no `OPENAI_API_KEY` required
(`packages/ai`, `packages/app-services/src/copilot/*.test.ts`). Coverage includes: provider
abstraction/no-SDK-leakage, conversation/message/tool-execution persistence, read-vs-mutation
behavior, explicit-vs-hypothetical mutation gating in both English and PT-BR (Sprint 4.5), the
Safe-to-Spend regression (217,111 cents) reached through a simulated chat turn in both languages,
envelope/daily-guidance determinism, `simulateExpense`'s three zones never blocking,
`replanAfterExpense` recalculation, no-auto-cost-cutting, tool sandboxing (unregistered tool / invalid
arguments rejected), every tool's JSON Schema satisfying OpenAI's strict-mode `required` constraint
(Sprint 4.5, `tool-schema-strict-mode.test.ts` — see DEC-043), bounded max-iterations,
tool-execution-failure handling, AI provider failure normalization (rate limit, timeout), grounding
pass/fail in both languages (including an AI-invented amount being replaced, and a user-supplied
amount being allowed), and structured facts staying separate from narrative text.

## Live OpenAI smoke test

**Attempted in Sprint 4.5 — PARTIAL / BLOCKED BY EXTERNAL BILLING** (status unchanged at Sprint 4.5
close). With a real `OPENAI_API_KEY` configured:

- The configured model (`gpt-5.6-terra`) was confirmed to exist and be retrievable
  (`client.models.retrieve`) — model availability check PASSED.
- The first real call surfaced DEC-043's strict-schema bug, which was fixed and re-verified live.
- PT-BR deterministic hardening (mutation-guard explicit/hypothetical patterns, grounding) is complete
  and tested against `MockAIProvider`.
- Every actual generation call (`live-openai-smoke.test.ts`, `describe.skipIf(!OPENAI_API_KEY)` so it
  never runs in the default suite) still returns `credit_balance_exhausted` — this persisted even
  after credits were added to the account and a wait. **This is specifically an organization-level
  prepaid-credit exhaustion, per the Founder's own correction of an earlier, incorrect diagnosis in
  this file — it must never be conflated with `project_spend_limit_exceeded` or
  `organization_spend_limit_exceeded` (separate, spend-LIMIT errors, not a credit-balance error).**
  Per explicit Founder instruction: do not change the model, do not change/rotate the API key, and do
  not retry until the Founder confirms billing has actually been fixed with OpenAI. **The exact
  remaining action is external to this codebase**: the Founder (or the OpenAI account owner) must
  resolve the organization's prepaid-credit balance directly with OpenAI — no code, model, or key
  change here can fix this error.
- None of the six PT-BR scenario tests (basic response, tool call + grounding regression, affordability
  question, hypothetical-vs-explicit mutation gating, independent-living question) have run to
  completion yet. They are written and ready; re-run with:
  `pnpm --filter @money-copilot/app-services exec vitest run src/copilot/live-openai-smoke.test.ts`
  (with `OPENAI_API_KEY`/`OPENAI_MODEL` loaded into the shell environment first) once billing is
  confirmed fixed.

## Known limitations

- No streaming yet — the chat UI shows a "Thinking…" state and waits for the full, grounded response.
  This was judged acceptable for Sprint 4's scope; adding streaming later must not weaken the
  grounding guarantee (facts must still be validated before being shown as authoritative).
- The chat UI is single-active-conversation (persisted in `localStorage`), not a full conversation
  list/switcher — sufficient per the brief's "conversation list or at least active-conversation
  support."
- `ASOF_DATE` is still a fixed constant shared with the rest of the dashboard (see `app/page.tsx`) —
  no real "today" clock/timezone policy exists yet; unchanged from Sprint 1-3.
- The BRL currency-amount regex in `grounding.ts` handles the common `R$ 1.234,56` / `BRL 1234.56` /
  plain-number shapes; an unusual format could in principle slip past detection. Given the
  brief's explicit "do not over-engineer general NL verification" instruction, this was judged
  sufficient for the given test scenarios rather than building a full currency-parsing library.
- The PT-BR mutation-guard patterns (Sprint 4.5) are a curated example list, not a grammatical parser
  — validated against the specific example sentences in this sprint's brief and the founder's likely
  phrasing, not exhaustively against every way a Brazilian Portuguese speaker might phrase intent.
- (Sprint 4.5) A real Pluggy sandbox Connect flow was attempted and did not persist a connection on
  this app's side — see docs/PROJECT_STATE.md, "Integration status," for the exact retry steps. Real
  Pluggy account/transaction/bill shape validation (this sprint's scope items 6-7) therefore remains
  unexecuted; the amount-sign/effect mapping in `docs/OPEN-FINANCE.md` is still an unvalidated,
  documentation-derived heuristic.
