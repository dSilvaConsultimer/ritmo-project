import { createId, type Id } from "@money-copilot/shared";
import {
  draftTransactionFromExternalInput,
  paymentSourceFromExternalAccount,
  billFromExternalInput,
  normalizeMerchant,
  categorize,
  findTransactionDuplicates,
  reconcileEventLineItems,
  reconciliationLinkPairKey,
  matchInstallmentPlans,
  ProviderError,
  EMPTY_SYNC_RUN_METRICS,
  fromCents,
  type FinancialTransaction,
  type FinancialEvent,
  type ProviderConnection,
  type SyncRun,
  type SyncRunStatus,
  type InstallmentPlan,
  type InstallmentPlanMatchCandidate,
  type CategoryRule,
  type MerchantNormalizationRule,
  type PaymentSource,
  type ExternalTransactionInput,
} from "@money-copilot/financial-engine";
import type { ConnectionTokenResult, OpenFinanceProvider } from "@money-copilot/open-finance";
import * as repo from "@money-copilot/persistence";
import type { Database } from "@money-copilot/persistence";
import { getProvider, type ProviderName } from "./provider-registry";
import { evaluateRecommendations, evaluateRecommendationVerifications } from "./recommendation-service";
import { evaluateAlerts } from "./alerts";
import { syncNotificationsForProfile } from "./notifications";

function nowIso(): string {
  return new Date().toISOString();
}

export async function createConnectToken(
  db: Database,
  financialProfileId: string,
  providerName: ProviderName,
  webhookUrl?: string,
): Promise<ConnectionTokenResult> {
  void db;
  const provider = getProvider(providerName);
  return provider.createConnectionToken({
    clientUserId: financialProfileId,
    ...(webhookUrl ? { webhookUrl } : {}),
  });
}

/**
 * Persists (or reuses) a `ProviderConnection` for a successfully-created
 * Item, then runs the initial sync. Idempotent: a second call for the same
 * (profile, provider, externalConnectionId) reuses the existing connection
 * row instead of creating a duplicate — see RULE (Sprint 3): "avoid
 * duplicate provider connections where possible."
 */
