# Money Copilot — Alerts & Notifications (Sprint 7)

This document covers the deterministic alert engine and the in-app notification layer added in
Sprint 7. Read `docs/PROJECT_STATE.md` first for the full continuity account; this file is the
detailed reference for how alerting is built and why. See `docs/DECISIONS.md` DEC-076 onward for the
individual architectural decisions this document summarizes.

## The one rule everything else follows

Alert CREATION is 100% deterministic. The AI may explain an alert, summarize what changed, answer
"why did I get this?", and act on the user's own explicit instruction (mark seen / dismiss / change a
notification preference) — it never decides whether an alert exists, what it means, or how severe it
is. Exactly the same boundary that already governs the financial engine (`docs/AI-COPILOT.md`), the
recommendation engine (`docs/RECOMMENDATIONS.md`), and the concierge (`docs/CONCIERGE.md`).

## Alert vs. notification

Two separate concepts, two separate persisted shapes (DEC-076):

- **Alert** (`packages/app-services/src/alerts/types.ts`) — a persisted domain signal that something
  relevant happened: `SAFE_TO_SPEND_MATERIAL_DROP`, `RECOMMENDATION_FAILED`, `RECOMMENDATION_VERIFIED`,
  `UPCOMING_EVENT_PRESSURE`, `UPCOMING_EVENT_UNKNOWN_COST`, `LIQUIDITY_COVERAGE_DEGRADED`,
  `CONNECTION_NEEDS_ATTENTION`, `STALE_CONCIERGE_PLAN`. Eight types, deliberately not thirty.
- **NotificationDelivery** (`packages/app-services/src/notifications/types.ts`) — one delivery ATTEMPT
  of one alert through one channel (`IN_APP` today; `PUSH`/`EMAIL` modeled for later, never
  implemented). One `Alert` may have zero or many `NotificationDelivery` rows over its lifetime.

They are never collapsed into one table, and alert creation never depends on whether a notification
was ever delivered — see "Notification delivery model" below.

## Architecture

```
packages/financial-engine/src/domain/
  alert-policy.ts     AlertPolicy + DEFAULT_ALERT_POLICY — every numeric threshold, centralized
  alert-signal.ts     Pure classification functions: evaluateSafeToSpendChange,
                      hasSafeToSpendRecovered, evaluateEventPressure, hasEventPassed,
                      evaluateLiquidityCoverageChange, evaluateConnectionAttention

packages/app-services/src/alerts/
  types.ts            Alert, AlertType, AlertStatus, AlertSeverity, AlertEvidence (per-type union)
  ranking.ts           AlertRankingPolicy + rankAlerts — deterministic dashboard prioritization
  alert-service.ts     evaluateAlerts() (the orchestrator), the episode mechanism, markAlertSeen/
                      dismissAlert/reevaluateAlertContext

packages/app-services/src/notifications/
  types.ts            NotificationChannel/Status/Category/Preferences, quiet-hours evaluation
  provider.ts         NotificationProvider interface + MockNotificationProvider
  notification-service.ts   getNotificationPreferences/updateNotificationPreferences,
                            deliverAlertNotification, syncNotificationsForProfile

packages/app-services/src/notification-provider-registry.ts   mirrors discovery-provider-registry.ts
```

The pure classification functions live in `financial-engine` (framework-free, zero persistence/AI/
discovery knowledge) — exactly like `evaluateBudgetFit` (Sprint 6). `Alert` itself is an
APPLICATION-layer type in `app-services`, not a `financial-engine` domain type, for the same reason
`ConciergeSession`/`OutingPlan` are (DEC-068): its `relatedEntityType`/`relatedEntityId` can point at a
`SavedConciergePlan`, an app-services-only concept `financial-engine` must never depend on.

## Episode identity

Every alert's `identityKey` reflects the ECONOMIC CONDITION, never a random id:

