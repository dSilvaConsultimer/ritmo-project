import {
  extractIdempotencyKey,
  isHandledWebhookEvent,
  summarizeWebhookPayload,
  type PluggyWebhookPayload,
} from "@money-copilot/open-finance";
import * as repo from "@money-copilot/persistence";
import type { Database } from "@money-copilot/persistence";
import { syncConnection, refetchTransactionsByExternalId } from "./sync";

export type WebhookOutcome = "IGNORED_DUPLICATE" | "IGNORED_UNHANDLED" | "PROCESSED" | "FAILED";

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Idempotent webhook processing: Pluggy's own `eventId` is claimed via a
 * database primary-key insert before any work happens
 * (`claimWebhookEvent`) — a duplicate delivery of the same `eventId`
 * returns `IGNORED_DUPLICATE` without doing anything twice. The webhook
 * payload is only ever used as a TRIGGER to know what changed; the actual
 * data is always re-fetched from the provider via `syncConnection` (never
 * trusted as a complete payload) — see docs/OPEN-FINANCE.md, "Webhooks."
 */
export async function handleWebhookEvent(
  db: Database,
  payload: PluggyWebhookPayload,
  provider = "pluggy",
): Promise<WebhookOutcome> {
  const eventId = extractIdempotencyKey(payload);
  const claim = await repo.claimWebhookEvent(
    db,
    eventId,
    provider,
    payload.event,
    nowIso(),
    summarizeWebhookPayload(payload),
  );
  if (claim === "ALREADY_PROCESSED") return "IGNORED_DUPLICATE";

  if (!isHandledWebhookEvent(payload.event)) {
    await repo.markWebhookEventProcessed(db, eventId, nowIso());
    return "IGNORED_UNHANDLED";
  }

  try {
    await dispatch(db, payload, provider);
    await repo.markWebhookEventProcessed(db, eventId, nowIso());
    return "PROCESSED";
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown webhook processing error";
    await repo.markWebhookEventFailed(db, eventId, nowIso(), message);
    return "FAILED";
  }
}

async function dispatch(db: Database, payload: PluggyWebhookPayload, provider: string): Promise<void> {
  switch (payload.event) {
    case "item/created":
    case "item/updated":
    case "item/login_succeeded":
    case "item/error":
    case "item/waiting_user_input":
    case "item/waiting_user_action": {
      const connection = await repo.findProviderConnectionByExternalId(db, provider, payload.itemId);
      if (!connection) return; // Not a connection we know about yet — nothing to refresh.
      await syncConnection(db, connection.financialProfileId, connection.id);
      return;
    }

    case "item/deleted": {
      const connection = await repo.findProviderConnectionByExternalId(db, provider, payload.itemId);
      if (!connection) return;
      await repo.upsertProviderConnection(db, {
        ...connection,
        status: "DISCONNECTED",
        updatedAt: new Date().toISOString(),
      });
      return;
    }

    case "transactions/created": {
      const connection = await repo.findProviderConnectionByExternalId(db, provider, payload.itemId);
      if (!connection) return;
      // Re-fetch canonical data rather than trust the webhook payload as
      // complete — a full connection sync is the simplest correct way to
      // do that, and is itself idempotent (see sync.ts).
      await syncConnection(db, connection.financialProfileId, connection.id);
      return;
    }

    case "transactions/updated": {
      const connection = await repo.findProviderConnectionByExternalId(db, provider, payload.itemId);
      if (!connection) return;
      // Targeted re-fetch by id, regardless of date — a status change
      // (e.g. PENDING -> POSTED) can land on a transaction older than any
      // incremental date cutoff a routine sync would use. Matches
      // Pluggy's own reference pattern (fetchAllTransactions(accountId,
      // { ids })). See sync.ts, refetchTransactionsByExternalId.
      await refetchTransactionsByExternalId(
        db,
        connection.financialProfileId,
        connection.id,
        payload.accountId,
        payload.transactionIds,
      );
      return;
    }

    case "transactions/deleted": {
      const connection = await repo.findProviderConnectionByExternalId(db, provider, payload.itemId);
      if (!connection) return;
      for (const externalTransactionId of payload.transactionIds) {
        const transaction = await repo.findTransactionByExternalId(
          db,
          connection.financialProfileId,
          provider,
          externalTransactionId,
        );
        if (transaction) {
          await repo.markTransactionReversed(db, transaction.id, new Date().toISOString());
        }
      }
      return;
    }

    default:
      return;
  }
}
