# Money Copilot — Open Finance Integration (Sprint 3)

This document explains how the Pluggy sandbox integration is architected, so a future sprint (or a
future Claude session) doesn't have to re-derive it from the code. It documents **our** architecture
and decisions — for Pluggy's own API reference, see `docs.pluggy.ai`; this file links concepts, it
does not reproduce their documentation.

## Provider abstraction

`packages/open-finance/src/provider.ts` defines `OpenFinanceProvider`:

```ts
createConnectionToken(options) -> { connectToken }
getConnection(externalConnectionId) -> { status, connectorName, error?, ... }
listAccounts(externalConnectionId) -> ExternalAccountInput[]
listTransactions(externalAccountId, { since?, externalTransactionIds? }) -> ExternalTransactionInput[]
listBills(externalAccountId) -> ExternalBillInput[]
syncConnection(externalConnectionId) -> void   // asks the PROVIDER to refresh, not a local import
deleteConnection(externalConnectionId) -> void
```

Two implementations exist: `PluggyProvider` (`packages/open-finance/src/pluggy/`) and `MockProvider`
(`packages/open-finance/src/mock-provider.ts`, fully deterministic, no network — used for tests and
credential-free demos). A future `BelvoProvider` would implement the same interface. **No Pluggy
type ever crosses this interface** — every method returns the canonical DTOs defined in
`@money-copilot/financial-engine` (`ExternalAccountInput`, `ExternalTransactionInput`,
`ExternalBillInput`). See DEC-025.

## Credential handling

`packages/open-finance/src/pluggy/client.ts`, `getPluggyClient()`:

- Reads `PLUGGY_CLIENT_ID`/`PLUGGY_CLIENT_SECRET` from the environment (server-only — never sent to
  the browser). Missing credentials throw `ProviderError("INVALID_CONFIGURATION", ...)` naming only
  the missing variable *names*, never a value.
- Constructs one `PluggyClient` (from the official `pluggy-sdk` npm package) and caches it for the
  process lifetime. The SDK itself caches the API key it obtains from `POST /auth` (a JWT, ~2h
  validity) and only re-authenticates once that JWT is actually expired — reusing one client
  instance is what makes that caching effective across calls; a fresh client per call would defeat
  it. This is the "appropriate API-key caching/refresh behavior" the brief asks for.
- `resetPluggyClientCache()` exists for tests only.

CLIENT_ID/CLIENT_SECRET/API key are never persisted to the database, never logged, and never appear
in a `ProviderError` message body (see DEC-030).

## Connect Token flow

1. Browser clicks "Connect institution" (`apps/web/app/components/ConnectButton.tsx`).
2. It `POST`s to `/api/token` (`apps/web/app/api/token/route.ts`), which calls
   `createConnectToken(db, DEMO_PROFILE_ID, "pluggy", webhookUrl)` — server-side only.
3. That resolves to `PluggyProvider.createConnectionToken({ clientUserId, webhookUrl })`, which calls
   Pluggy's `POST /connect_token` (via `pluggy-sdk`), passing our internal profile id as
   `clientUserId` — a stable, non-sensitive identifier, never a real name/email/document number.
4. The resulting `connectToken` (short-lived, scoped) is the **only** Pluggy-related value that ever
   reaches the browser. The client component opens `react-pluggy-connect`'s `<PluggyConnect>` widget
   with it.
5. On success, the widget's `onSuccess` callback gives the browser an `Item` (with its `id`) — the
   browser `POST`s just that id to `/api/connections`, which calls `completeConnection` server-side.

## Connection lifecycle

`ProviderConnection` (`packages/financial-engine/src/domain/provider.ts`) — generic across providers:
`status: PENDING | CONNECTED | SYNCING | LOGIN_ERROR | USER_ACTION_REQUIRED | ERROR | DISCONNECTED`.
Pluggy's own richer `ItemStatus` is mapped into this vocabulary by `mapPluggyItemStatus`
(`packages/open-finance/src/pluggy/status.ts`) — nothing downstream ever sees a Pluggy-specific
status string.

`completeConnection` (`packages/app-services/src/sync.ts`) is idempotent: it looks up an existing
connection by (profile, provider, externalConnectionId) before creating a new one
(`findProviderConnection`), and the database additionally enforces a unique constraint on that triple
(DEC-023) as a last-resort guarantee.