| Type | identityKey |
|---|---|
| SAFE_TO_SPEND_MATERIAL_DROP | `{profileId}:SAFE_TO_SPEND_MATERIAL_DROP` |
| RECOMMENDATION_FAILED / VERIFIED | `{profileId}:{TYPE}:{recommendationId}` |
| UPCOMING_EVENT_PRESSURE / UNKNOWN_COST | `{profileId}:{TYPE}:{eventId}` |
| LIQUIDITY_COVERAGE_DEGRADED | `{profileId}:LIQUIDITY_COVERAGE_DEGRADED` |
| CONNECTION_NEEDS_ATTENTION | `{profileId}:CONNECTION_NEEDS_ATTENTION:{connectionId}` |
| STALE_CONCIERGE_PLAN | `{profileId}:STALE_CONCIERGE_PLAN:{savedPlanId}` |

Unlike `Recommendation.identityKey` (globally unique per profile at the DB level), an `Alert`
identity can have MULTIPLE historical rows over time — at most one is ever non-terminal
(`ACTIVE_UNSEEN`/`ACTIVE_SEEN`/`DISMISSED`) at once; the rest are `RESOLVED`. `alert-service.ts`'s
`upsertAlertEpisode` is the single, shared mechanism every alert type funnels through
(`findLatestAlertRowByIdentityKey` → reuse if non-terminal and still true, resolve if now false,
create only when no non-terminal row exists) — no alert type duplicates this logic itself (see
Section 31, "do not duplicate alert logic inside each feature").

## Alert lifecycle

`ACTIVE_UNSEEN` → `ACTIVE_SEEN` (user saw it) → `DISMISSED` (user chose to stop seeing it) is one
path; `RESOLVED` (the underlying condition is no longer true) can happen from any non-terminal state,
deterministically, never by user action. **Dismissal is not resolution** — a dismissed episode whose
condition is still true stays dismissed; it never reappears on its own, and only resolves (silently)
or a NEW episode opens after the condition first resolves and later re-triggers. Every transition is
appended to `Alert.transitions` (mirrors `Recommendation.decisionHistory`) — never overwritten.

## Anti-spam policy

- **One non-terminal row per identity** — `upsertAlertEpisode`'s core guarantee.
- **Repeated identical evaluation reuses, never duplicates** — `REUSED` updates `lastTriggeredAt`/
  evidence/reasonCode in place.
- **Seen/dismissed never regress** — a re-evaluation that finds the condition still true only touches
  `lastTriggeredAt`/evidence; `status`/`seenAt`/`dismissedAt` are left exactly as they were.
- **Recovery hysteresis** — Safe-to-Spend resolution compares against the ORIGINAL episode baseline
  (`activeDropEpisodeBaselineCents`, persisted on `AlertEvaluationCheckpoint`) with a
  `safeToSpendRecoveryHysteresisRatio` buffer, so a value oscillating right at the threshold does not
  flap the alert open/resolved every evaluation.
- **Bootstrap suppresses retroactive noise** — see below.
- **Notification idempotency** — `deliverAlertNotification` never creates a second `NotificationDelivery`
  row for the same alert+channel.

## Bootstrap semantics

On the FIRST-ever `evaluateAlerts` call for a profile (no `AlertEvaluationCheckpoint` row exists yet),
the two CHECKPOINT-DELTA-based alert types (`SAFE_TO_SPEND_MATERIAL_DROP`,
`LIQUIDITY_COVERAGE_DEGRADED`) never fire — there is no meaningful "before" to compare against yet, so
a fresh profile (or a profile with years of pre-existing fixture/imported data) never gets flooded with
retroactive alerts about its starting state. The checkpoint is still recorded on that first call, so
the SECOND evaluation has a real baseline to compare against.

This bootstrap suppression does NOT apply to the other five alert types — a CURRENTLY-failed
recommendation, a CURRENTLY-stale concierge plan, a CURRENTLY-broken connection, or a
CURRENTLY-pressuring upcoming event are presently-true facts evaluated from CURRENT state only (no
delta needed), so they surface correctly even on the very first evaluation.