export async function completeConnection(
  db: Database,
  financialProfileId: string,
  providerName: ProviderName,
  externalConnectionId: string,
): Promise<{ connection: ProviderConnection; syncRun: SyncRun }> {
  const existing = await repo.findProviderConnection(
    db,
    financialProfileId,
    providerName,
    externalConnectionId,
  );

  const connection: ProviderConnection = existing ?? {
    id: createId("provider-connection"),
    financialProfileId: financialProfileId as Id<"financial-profile">,
    provider: providerName,
    externalConnectionId,
    status: "PENDING",
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  await repo.upsertProviderConnection(db, connection);

  const syncRun = await syncConnection(db, financialProfileId, connection.id);
  return { connection, syncRun };
}

export type RecoveryOutcome =
  | { readonly recovered: true; readonly alreadyExisted: true; readonly connection: ProviderConnection }
  | {
      readonly recovered: true;
      readonly alreadyExisted: false;
      readonly connection: ProviderConnection;
      readonly syncRun: SyncRun;
    }
  | { readonly recovered: false; readonly reason: "NO_CLIENT_USER_ID" | "UNKNOWN_PROFILE" };

/**
 * Deterministically discovers and persists a `ProviderConnection` for a
 * Pluggy Item this application does not yet know about — the hardening
 * this sprint's live validation exposed the need for (Sprint 4.5, DEC-046):
 * Pluggy's own docs say the Connect widget's `onSuccess` callback is not
 * guaranteed to fire, so it must never be the ONLY path by which a
 * connection is discovered and persisted.
 *
 * Never trusts the caller's claim about which profile owns this
 * `externalConnectionId` — it always asks the provider for the Item's own
 * `clientUserId` (which Pluggy always reports, and which this application
 * always sets to the internal `financialProfileId` at Connect Token
 * creation time — see `createConnectToken`) and validates that it matches
 * a real, known `FinancialProfile` before persisting anything.
 *
 * Idempotent: if a connection already exists for this
 * (provider, externalConnectionId) — whether created by `onSuccess`, a
 * prior recovery, or both — this returns it without re-deriving anything
 * or duplicating a row (requirement: "never duplicate ProviderConnection,
 * accounts, transactions, or consumption when both onSuccess and
 * webhook/recovery occur").
 *
 * A newly recovered Item runs through the EXACT SAME `completeConnection`
 * → `syncConnection` pipeline `onSuccess` uses — there is no parallel/
 * duplicated import logic to keep in sync.
 */
export async function recoverOrphanedConnection(
  db: Database,
  providerName: ProviderName,
  externalConnectionId: string,
): Promise<RecoveryOutcome> {
  const existing = await repo.findProviderConnectionByExternalId(db, providerName, externalConnectionId);
  if (existing) {
    return { recovered: true, alreadyExisted: true, connection: existing };
  }

  const provider = getProvider(providerName);
  const status = await provider.getConnection(externalConnectionId);
  if (!status.clientUserId) {
    return { recovered: false, reason: "NO_CLIENT_USER_ID" };
  }

  const profile = await repo.getProfileById(db, status.clientUserId);
  if (!profile) {
    return { recovered: false, reason: "UNKNOWN_PROFILE" };
  }

  const { connection, syncRun } = await completeConnection(db, profile.id, providerName, externalConnectionId);
  return { recovered: true, alreadyExisted: false, connection, syncRun };
}

interface MutableMetrics {
  accountsDiscovered: number;
  transactionsReceived: number;
  transactionsCreated: number;
  transactionsUpdated: number;
  transactionsReconciled: number;
  transactionsIgnoredDuplicates: number;
  billsReceived: number;
}

/**
 * Normalizes, categorizes, and upserts one batch of already-fetched
 * external transactions for one account — the piece of the pipeline
 * shared between a full incremental sweep (`syncConnection`, date-
 * filtered) and a targeted re-fetch by id (`refetchTransactionsByExternalId`,
 * used when a `transactions/updated` webhook reports a status change like
 * PENDING -> POSTED on a transaction outside the date window a routine
 * sweep would re-check). Never bypasses normalization/categorization —
 * see NON-NEGOTIABLE, Sprint 3.
 */
async function importTransactionBatch(
  db: Database,
  financialProfileId: string,
  paymentSource: PaymentSource,
  externalTransactions: readonly ExternalTransactionInput[],
  categoryRules: readonly CategoryRule[],
  merchantRules: readonly MerchantNormalizationRule[],
  metrics: MutableMetrics,
): Promise<void> {
  for (const input of externalTransactions) {
    const existingTx = await repo.findTransactionByExternalId(
      db,
      financialProfileId,
      input.provider,
      input.externalTransactionId,
    );

    const draft = draftTransactionFromExternalInput(
      input,
      financialProfileId as Id<"financial-profile">,
      paymentSource,
      nowIso(),
    );
    const normalizedMerchant = draft.rawMerchant
      ? normalizeMerchant(draft.rawMerchant, merchantRules)
      : undefined;
    const withNormalization: FinancialTransaction = {
      ...draft,
      ...(normalizedMerchant ? { normalizedMerchant } : {}),
    };
    const { category, subcategory } = categorize(withNormalization, categoryRules);
    const finalTransaction: FinancialTransaction = {
      ...withNormalization,
      category,
      ...(subcategory !== undefined ? { subcategory } : {}),
      ...(existingTx ? { id: existingTx.id, createdAt: existingTx.createdAt } : {}),
    };

    await repo.upsertTransaction(db, finalTransaction);
    if (existingTx) {
      metrics.transactionsUpdated += 1;
    } else {
      metrics.transactionsCreated += 1;
    }

    if (input.installmentMetadata) {
      const existingPlan = await repo.findInstallmentPlanByOriginTransactionId(db, finalTransaction.id);
      const plan: InstallmentPlan = {
        id: existingPlan?.id ?? createId("installment-plan"),
        financialProfileId: financialProfileId as Id<"financial-profile">,
        description: finalTransaction.rawDescription,
        originTransactionId: finalTransaction.id,
        paymentSourceId: paymentSource.id,
        totalOriginalAmount: input.installmentMetadata.totalAmountCents
          ? fromCents(input.installmentMetadata.totalAmountCents)
          : null,
        installmentAmount: finalTransaction.amount,
        installmentNumber: input.installmentMetadata.installmentNumber ?? null,
        totalInstallments: input.installmentMetadata.totalInstallments ?? null,
        firstDueDate: null,
        certainty: "ACTUAL",
        status: "ACTIVE",
      } as InstallmentPlan;
      await repo.upsertInstallmentPlan(db, plan);
    }
  }
}

/** Re-runs reconciliation over the full profile transaction set, persisting only genuinely new links. */
async function reconcileProfile(
  db: Database,
  financialProfileId: string,
  asOfDate: string,
  metrics: MutableMetrics,
): Promise<void> {
  const profileData = await repo.loadFinancialSnapshotInput(db, financialProfileId, asOfDate);
  const allTransactions = profileData.transactions;
  const events: readonly FinancialEvent[] = profileData.events;
  const existingLinks = await repo.listAllReconciliationLinks(db);
  const existingKeys = new Set(existingLinks.map(reconciliationLinkPairKey));

  const candidateLinks = [
    ...reconcileEventLineItems(events, allTransactions),
    ...findTransactionDuplicates(allTransactions),
  ];
  const newLinks = candidateLinks.filter((link) => !existingKeys.has(reconciliationLinkPairKey(link)));

  for (const link of newLinks) {
    await repo.upsertReconciliationLink(db, link);
    if (link.status === "CONFIRMED") {
      metrics.transactionsReconciled += 1;
      metrics.transactionsIgnoredDuplicates += 1;
    }
  }
}

/**
 * The full connect→sync→snapshot pipeline for one connection: refresh
 * status, import accounts/transactions/bills through the SAME
 * normalization → categorization → reconciliation pipeline manual/Sprint 2
 * data uses (never bypassed — see NON-NEGOTIABLE, Sprint 3), and record an
 * observable `SyncRun`. Never throws past this function for a
 * provider-side failure — a `FAILED`/`PARTIAL` `SyncRun` is the reported
 * outcome instead (see docs/OPEN-FINANCE.md, "Sync model").
 *
 * Uses a date-filtered sweep (`since: lastSuccessfulSyncAt`) per account —
 * appropriate for routine/scheduled syncs and for `transactions/created`
 * webhooks, but NOT for catching a status change (e.g. PENDING -> POSTED)
 * on an older transaction a `transactions/updated` webhook reports; that
 * case uses `refetchTransactionsByExternalId` instead, which targets
 * specific ids regardless of date — matching Pluggy's own reference
 * pattern (`fetchAllTransactions(accountId, { ids })`).
 */
export async function syncConnection(
  db: Database,
  financialProfileId: string,
  connectionId: string,
): Promise<SyncRun> {
  const connection = await repo.getProviderConnectionById(db, connectionId);
  if (!connection) {
    throw new Error(`No provider connection ${connectionId}`);
  }

  const startedAt = nowIso();
  const metrics: MutableMetrics = { ...EMPTY_SYNC_RUN_METRICS };
  const errors: string[] = [];
  const provider = getProvider(connection.provider as ProviderName);

  await repo.upsertProviderConnection(db, { ...connection, lastAttemptedSyncAt: startedAt });

  let anySucceeded = false;
  let connectionStatusUpdate: Partial<ProviderConnection> = {};

  try {
    const status = await provider.getConnection(connection.externalConnectionId);
    connectionStatusUpdate = {
      status: status.status,
      ...(status.connectorId ? { connectorId: status.connectorId } : {}),
      ...(status.connectorName ? { connectorName: status.connectorName } : {}),
      ...(status.errorCode ? { errorCode: status.errorCode } : {}),
      ...(status.errorMessage ? { errorMessage: status.errorMessage } : {}),
      ...(status.consentExpiresAt ? { consentExpiresAt: status.consentExpiresAt } : {}),
    };

    const accounts = await provider.listAccounts(connection.externalConnectionId);
    const { categoryRules, merchantRules } = await repo.loadRules(db);

    for (const account of accounts) {
      try {
        const existingSource = await repo.findPaymentSourceByExternalId(
          db,
          financialProfileId,
          connection.provider,
          account.externalAccountId,
        );
        const paymentSource = paymentSourceFromExternalAccount(account, connection.id, existingSource?.id);
        await repo.upsertPaymentSource(db, paymentSource, financialProfileId);
        metrics.accountsDiscovered += 1;

        const externalTransactions = await provider.listTransactions(account.externalAccountId, {
          ...(connection.lastSuccessfulSyncAt ? { since: connection.lastSuccessfulSyncAt } : {}),
        });
        metrics.transactionsReceived += externalTransactions.length;
        await importTransactionBatch(
          db,
          financialProfileId,
          paymentSource,
          externalTransactions,
          categoryRules,
          merchantRules,
          metrics,
        );

        if (account.kind === "CREDIT_CARD") {
          const bills = await provider.listBills(account.externalAccountId);
          metrics.billsReceived += bills.length;
          for (const billInput of bills) {
            const existingBill = await repo.findBillByExternalId(
              db,
              connection.provider,
              billInput.externalBillId,
            );
            const bill = billFromExternalInput(
              billInput,
              financialProfileId as Id<"financial-profile">,
              paymentSource.id,
              nowIso(),
              existingBill?.id,
            );
            await repo.upsertBill(db, {
              ...bill,
              ...(existingBill ? { createdAt: existingBill.createdAt } : {}),
            });
          }
        }

        anySucceeded = true;
      } catch (accountError) {
        const normalized = normalizeSyncError(accountError);
        errors.push(`Account ${account.externalAccountId}: ${normalized.message}`);
      }
    }

    await reconcileProfile(db, financialProfileId, startedAt.slice(0, 10), metrics);
  } catch (topLevelError) {
    const normalized = normalizeSyncError(topLevelError);
    errors.push(normalized.message);
  }

  // Sprint 5 (DEC-060): a successful sync is also an opportunity to
  // discover new recommendation candidates and check whether any
  // ACCEPTED/MODIFIED recommendation's expected change can now be
  // verified. Deliberately isolated in its own try/catch — a problem here
  // must never fail the sync itself (the imported financial data is the
  // important, already-committed result). Both functions are idempotent by
  // construction (identityKey matching; VERIFIED/FAILED are terminal), so
  // repeated syncs never duplicate or re-transition anything.
  if (anySucceeded) {
    try {
      const asOfDate = startedAt.slice(0, 10);
      await evaluateRecommendations(db, financialProfileId, asOfDate);
      await evaluateRecommendationVerifications(db, financialProfileId, asOfDate);
    } catch {
      // Never fails the sync — recommendation evaluation is best-effort here.
    }
  }

  const finishedAt = nowIso();
  const status: SyncRunStatus =
    !anySucceeded && errors.length > 0 ? "FAILED" : errors.length > 0 ? "PARTIAL" : "SUCCEEDED";

  const syncRun: SyncRun = {
    id: createId("sync-run"),
    connectionId: connection.id,
    status,
    startedAt,
    finishedAt,
    metrics,
    errors,
  };
  await repo.upsertSyncRun(db, syncRun);

  await repo.upsertProviderConnection(db, {
    ...connection,
    ...connectionStatusUpdate,
    lastAttemptedSyncAt: startedAt,
    ...(status !== "FAILED" ? { lastSuccessfulSyncAt: finishedAt } : {}),
    updatedAt: finishedAt,
  });

  // Sprint 7: alert evaluation runs regardless of whether THIS sync
  // succeeded — a FAILED/PARTIAL sync is exactly when a connection-health
  // alert most needs to fire. Deliberately isolated in its own try/catch,
  // AFTER the connection row's final status update above, so
  // `evaluateConnectionAttention` sees this sync's real outcome. Never
  // fails the sync itself — see docs/ALERTS-NOTIFICATIONS.md, "Alert
  // evaluation orchestration."
  try {
    await evaluateAlerts(db, financialProfileId, finishedAt.slice(0, 10));
    await syncNotificationsForProfile(db, financialProfileId);
  } catch {
    // Never fails the sync — alert evaluation/notification delivery is best-effort here.
  }

  return syncRun;
}

/**
 * Targeted re-fetch of specific transaction ids on one account, regardless
 * of date — this is what a `transactions/updated` webhook should trigger
 * (per Pluggy's own reference pattern), since the transaction being
 * updated (e.g. PENDING -> POSTED) may be older than any reasonable
 * incremental date cutoff. Runs the same normalize/categorize/upsert path
 * as `syncConnection`, then re-reconciles the profile.
 */
export async function refetchTransactionsByExternalId(
  db: Database,
  financialProfileId: string,
  connectionId: string,
  externalAccountId: string,
  externalTransactionIds: readonly string[],
): Promise<void> {
  const connection = await repo.getProviderConnectionById(db, connectionId);
  if (!connection) throw new Error(`No provider connection ${connectionId}`);

  const provider: OpenFinanceProvider = getProvider(connection.provider as ProviderName);
  const existingSource = await repo.findPaymentSourceByExternalId(
    db,
    financialProfileId,
    connection.provider,
    externalAccountId,
  );
  if (!existingSource) return; // Nothing to attach these transactions to yet — a full sync will pick them up.

  const externalTransactions = await provider.listTransactions(externalAccountId, {
    externalTransactionIds,
  });
  const { categoryRules, merchantRules } = await repo.loadRules(db);
  const metrics: MutableMetrics = { ...EMPTY_SYNC_RUN_METRICS };
  await importTransactionBatch(
    db,
    financialProfileId,
    existingSource,
    externalTransactions,
    categoryRules,
    merchantRules,
    metrics,
  );
  await reconcileProfile(db, financialProfileId, nowIso().slice(0, 10), metrics);
}

function normalizeSyncError(error: unknown): { message: string } {
  if (error instanceof ProviderError) {
    return { message: `${error.code}: ${error.message}` };
  }
  if (error instanceof Error) return { message: error.message };
  return { message: "Unknown sync error" };
}

/**
 * Computes possible matches between manually-entered installment plans
 * (no `originTransactionId`) and provider-derived ones — e.g. the
 * founder's ~BRL 1,400/month manual estimate vs. a real Pluggy-derived
 * schedule. NEVER auto-applied; always returned as candidates for human
 * review. See `domain/installment.ts`, `matchInstallmentPlans`.
 */
export async function getInstallmentPlanMatchCandidates(
  db: Database,
  financialProfileId: string,
  asOfDate: string,
): Promise<InstallmentPlanMatchCandidate[]> {
  const plans = await repo.listInstallmentPlansForProfile(db, financialProfileId);
  const manual = plans.filter((p) => !p.originTransactionId);
  const providerDerived = plans.filter((p) => p.originTransactionId);

  const candidates: InstallmentPlanMatchCandidate[] = [];
  for (const m of manual) {
    for (const p of providerDerived) {
      const match = matchInstallmentPlans(m, p, asOfDate);
      if (match) candidates.push(match);
    }
  }
  return candidates;
}

export interface DisconnectConnectionResult {
  readonly connectionId: string;
  readonly externalConnectionId: string;
  readonly providerDeletionAttempted: boolean;
  readonly providerDeletionSucceeded: boolean;
  readonly providerDeletionError?: string;
  readonly deletedPaymentSourceCount: number;
  readonly deletedTransactionCount: number;
  readonly deletedBillCount: number;
  readonly deletedInstallmentPlanCount: number;
  readonly deletedReconciliationLinkCount: number;
  readonly deletedSyncRunCount: number;
}

/**
 * Fully removes ONE connection and every piece of local data that belongs
 * EXCLUSIVELY to it — never shared/canonical fixture data, since nothing
 * here is scoped to a connection in the first place. Uses the application's
 * existing repository layer throughout (never raw/ad-hoc SQL). See
 * docs/OPEN-FINANCE.md, "Connection deletion," DEC-050.
 *
 * Order matters (FK-safe, children before parents): reconciliation links
 * referencing this connection's transactions (on EITHER side — a
 * cross-connection link where the other side belongs to a connection being
 * KEPT is still deleted, since the link itself no longer has anything to
 * link) -> installment plans referencing its transactions/payment sources
 * (a provider-derived plan, e.g. from Pluggy's `installmentMetadata`) ->
 * bills -> transactions -> payment sources -> sync runs -> the connection
 * row itself.
 *
 * Best-effort on the PROVIDER side: attempts `provider.deleteConnection`
 * (removes the Item on Pluggy's own side) but never lets that failure
 * block local cleanup — the Item may already be gone/expired there, and
 * this application's own data should not become stuck because of it. The
 * outcome is reported, never silently swallowed.
 */
export async function disconnectConnection(
  db: Database,
  connectionId: string,
): Promise<DisconnectConnectionResult> {
  const connection = await repo.getProviderConnectionById(db, connectionId);
  if (!connection) {
    throw new Error(`No provider connection ${connectionId}`);
  }

  let providerDeletionSucceeded = false;
  let providerDeletionError: string | undefined;
  try {
    const provider = getProvider(connection.provider as ProviderName);
    await provider.deleteConnection(connection.externalConnectionId);
    providerDeletionSucceeded = true;
  } catch (error) {
    const normalized = normalizeSyncError(error);
    providerDeletionError = normalized.message;
  }

  const paymentSourceIds = await repo.listPaymentSourceIdsByConnectionId(db, connectionId);
  const transactionIds = await repo.listTransactionIdsByPaymentSourceIds(db, paymentSourceIds);

  const deletedReconciliationLinkCount = await repo.deleteReconciliationLinksReferencingTransactionIds(
    db,
    transactionIds,
  );
  const deletedInstallmentPlanCount = await repo.deleteInstallmentPlansReferencing(
    db,
    transactionIds,
    paymentSourceIds,
  );
  const deletedBillCount = await repo.deleteBillsByPaymentSourceIds(db, paymentSourceIds);
  const deletedTransactionCount = await repo.deleteTransactionsByIds(db, transactionIds);
  const deletedPaymentSourceCount = await repo.deletePaymentSourcesByIds(db, paymentSourceIds);
  const deletedSyncRunCount = await repo.deleteSyncRunsByConnectionId(db, connectionId);
  await repo.deleteProviderConnectionById(db, connectionId);

  return {
    connectionId,
    externalConnectionId: connection.externalConnectionId,
    providerDeletionAttempted: true,
    providerDeletionSucceeded,
    ...(providerDeletionError ? { providerDeletionError } : {}),
    deletedPaymentSourceCount,
    deletedTransactionCount,
    deletedBillCount,
    deletedInstallmentPlanCount,
    deletedReconciliationLinkCount,
    deletedSyncRunCount,
  };
}