## Connection recovery (Sprint 4.5)

**`completeConnection`/`onSuccess` is a fast UX path, never the sole mechanism for persisting a
connection.** Pluggy's own documentation states the Connect widget's `onSuccess` callback is not
guaranteed to fire, so business logic and database integrity must not depend exclusively on it — a
live Sprint 4.5 validation attempt independently confirmed this is a real, not just theoretical, risk:
a real sandbox Connect flow was completed, but its `onSuccess` callback never reached this
application, leaving a real Pluggy Item with no corresponding `ProviderConnection`. See DEC-046.

**Discovery mechanism.** Pluggy's REST API (as exposed by the official `pluggy-sdk`, verified by
inspecting its full method list) has no "list Items for a clientUserId" endpoint — recovery therefore
cannot be a proactive poll. It works the other way: `Item.clientUserId` (which this application always
sets to the internal `financialProfileId` at Connect Token creation time — `createConnectToken`'s
`clientUserId` option) is read back via `provider.getConnection(externalConnectionId)` (added to
`ExternalConnectionStatus.clientUserId`, Sprint 4.5) whenever ANY signal surfaces an
`externalConnectionId` this application doesn't yet have a connection for. The authoritative source of
that signal is the **existing webhook architecture** (`item/created`/`item/updated`/`item/
login_succeeded`/`item/error`/`item/waiting_user_*` — see "Webhooks" below): the webhook dispatcher,
on finding no known connection for an incoming `itemId`, now calls `recoverOrphanedConnection`
instead of silently dropping the event.

`recoverOrphanedConnection` (`packages/app-services/src/sync.ts`):

1. Checks `findProviderConnectionByExternalId(provider, externalConnectionId)` first (profile-
   agnostic) — if a connection already exists (from `onSuccess`, a prior recovery, or both), returns
   it immediately without calling the provider again. This is the idempotency guarantee: calling this
   function repeatedly, or having both `onSuccess` and a webhook trigger it, never creates a second
   row.
2. Otherwise calls `provider.getConnection(externalConnectionId)` and reads `clientUserId`. No
   `clientUserId` → cannot recover (`{ recovered: false, reason: "NO_CLIENT_USER_ID" }`).
3. Validates `clientUserId` against a real, known `FinancialProfile` (`repo.getProfileById`) before
   trusting it — never attributes a connection to an unrecognized profile id
   (`{ recovered: false, reason: "UNKNOWN_PROFILE" }`).
4. Delegates to the SAME `completeConnection` function `onSuccess` calls — a recovered Item runs
   through the exact same initial-sync pipeline, never a parallel/duplicated one.