A subtlety specific to liquidity coverage: a profile that has NEVER connected any institution is
permanently `UNKNOWN` from day one — that is not a "degradation" (nothing was ever better), so it must
never alert regardless of how many times it's evaluated. `evaluateAlerts` distinguishes "was there
already an active episode" (query the actual alert row, not just the rolling checkpoint value) from
"did coverage genuinely get worse than the last evaluation" — see the code comment in
`alert-service.ts` for the reasoning; a naive "not COMPLETE" check would incorrectly alert forever on
a permanently-demo profile.

## Safe-to-Spend change alert

`evaluateSafeToSpendChange(previousCents, currentCents, policy)` — material when EITHER:
- the relative decline is at least `safeToSpendMaterialRelativeDropRatio` (default 15%), OR
- the absolute decline is at least `safeToSpendMaterialAbsoluteDropCents` (default R$200.00),

evaluated as an OR (not AND) since either alone is worth surfacing (a huge percentage drop from a
small baseline, or a huge absolute drop from a huge baseline, can each look unremarkable by the other
metric alone). Independently, crossing from a non-negative value into a genuine deficit
(`currentCents < 0`) is ALWAYS material — this reuses the ALREADY-DOCUMENTED "a negative Safe-to-Spend
is a real, visible deficit" semantics from `FinancialSnapshot.safeToSpend.total`, which is the
deliberately minimal interpretation of the brief's "Safe-to-Spend zone crossing" section: rather than
inventing a second zone model layered on top of `BudgetFitZone`/`SpendStatus`, it reuses a signal that
already exists and already means something in this codebase.

## Recommendation failure / verified integration

Reacts to the domain outcome Sprint 5 already computes (`Recommendation.status`) — never duplicates
verification logic. A `FAILED` recommendation is terminal in its own lifecycle, so its alert, once
created, never resolves automatically (there is no "undo" of a failed cancellation) — it stays until
the user dismisses it. `RECOMMENDATION_VERIFIED` is gated by
`AlertPolicy.verifiedRecommendationAlertsEnabled` (default `true`) and always `INFO` severity — a
low-noise, positive signal, never push-worthy by default.

## Upcoming financial event pressure

`evaluateEventPressure` reuses `evaluateBudgetFit` — the SAME `BudgetFitZone` model Sprint 6
established — rather than inventing a second cost-vs-envelope comparison. An event's known cost
(`futureConfirmed + futureEstimated`, excluding `alreadyPaid` — sunk cost, not pressure) is classified
against the envelope; `WITHIN_CAUTION` or worse is "pressure." Separately, ANY unknown-amount PLANNED
line item within the pressure window (`eventPressureWindowDays`, default 5) produces a
`UPCOMING_EVENT_UNKNOWN_COST` planning alert — a DIFFERENT alert type, not a spending warning; language
stays neutral ("o custo esperado ainda é desconhecido"). Both conditions are evaluated against the
FULL event list (not just the "still upcoming" query), so a passed event's alert can still be found and
`RESOLVED` once `hasEventPassed` is true.

## Liquidity coverage degradation

Uses `FinancialPosition.coverage` (`COMPLETE`/`PARTIAL`/`UNKNOWN`, Sprint 3) — never a new coverage
model. See "Bootstrap semantics" above for why a permanently-`UNKNOWN` demo profile never alerts.
Explains the DATA QUALITY distinction explicitly in its copy ("Alguns saldos não estão atualizados...")
— never implies the user's actual financial situation deteriorated.

## Connection health alert

