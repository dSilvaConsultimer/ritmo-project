import { createId, type Id } from "@money-copilot/shared";
import {
  draftTransactionFromExternalInput,
  paymentSourceFromExternalAccount,
  billFromExternalInput,
  normalizeMerchant,
  categorize,
  findTransactionDuplicates,
  reconcileEventLineItems,
  matchInstallmentPlans,
  ProviderError,
  EMPTY_SYNC_RUN_METRICS,
  fromCents,
  type FinancialTransaction,
  type FinancialEvent,
  type ReconciliationLink,
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

interface MutableMetrics {
  accountsDiscovered: number;
  transactionsReceived: number;
  transactionsCreated: number;
  transactionsUpdated: number;
  transactionsReconciled: number;
  transactionsIgnoredDuplicates: number;
  billsReceived: number;
}

function linkPairKey(link: ReconciliationLink): string {
  return `${link.type}:${link.primaryTransactionId}:${link.linkedTransactionId ?? link.linkedEventLineItemId ?? ""}`;
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
  const existingKeys = new Set(existingLinks.map(linkPairKey));

  const candidateLinks = [
    ...reconcileEventLineItems(events, allTransactions),
    ...findTransactionDuplicates(allTransactions),
  ];
  const newLinks = candidateLinks.filter((link) => !existingKeys.has(linkPairKey(link)));

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
            const bill = billFromExternalInput(
              billInput,
              financialProfileId as Id<"financial-profile">,
              paymentSource.id,
              nowIso(),
            );
            await repo.upsertBill(db, bill);
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