**Local development caveat.** Webhooks cannot reach `localhost` without a public URL
(`NEXT_PUBLIC_APP_URL`) registered at Connect Token creation time — in that configuration (the
default for local dev), the webhook path cannot fire regardless of how well it's implemented, and
`onSuccess` (or a manually-supplied `externalConnectionId` passed directly to
`recoverOrphanedConnection`, e.g. copied from Pluggy's own dashboard) remains the only way to learn
about a new Item at all. This is a genuine, documented constraint of Pluggy's webhook delivery model,
not a gap in this recovery mechanism.

## Connection deletion (Sprint 4.5, DEC-050)

The inverse of recovery: fully removing ONE connection and every piece of local data scoped
exclusively to it, without touching shared/canonical fixture data (nothing in that data is scoped to
a connection). `disconnectConnection` (`packages/app-services/src/sync.ts`), exposed at
`DELETE /api/connections?connectionId=...`:

1. Best-effort deletes the Item on the provider's own side (`provider.deleteConnection`) — never lets
   that failure block local cleanup, since the Item may already be gone/expired there. The outcome
   (`providerDeletionSucceeded`/`providerDeletionError`) is reported, never silently swallowed.
2. Deletes local rows in FK-safe order (children before parents): reconciliation links referencing the
   connection's transactions **on either side** → installment plans referencing its transactions/
   payment sources → bills → transactions → payment sources → sync runs → the connection row itself.

**Cross-connection links are a real scenario, not a hypothetical one.** Two independent live sandbox
connections were found (Sprint 4.5) to have transactions `findTransactionDuplicates` correctly
matched as likely recurring duplicates ACROSS the two connections — entirely ordinary behavior for
that function, unrelated to any bug. Deleting one connection therefore has to remove any link that
references its transactions even when the OTHER side of that link belongs to a connection being kept
— the link itself has nothing left to link once one side is gone. Every delete uses the existing
repository layer (`packages/persistence/src/repositories.ts`'s targeted `DELETE ... WHERE` functions)
— never raw/ad-hoc SQL.

## Sync model

`SyncRun` (`packages/financial-engine/src/domain/provider.ts`): `status: PENDING | RUNNING |
SUCCEEDED | PARTIAL | FAILED`, plus `metrics` (accountsDiscovered, transactionsReceived/Created/
Updated/Reconciled/IgnoredDuplicates, billsReceived) and `errors: string[]` — a `PARTIAL` run always
carries at least one error explaining what didn't complete; nothing is silently swallowed.

`syncConnection` (`packages/app-services/src/sync.ts`) is the full pipeline:

1. Refresh connection status (`provider.getConnection`).
2. `provider.listAccounts` → map to `PaymentSource` (`paymentSourceFromExternalAccount`) → upsert,
   preserving the existing internal id across syncs (`findPaymentSourceByExternalId`).
3. `provider.listTransactions(accountId, { since: lastSuccessfulSyncAt })` → for each: normalize
   merchant (`normalizeMerchant`) → categorize (`categorize`) → upsert, preserving the existing
   internal id if the external id was already imported (`findTransactionByExternalId`) — this is
   what makes an update (e.g. amount correction) land as `transactionsUpdated`, not a duplicate.
4. Installment metadata on a transaction (if any) maps into an `InstallmentPlan` linked via
   `originTransactionId`.
5. For `CREDIT_CARD` accounts: `provider.listBills` → map → upsert `CreditCardBill` rows (never fed
   into snapshot math — see "Credit card bills" below).
6. Reconciliation (`reconcileEventLineItems` + `findTransactionDuplicates`) reruns over the **full**
   profile transaction set every sync, but only persists genuinely new links — a link's exact pair
   key (type + primary + linked) is checked against every existing link first, so repeated syncs
   never create duplicate reconciliation rows for a pair already resolved.
7. Records one `SyncRun` and updates the connection's `lastAttemptedSyncAt`/`lastSuccessfulSyncAt`.

**A provider-side failure never throws out of `syncConnection`** — it's captured into `errors` and
reflected as `PARTIAL`/`FAILED` in the returned `SyncRun` instead.

### Incremental sync: date sweep vs. targeted re-fetch

`syncConnection`'s per-account fetch uses `since: lastSuccessfulSyncAt` — appropriate for
`transactions/created` webhooks and routine incremental syncs. This was found, during this sprint's
own integration testing, to be **wrong** for a `transactions/updated` event: a status change (e.g.
PENDING → POSTED) can land on a transaction whose own `date` predates the sync cutoff, so the
date-filtered sweep silently misses it. `refetchTransactionsByExternalId` handles this instead — a
targeted re-fetch by external transaction id, regardless of date — matching Pluggy's own reference
implementation (`fetchAllTransactions(accountId, { ids })` for update events specifically). See
DEC-027. The webhook dispatcher (`packages/app-services/src/webhook.ts`) routes
`transactions/created` → `syncConnection`, `transactions/updated` → `refetchTransactionsByExternalId`.

## Webhooks

`packages/open-finance/src/pluggy/webhook.ts` defines the handled event subset
(`item/*`, `transactions/created|updated|deleted`) and `extractIdempotencyKey` (Pluggy's own
`eventId`). `packages/app-services/src/webhook.ts`, `handleWebhookEvent`:

1. **Claims** the event id via `claimWebhookEvent` — a single `INSERT ... ON CONFLICT DO NOTHING`
   into `webhook_events` keyed by `id = eventId`. A zero-row result means "already processed" and the
   function returns `IGNORED_DUPLICATE` without doing any work — this IS the entire idempotency
   mechanism, no additional bookkeeping needed.
2. Never trusts the webhook payload as a complete data source — every handled event re-fetches
   canonical data from the provider (see "Incremental sync" above), using the payload only as a
   *trigger* naming what changed (`itemId`, `accountId`, `transactionIds`).
3. Marks the claimed row `PROCESSED` or `FAILED` (with an error message) once done.

**(Sprint 4.5)** For `item/*` events, an unknown `itemId` (no existing `ProviderConnection`) no longer
silently returns — it calls `recoverOrphanedConnection` instead, since this is exactly the situation
that arises when the Connect widget's `onSuccess` callback never fired. See "Connection recovery"
above.

### Webhook security

Pluggy does not document a payload-signature mechanism (verified against their SDK types and docs —
no signature field exists on `WebhookEventPayload`). Per the brief's instruction not to invent an
undocumented mechanism, protection here is an **unguessable shared secret embedded in the webhook
URL itself** (`PLUGGY_WEBHOOK_SECRET`, appended as `?secret=...` when registering the webhook URL —
see `/api/token`), checked by `/api/webhook` before any processing. This is a pragmatic
URL-obscurity control, not a cryptographic signature — documented here so it's never mistaken for
one.

### Local development / manual sync

For local development, the webhook URL must be reachable from the public internet over HTTPS (or
HTTP with `ENABLE_HTTP_WEBHOOK=true`, matching the reference quickstart's own escape hatch). Any
HTTPS tunnel tool works (e.g. `ngrok`, Cloudflare Tunnel, or a cloud deployment's own preview URL) —
no specific paid vendor is required. Independent of webhooks, the "Refresh / sync" button
(`/api/sync`) triggers `syncConnection` directly, so local development never depends entirely on
webhook delivery (DEC-031).

## Accounts / payment sources

`ExternalAccountInput` (`packages/financial-engine/src/domain/external-account.ts`) is the canonical,
provider-agnostic account shape; `mapPluggyAccountToExternalAccountInput`
(`packages/open-finance/src/pluggy/mappers.ts`) maps Pluggy's `Account` (`type: BANK | CREDIT`,
`subtype: CHECKING_ACCOUNT | SAVINGS_ACCOUNT | CREDIT_CARD`) into it. `paymentSourceFromExternalAccount`
then builds/updates a `PaymentSource` (Sprint 3 extends this type in place — see DEC-022 — rather than
introducing a separate `Account` entity, per DEC-009's original reasoning).

## Amount / sign mapping (read this before touching `pluggy/mappers.ts`)

This is the most safety-critical mapping in the integration. Two facts, verified directly against
Pluggy's own docs and SDK source (not assumed):

- Pluggy's `Transaction.type` (`DEBIT` | `CREDIT`) has one documented, generic meaning regardless of
  account type: DEBIT = money going out, CREDIT = money going in.
- Pluggy's `Transaction.amount` **sign convention is documented only for credit cards**, and is the
  opposite of what intuition suggests: a card *purchase* (a charge, increasing what you owe) is
  reported as a **positive** amount; a card *bill payment* (reducing what you owe) is **negative**.
  No sign convention is documented at all for plain `BANK` accounts.

Given that, `mapDirection` (`pluggy/mappers.ts`) derives our `TransactionDirection` **from `type`
alone, never from the sign of `amount`** — this sidesteps the ambiguity entirely rather than trying
to special-case it per account type. `amountCents` is always `Math.abs(amount) * 100`; direction and
`FinancialEffect` carry all the meaning.

`classifyFinancialEffect` (same file) is a small, deterministic, keyword-based heuristic — NOT an
ML/LLM classifier — using account kind + `type` + `creditCardMetadata.feeType` (when Pluggy reports
it) + a short list of description keywords (fee/refund/card-payment/own-account-transfer phrasing in
Portuguese and English). It is intentionally narrow in scope; see "Known provider limitations" below.

| Account kind | Pluggy `type` | Description signal | → `FinancialEffect` |
|---|---|---|---|
| any | either | fee keyword, or `creditCardMetadata.feeType` present | `FEE` |
| CREDIT_CARD | DEBIT | — | `CONSUMPTION` |
| CREDIT_CARD | CREDIT | "PAGAMENTO...FATURA" / "BILL PAYMENT" | `CARD_PAYMENT` |
| CREDIT_CARD | CREDIT | otherwise (default) | `REFUND` |
| BANK | CREDIT | — | `INCOME` |
| BANK | DEBIT | "TRANSFERÊNCIA ENTRE CONTAS" / "TED PRÓPRIA" / "DOC PRÓPRIA" | `TRANSFER` |
| BANK | DEBIT | otherwise (default) | `CONSUMPTION` |

Every row above has a dedicated test in `packages/open-finance/src/pluggy/mappers.test.ts`.

## Pending → posted

Pluggy's `Transaction.status` (`PENDING` | `POSTED`, defaulting to `POSTED`) maps 1:1 to our
`TransactionStatus`. The same real-world movement reported first as `PENDING` then later as `POSTED`
is the same `externalTransactionId` — `findTransactionByExternalId` finds the existing row and
updates it in place (see "Incremental sync" above for how the update is actually triggered).

## Credit card bills

`ExternalBillInput`/`CreditCardBill` (`packages/financial-engine/src/domain/bill.ts`) represent a
credit card's payment cycle (due date, closing date, total owed, minimum payment) — mapped from
Pluggy's `CreditCardBills` via `mapPluggyBillToExternalBillInput`. **A bill is never fed into
`FinancialSnapshot`'s committed totals** — `FinancialSnapshotInput` has no `bills` field at all, so
there is no code path for a bill total to be summed alongside its own underlying transactions (which
are already individually represented as `CONSUMPTION`). This is structural, not just convention —
see `domain/bill.test.ts`.

## Installments

`ExternalTransactionInput.installmentMetadata` (`installmentNumber`, `totalInstallments`,
`totalAmountCents`, `externalBillId`) maps directly from Pluggy's `creditCardMetadata` when present.
`syncConnection` creates/updates an `InstallmentPlan` linked via `originTransactionId` whenever this
metadata exists. When Pluggy doesn't report it (as with the founder's existing ~BRL 1,400/month old
debt, which predates this integration and has no known installment count), the plan's
`installmentNumber`/`totalInstallments` stay `null` — never guessed.

### Old-debt reconciliation

`matchInstallmentPlans` (Sprint 2, `financial-engine/domain/installment.ts`) compares the manual
estimate against any provider-derived plan: HIGH confidence needs a shared `paymentSourceId` and
amounts within 5%; MEDIUM is amounts within 15% alone. **Every match is a `CANDIDATE` — none are ever
auto-applied**, regardless of confidence (DEC-032). `getInstallmentPlanMatchCandidates`
(`app-services/src/sync.ts`) surfaces them; nothing currently acts on them automatically.

## Manual + provider reconciliation (deduplication)

Reuses Sprint 2's `matchTransactions`/`findTransactionDuplicates` unchanged: provider external-id
match → HIGH; exact fingerprint (amount + direction + payment-source-type + merchant + same date) →
HIGH; same fingerprint within a 3-day date tolerance → MEDIUM; otherwise LOW/none. HIGH/MEDIUM
auto-`CONFIRM`; LOW becomes a `CANDIDATE` for human review — never silently merged. The rodeo-ticket
regression scenario (a manual transaction later "rediscovered" by a provider sync) is covered by
`app-services/src/sync.test.ts`.

## Liquidity coverage

`FinancialPosition.coverage: COMPLETE | PARTIAL | UNKNOWN`
(`financial-engine/domain/position.ts`, `buildFinancialPositionFromAccounts`) — see DEC-028. Only
provider-synced payment sources (`provider` field set) count toward this; a manual,
categorization-only payment source is excluded, so a profile with zero real connections correctly
reports `UNKNOWN`, not `PARTIAL`.

## Error handling

`ProviderError` (`financial-engine/domain/provider.ts`): `code` is one of
`AUTHENTICATION_ERROR | USER_ACTION_REQUIRED | PROVIDER_UNAVAILABLE | RATE_LIMITED |
INVALID_CONFIGURATION | SYNC_CONFLICT | NETWORK_ERROR | UNKNOWN_PROVIDER_ERROR`, plus `retryable:
boolean`. `normalizePluggyError` (`open-finance/pluggy/errors.ts`) maps whatever the SDK rejects with
(an HTTP status + message, or a bare network error) into this taxonomy — a best-effort mapping that
could not be validated against real Pluggy error responses in this sprint (no sandbox access). No
raw SDK error type ever escapes `PluggyProvider`'s public methods.

## Sandbox fixtures

`packages/open-finance/src/pluggy/fixtures/index.ts` — sanitized, entirely synthetic Pluggy-shaped
objects (bank account, credit card, plain/fee/refund/payment/pending/posted/installment
transactions, a credit card bill, an Item, and item/transactions webhook payloads). None of this is
real user data (NON-NEGOTIABLE, Sprint 3).

## Known provider limitations

- The amount-sign/effect classification table above was built from Pluggy's public documentation and
  SDK source, and (Sprint 4.5) has now been exercised against real sandbox transaction data for the
  first time — several CREDIT-direction credit-card transactions were classified `REFUND`, which is
  plausible but has not been manually cross-checked against Pluggy's own documented intent for those
  specific sandbox fixtures. Still not a formally verified mapping. Real Pluggy sandbox data may
  surface description patterns the current keyword lists don't recognize; when that happens, extend
  `FEE_KEYWORDS`/`REFUND_KEYWORDS`/`CARD_PAYMENT_KEYWORDS`/`OWN_ACCOUNT_TRANSFER_KEYWORDS` in
  `pluggy/mappers.ts` rather than adding a parallel heuristic.
- `normalizePluggyError`'s HTTP-status-to-`ProviderErrorCode` mapping is similarly unverified against
  real Pluggy error responses.
- `reconciliation_links` has no `financialProfileId` column (a Sprint 2 schema gap) — reconciliation
  currently operates globally across all profiles. Harmless with today's single demo profile; would
  need a migration before real multi-profile support.
- No automatic/scheduled sync exists (see DEC-031) — staleness is only resolved by a webhook or a
  manual "Refresh / sync" click.
- **Sprint 4**: live Pluggy sandbox validation was not executed (no credentials available in that
  environment). Sprint 4's AI copilot layer (`docs/AI-COPILOT.md`) does not touch this package at
  all — it reads through `@money-copilot/app-services`'s existing query functions, which already sit
  on top of whichever provider (`MockProvider` today) is registered, so nothing here needs to change
  once real sandbox credentials arrive.
- **Sprint 4.5 — first attempt (partial)**: with real `PLUGGY_CLIENT_ID`/`PLUGGY_CLIENT_SECRET`
  configured, live authentication and Connect Token creation both succeeded (`POST /api/token` → a
  real Pluggy sandbox `accessToken`, verified via an HTTP 200 from the running app). The interactive
  Connect widget step did not result in a persisted `provider_connections` row on this app's side —
  the dev server's request log showed no `POST /api/connections` call reaching it. This directly
  motivated the connection-recovery hardening (DEC-046, "Connection recovery" above) before retrying.
- **Sprint 4.5 — second attempt (COMPLETE)**: a fresh sandbox Connect succeeded end to end: a real
  `ProviderConnection` (`connectorName: "Pluggy Bank"`, a sandbox/test institution) was persisted,
  status `CONNECTED`; 2 real accounts were imported (a checking account and a credit card); multiple
  real transactions were imported and correctly deduplicated by `externalTransactionId` across repeat
  syncs; 2 real credit card bills were imported (initially duplicated on repeat sync — a real,
  separate bug, fixed — see DEC-048 below); `FinancialPosition` liquidity coverage changed from
  `UNKNOWN` to `PARTIAL`; the dashboard's Safe-to-Spend recalculated to include the real data and its
  banner correctly switched from "DEMO / FIXTURE DATA" to "PROVIDER DATA CONNECTED (SANDBOX)". The
  amount-sign/effect mapping table was exercised against real sandbox data for the first time: several
  CREDIT-direction credit-card transactions (Netflix, Spotify, a gym subscription) were classified
  `REFUND` — plausible, but not manually cross-checked against Pluggy's own documented intent for
  those specific sandbox fixtures. No credit-card-bill-payment transaction happened to be present in
  this dataset, so the `CARD_PAYMENT` classification path specifically remains validated only against
  fixtures/mocks, not real data.
- **DEC-048 (bill deduplication)**: `billFromExternalInput` always generated a fresh id — unlike
  transactions and payment sources, nothing looked up an existing bill by `(provider, externalBillId)`
  first, so every repeat sync of the same connection created a NEW row for the same real external
  bill. Fixed by adding `findBillByExternalId` and giving `billFromExternalInput` an optional `id`
  parameter to reuse, matching the existing pattern. Never affected `FinancialSnapshot` math (bills
  are never summed into it — see "Credit card bills" above) — a persistence/observability bug, not a
  double-counting one.