`evaluateConnectionAttention(status, consecutiveNonSucceededSyncs, daysSinceLastSuccessfulSync,
policy)` needs attention when EITHER the connection's own status is currently attention-worthy
(`LOGIN_ERROR`/`USER_ACTION_REQUIRED`/`ERROR`) for at least `connectionConsecutiveFailureThreshold`
consecutive sync runs (a REAL historical count, via the new `listRecentSyncRunsForConnection` repo
query over the existing `sync_runs` table — never a fabricated/estimated streak), OR a `CONNECTED`
connection has gone stale (`connectionStaleSyncDays`, default 14) despite reporting a healthy status.
A single transient failure never alerts — this is the brief's own explicit "do not alert for one
transient harmless sync error" requirement. `DISCONNECTED`/`PENDING` never need attention (an explicit
user action, not a fault). Evaluated as part of `syncConnection` itself, AFTER the connection's final
status update, so it always sees THIS sync's real outcome — including a FAILED sync, which is exactly
when this alert matters most.

## Stale concierge plan alert

Reuses `reevaluateConciergePlan`'s EXISTING staleness check (Sprint 6) — no second staleness
calculation. Since `SavedConciergePlan` has no `COMPLETED`/`CANCELLED` status field in this codebase
(Sprint 6 only ever persists `status: "SELECTED"`), "no longer relevant" is approximated by a policy-
configured relevance window (`staleConciergePlanRelevanceWindowDays`, default 3 days from when it was
saved) — outside that window, a saved plan is never alerted on regardless of staleness, which is the
closest honest interpretation available given the actual data model. Documented here explicitly as a
known limitation, not a bug: a future sprint that adds real plan-completion tracking should replace
this heuristic.

## Severity

Three levels — `INFO`/`ATTENTION`/`IMPORTANT` — no fake emergency language, deterministic via
`severityFor(type, reasonCode)` in `alert-service.ts`. `CONNECTION_NEEDS_ATTENTION` is always
`IMPORTANT` (something is actively broken); `SAFE_TO_SPEND_MATERIAL_DROP` is `IMPORTANT` only when the
reason is a deficit-crossing or persistent below-baseline state, `ATTENTION` otherwise;
`RECOMMENDATION_VERIFIED`/`UPCOMING_EVENT_UNKNOWN_COST`/`STALE_CONCIERGE_PLAN` are always `INFO`.

## Alert ranking (dashboard prioritization)

`packages/app-services/src/alerts/ranking.ts`'s `rankAlerts` — four named, weighted factors
(severity, unseen, actionability-per-type, recency-decay), never one opaque AI score. The dashboard
shows only the top 5 by this ranking (`apps/web/app/page.tsx`); the full history is reachable via chat
("Tenho algum alerta?" with `includeHistory: true`).

## Notification preferences

One row per profile (`notification_preferences`), created lazily with sensible "everything on"
defaults (`AMOUNT_ALLOWED` privacy, no quiet hours) the first time it's read — never a silent,
surprising "notifications off by default." Five categories map 1:1 from `AlertType` via
`CATEGORY_FOR_ALERT_TYPE` (`FINANCIAL_CHANGE`/`PLANNED_EVENTS`/`RECOMMENDATIONS`/
`CONNECTION_HEALTH`/`CONCIERGE`). Changed only through `updateNotificationPreferences` — the AI tool
`updateNotificationPreference` gates this behind `hasExplicitMutationIntent`, same as every other
mutation.

## Quiet hours

`isWithinQuietHours` handles a window that wraps past midnight (e.g. `22:00`–`07:00`). Per the brief's
explicit instruction, quiet hours NEVER suppress the alert itself or its in-app visibility — they only
would gate a FUTURE external channel's delivery scheduling. Since V1 only implements `IN_APP`, this
function is currently evaluated for completeness/testability but has no effect on any real delivery
path yet — documented here so a future PUSH/EMAIL provider knows exactly where to plug in.

## Notification delivery model

`NotificationDelivery`: `PENDING`/`DELIVERED`/`FAILED`/`SUPPRESSED`. `deliverAlertNotification` is
idempotent (checks for an existing `IN_APP` delivery for the alert first) and privacy-aware
(`renderPayload` strips amounts entirely in `GENERIC` mode, matching the brief's own example: "Money
Copilot encontrou algo que merece sua atenção." vs. "Seu Safe-to-Spend caiu R$ 300."). Only ACTIVE
(unseen or seen) alerts are ever candidates for delivery — `DISMISSED`/`RESOLVED` never get a fresh
one. No raw financial snapshot, transaction history, or provider token is ever sent to a
`NotificationProvider` — only the rendered title/body a delivery needs (see "Security / privacy"
below).

## External notification provider status

`LIVE_EXTERNAL_NOTIFICATION_VALIDATION = NOT_CONFIGURED`. No real push (Firebase/APNs) or email
(SendGrid) provider is implemented or configured — `MockNotificationProvider` (deterministic, no
network, "delivers" trivially since `IN_APP` content already lives in the database) is the only
registered provider, mirroring `MockDiscoveryProvider`'s exact role. Adding a real provider later is
purely additive: one new adapter class implementing `NotificationProvider` + one new
`notification-provider-registry.ts` branch.

## Security / privacy

A `NotificationProvider` receives only `{ financialProfileId, channel, title, body }` — never a
transaction history, bank balance, provider token, or full financial snapshot. In-app content (shown
inside the already-authenticated-by-being-the-only-user dashboard) is not restricted by
`NotificationPrivacyMode` — that setting only governs what a FUTURE external, potentially
lock-screen-visible channel may contain.

## AI tools

Six tools (`packages/app-services/src/copilot/tools.ts`): `getAlerts`/`getAlertDetails`/
`reevaluateAlertContext` (READ), `markAlertSeen`/`dismissAlert`/`updateNotificationPreference`
(MUTATION, gated by the same `hasExplicitMutationIntent` mechanism as every other mutation tool).
`reevaluateAlertContext` re-runs the FULL `evaluateAlerts` pass (never a separate, duplicated per-type
check) and returns the one alert's resulting state — which may now be `RESOLVED`.

## Declarative grounding (shared fact-registration mechanism)

Three sprints in a row (DEC-055, DEC-062, DEC-074) found the exact same live bug: a new tool returns a
correct monetary figure, but `facts.ts`'s per-tool switch statement has no case for it yet, so a
correct answer fails grounding. Sprint 7 adds a small, deliberately narrow fix rather than a large
rewrite (DEC-081): `ToolDefinition` (`tools.ts`) gained an optional `extractFacts` field — a tool that
can return money now declares its OWN extractor RIGHT THERE, alongside its schema and `execute`, where
a reviewer adding a new tool is far less likely to skip it than a separate file. `extractFinancialFacts`
in `facts.ts` checks `findTool(toolName)?.extractFacts` FIRST, falling back to the legacy switch only
when a tool hasn't declared one. All six new alert tools use this mechanism; existing tools are
unchanged (no forced migration). See `facts.test.ts`'s "(Sprint 7)" cases for the regression coverage
that would have caught the DEC-055/062/074 class of bug immediately, offline, for a new tool.

## Grounding

`alertFacts(alert)` (colocated in `tools.ts`) exposes every monetary figure an `Alert`'s
`AlertEvidence` carries (`SAFE_TO_SPEND_MATERIAL_DROP`'s previous/current/delta,
`RECOMMENDATION_DECISION`'s observed/impact amounts, `UPCOMING_EVENT_PRESSURE`'s known cost) —
`LIQUIDITY_COVERAGE_DEGRADED`/`CONNECTION_NEEDS_ATTENTION`/`UPCOMING_EVENT_UNKNOWN_COST`/
`STALE_CONCIERGE_PLAN` carry no monetary evidence and correctly expose zero facts, never a guessed
amount.

## PT-BR mutation behavior

`mutation-guard.ts`'s `EXPLICIT_ACTION_PATTERNS` gained mark-seen/dismiss/preference language in both
languages ("marca como visto"/"mark as seen", "pode ignorar"/"dismiss this alert", "não quero mais
receber alertas de X" — already covered by the existing Sprint 5 "não quero" pattern — "pare de me
avisar"/"stop notifying me"). "E se eu ignorasse esse alerta?" still matches the EXISTING "e se eu"
hypothetical pattern, so no mutation fires — no new hypothetical pattern was needed for this case.

**Live-discovered bug (DEC-082):** the mark-seen pattern originally required "marcar" and "como visto"
to be ADJACENT, matching only the brief's own bare example. Live validation showed a real user message
naming which alert ("Pode marcar o alerta do Safe-to-Spend como visto.") failing as
`MUTATION_NOT_EXPLICIT` even though intent was unambiguous — fixed by widening the pattern to allow an
object phrase in between, with permanent regression tests for the exact failing phrasing. This is the
fourth sprint in a row a mutation-guard pattern gap was found only through live phrasing, not offline
tests written against the same narrow brief examples (see DEC-064, DEC-075).

## UI

`AlertCenter.tsx` (client component): severity-badged cards, an unseen indicator dot, "Marcar como
visto"/"Dispensar" actions (calling `PATCH /api/alerts`), and the empty state "Nada precisa da sua
atenção agora." (Section 43). The dashboard shows only the top-5 ranked active alerts
(`apps/web/app/page.tsx`); asking the chat for the full history is the "Alert Center" for anything
beyond that — deliberately not a separate giant console page, per the brief's own "do not build a
giant enterprise notification console."

## Connected Accounts hardening

- **Disconnect** (`DisconnectButton.tsx`): explicit two-step confirmation, disables itself while the
  request is in flight (idempotent — a duplicate click during that window is inert), always refreshes
  server state afterward so a disconnected account never keeps showing as connected. Uses the EXISTING
  `disconnectConnection`/`DELETE /api/connections?connectionId=...` (Sprint 4.5, DEC-050) — no new
  backend logic.
- **Reconnect**: `ConnectButton` now accepts a `label` prop; `ConnectedAccountsPanel` shows it as
  "Reconectar" (instead of the sync button) whenever a connection's status is
  `LOGIN_ERROR`/`USER_ACTION_REQUIRED`/`ERROR`. It is the SAME Connect flow — `completeConnection`'s
  existing (profile, provider, externalConnectionId) dedup means reconnecting the same sandbox Item
  reuses the existing `ProviderConnection` row rather than creating a duplicate.
- **Duplicate-connect prevention**: the Connect button is now disabled not just while its own token
  fetch is loading, but for the ENTIRE time the Connect widget is open (`isOpen`) — this closes the
  exact Sprint 4.5 incident gap ("two sandbox connections from repeated clicks") where a user could
  click "Connect institution" again while the modal was already open.

## Discovery production safety

Unrelated to alerts directly, but hardened in the same sprint (Section 49): `getDiscoveryProvider`
now refuses to resolve `"mock"` when `NODE_ENV === "production"` (`DiscoveryError`,
`PROVIDER_NOT_CONFIGURED_FOR_PRODUCTION`), and `concierge-service.ts`'s two entry points
(`searchConciergePlaces`/`buildConciergePlansForProfile`) catch specifically that error and return an
honest `{ discoveryUnavailable: true }` result — empty candidates/plans, never synthetic mock venues
presented as real. The financial envelope is still resolved normally; only the discovery step is
unavailable. See `docs/CONCIERGE.md`'s "Live provider status" for the unchanged live-provider gap
this doesn't solve (no real credential exists yet either way).

## Observability

`AlertEvaluationSummary`: `alertsEvaluated`/`alertsCreated`/`alertsReused`/`alertsResolved`/
`alertsSuppressed`/`alertEpisodesRearmed` — returned by every `evaluateAlerts` call.
`syncNotificationsForProfile` returns `{ delivered, suppressed }`. Neither is exposed via any public
endpoint (respects DEC-053 — no new financial-debug surface).

## Persistence / migrations

Four new tables (migration `0005_foamy_puck.sql`, generated non-interactively via
`drizzle-kit generate < /dev/null` — a pure addition, no rename ambiguity): `alerts`,
`alert_evaluation_checkpoints` (one row per profile, unique constraint), `notification_preferences`
(one row per profile, unique constraint), `notification_deliveries`. `Alert`/evidence are JSON-blob
row shapes (see "Architecture" above for why) — mapping lives in `alert-service.ts`, never in
`persistence/mappers.ts`.

## Idempotency

Three identical `evaluateAlerts` calls never duplicate an alert row, never duplicate a transition, and
never re-arm an already-active episode (`alert-service.test.ts`'s explicit idempotency tests).
`markAlertSeen`/`dismissAlert` are no-ops when called again on an already-seen/dismissed alert — no
duplicate transition, no changed timestamp. `syncNotificationsForProfile` never creates a second
`NotificationDelivery` row for the same alert+channel.

## Live validation

Section 73's scenario ran against the real running app and real OpenAI, using the real, previously-
live-validated Pluggy sandbox connection already persisted from Sprint 4.5/6 — a genuine **PASS**:

1. Alert Center loaded with zero alerts on first load (bootstrap correctly suppressed retroactive
   noise for a profile with pre-existing real sandbox data).
2. A real product interaction — "Gastei R$ 800 hoje com um conserto emergencial do carro." via chat
   (`recordManualTransaction`, never a DB hack) — dropped Safe-to-Spend from R$1.293,01 to R$493,01.
3. Reloading the dashboard correctly created exactly one `SAFE_TO_SPEND_MATERIAL_DROP` alert, plus
   correctly surfaced a genuinely-stale `STALE_CONCIERGE_PLAN` alert for a plan saved during an
   earlier (Sprint 6) live session — real historical data, not a fixture.
4. "Tenho algum alerta?" → correctly listed both, correct severities, correct unread count.
5. "Por que você está me avisando sobre o Safe-to-Spend?" → cited the exact figures
   (R$1.293,01 → R$493,01, −R$800,00), `groundingStatus: PASSED`.
6. "Pode marcar o alerta do Safe-to-Spend como visto." → found and fixed a real bug live (DEC-082, see
   below) — after the fix, `markAlertSeen: SUCCESS`.
7. "Pode ignorar o alerta do plano salvo Dinner." → `dismissAlert: SUCCESS`, correct
   no-reevaluation/no-plan-change disclaimer.
8. Idempotency: repeating the dismiss request found no active alert left to act on (correctly
   excluded once dismissed) rather than erroring or duplicating; two further dashboard reloads
   produced zero duplicate alerts.
9. A final "Qual é o meu Safe-to-Spend agora?" confirmed R$493,01 unchanged by any alert action
   (mark-seen/dismiss never touch financial data).

**One real bug was found and fixed during this validation** (DEC-082): the mark-seen mutation-guard
pattern only matched the brief's own bare example phrasing and rejected a natural real message naming
the alert — fixed with regression tests, re-verified live afterward.

## Known limitations

- **STALE_CONCIERGE_PLAN's relevance window is a heuristic**, not a real completion/cancellation
  status — see "Stale concierge plan alert" above.
- **CONNECTION_NEEDS_ATTENTION's "consecutive failure" count is per-sync-run**, not per-calendar-day —
  two failed syncs seconds apart already counts as "repeated," which is intentional (any repetition is
  real signal) but worth knowing if `syncConnection` is ever called much more frequently in a future
  sprint.
- **No background scheduler** — alert evaluation runs after every sync and on every homepage load,
  exactly as the brief specifies ("Sprint 7 does NOT need production cron infrastructure... architect
  evaluation so a future scheduler can call it"). `evaluateAlerts`/`syncNotificationsForProfile` are
  plain async functions with no HTTP/route coupling, so wiring a future scheduler to call them is
  purely additive.
- **No real push/email provider** — see "External notification provider status" above.
- **Quiet hours currently has no observable effect** — see "Quiet hours" above; correct per the
  brief, but worth knowing this is architecture-only until a real external channel exists.
