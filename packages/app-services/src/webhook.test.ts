import { afterEach, describe, expect, it } from "vitest";
import { fixtureProfile } from "@money-copilot/financial-engine";
import type { ExternalAccountInput, ExternalTransactionInput } from "@money-copilot/financial-engine";
import * as repo from "@money-copilot/persistence";
import { createId } from "@money-copilot/shared";
import { handleWebhookEvent } from "./webhook";
import { getTransactions } from "./queries";
import { resetProviderRegistry } from "./provider-registry";
import { freshSeededDb, installMockProvider } from "./test-helpers";

afterEach(() => {
  resetProviderRegistry();
});

const mockAccount: ExternalAccountInput = {
  provider: "mock",
  externalAccountId: "mock-webhook-account-1",
  connectionExternalId: "mock-webhook-conn-1",
  kind: "BANK",
  displayName: "Mock Checking",
  currency: "BRL",
  balanceCents: 50_000,
  balanceCertainty: "ACTUAL",
  lastSyncedAt: "2026-09-05T00:00:00.000Z",
};

async function setUpConnection(db: Awaited<ReturnType<typeof freshSeededDb>>) {
  const connection = {
    id: createId("provider-connection"),
    financialProfileId: fixtureProfile.id,
    provider: "mock" as const,
    externalConnectionId: mockAccount.connectionExternalId,
    status: "PENDING" as const,
    createdAt: "2026-09-05",
    updatedAt: "2026-09-05",
  };
  await repo.upsertProviderConnection(db, connection);
  return connection;
}

describe("handleWebhookEvent — idempotency", () => {
  it("processes a fresh eventId once, and ignores a duplicate delivery of the same eventId", async () => {
    const db = await freshSeededDb();
    installMockProvider({ accounts: [mockAccount], transactionsByAccount: new Map() });
    const connection = await setUpConnection(db);

    const payload = {
      id: connection.externalConnectionId,
      eventId: "webhook-event-1",
      event: "item/updated" as const,
      itemId: connection.externalConnectionId,
    };

    const first = await handleWebhookEvent(db, payload, "mock");
    expect(first).toBe("PROCESSED");

    const second = await handleWebhookEvent(db, payload, "mock");
    expect(second).toBe("IGNORED_DUPLICATE");
  });

  it("ignores webhook events outside Sprint 3's handled scope without erroring", async () => {
    const db = await freshSeededDb();
    const payload = {
      id: "irrelevant",
      eventId: "webhook-event-out-of-scope",
      event: "payment_intent/created" as const,
      paymentIntentId: "pi-1",
      paymentRequestId: "pr-1",
    };
    const outcome = await handleWebhookEvent(db, payload, "mock");
    expect(outcome).toBe("IGNORED_UNHANDLED");
  });
});

describe("handleWebhookEvent — transactions/created triggers a re-fetch, never trusts the payload alone", () => {
  it("imports the newly-available transaction by re-syncing the connection", async () => {
    const db = await freshSeededDb();
    const newTransaction: ExternalTransactionInput = {
      provider: "mock",
      externalTransactionId: "mock-tx-webhook-1",
      paymentSourceExternalRef: mockAccount.externalAccountId,
      amountCents: 3_000,
      direction: "DEBIT",
      financialEffect: "CONSUMPTION",
      certainty: "ACTUAL",
      date: "2026-09-04",
      rawDescription: "MERCADO MOCK",
      rawMerchant: "MERCADO MOCK",
      status: "POSTED",
    };
    installMockProvider({
      accounts: [mockAccount],
      transactionsByAccount: new Map([[mockAccount.externalAccountId, [newTransaction]]]),
    });
    const connection = await setUpConnection(db);

    const payload = {
      id: mockAccount.externalAccountId,
      eventId: "webhook-event-tx-created-1",
      event: "transactions/created" as const,
      itemId: connection.externalConnectionId,
      accountId: mockAccount.externalAccountId,
      transactionsCreatedAtFrom: "2026-09-04T00:00:00.000Z",
      createdTransactionsLink: "https://example.invalid/link",
    };

    const outcome = await handleWebhookEvent(db, payload, "mock");
    expect(outcome).toBe("PROCESSED");

    const transactions = await getTransactions(db, fixtureProfile.id, "2026-09-05");
    expect(transactions.some((t) => t.externalTransactionId === "mock-tx-webhook-1")).toBe(true);
  });
});

describe("handleWebhookEvent — transactions/deleted marks the transaction REVERSED, not hard-deleted", () => {
  it("preserves the transaction row but excludes it from active consumption", async () => {
    const db = await freshSeededDb();
    const transaction: ExternalTransactionInput = {
      provider: "mock",
      externalTransactionId: "mock-tx-to-delete-1",
      paymentSourceExternalRef: mockAccount.externalAccountId,
      amountCents: 2_000,
      direction: "DEBIT",
      financialEffect: "CONSUMPTION",
      certainty: "ACTUAL",
      date: "2026-09-04",
      rawDescription: "COMPRA A REVERTER",
      rawMerchant: "COMPRA A REVERTER",
      status: "POSTED",
    };
    installMockProvider({
      accounts: [mockAccount],
      transactionsByAccount: new Map([[mockAccount.externalAccountId, [transaction]]]),
    });
    const connection = await setUpConnection(db);

    await handleWebhookEvent(
      db,
      {
        id: mockAccount.externalAccountId,
        eventId: "webhook-event-tx-created-for-delete",
        event: "transactions/created" as const,
        itemId: connection.externalConnectionId,
        accountId: mockAccount.externalAccountId,
        transactionsCreatedAtFrom: "2026-09-04T00:00:00.000Z",
        createdTransactionsLink: "https://example.invalid/link",
      },
      "mock",
    );

    const deleteOutcome = await handleWebhookEvent(
      db,
      {
        id: mockAccount.externalAccountId,
        eventId: "webhook-event-tx-deleted-1",
        event: "transactions/deleted" as const,
        itemId: connection.externalConnectionId,
        clientId: "mock-client",
        accountId: mockAccount.externalAccountId,
        transactionIds: ["mock-tx-to-delete-1"],
      },
      "mock",
    );
    expect(deleteOutcome).toBe("PROCESSED");

    const found = await repo.findTransactionByExternalId(db, fixtureProfile.id, "mock", "mock-tx-to-delete-1");
    expect(found).toBeDefined(); // preserved, not hard-deleted
    expect(found?.status).toBe("REVERSED");
  });
});

describe("handleWebhookEvent — provider still SYNCING does not poison the watermark (DEC-128)", () => {
  it("an item/updated webhook that arrives while the provider Item is still assembling data never advances lastSuccessfulSyncAt", async () => {
    const db = await freshSeededDb();
    installMockProvider({ accounts: [], transactionsByAccount: new Map(), status: "SYNCING" });
    const connection = await setUpConnection(db);

    const outcome = await handleWebhookEvent(
      db,
      {
        id: connection.externalConnectionId,
        eventId: "webhook-event-still-syncing",
        event: "item/updated" as const,
        itemId: connection.externalConnectionId,
      },
      "mock",
    );
    expect(outcome).toBe("PROCESSED");

    const updated = await repo.getProviderConnectionById(db, connection.id);
    expect(updated?.lastSuccessfulSyncAt).toBeUndefined();
    expect(updated?.status).toBe("SYNCING");
  });

  it("a later item/updated webhook, once the provider reports CONNECTED, recovers the data the still-SYNCING attempt missed", async () => {
    const db = await freshSeededDb();
    const salary: ExternalTransactionInput = {
      provider: "mock",
      externalTransactionId: "mock-tx-webhook-salary-1",
      paymentSourceExternalRef: mockAccount.externalAccountId,
      amountCents: 850_000,
      direction: "CREDIT",
      financialEffect: "INCOME",
      certainty: "ACTUAL",
      date: "2026-09-05",
      rawDescription: "SALARIO EMPRESA XYZ LTDA",
      rawMerchant: "EMPRESA XYZ LTDA",
      status: "POSTED",
    };
    installMockProvider({ accounts: [], transactionsByAccount: new Map(), status: "SYNCING" });
    const connection = await setUpConnection(db);

    // First delivery: the Item is still SYNCING — nothing importable yet.
    await handleWebhookEvent(
      db,
      {
        id: connection.externalConnectionId,
        eventId: "webhook-event-first-attempt",
        event: "item/updated" as const,
        itemId: connection.externalConnectionId,
      },
      "mock",
    );

    // Provider finishes assembling the Item's data and reports CONNECTED —
    // a second, later webhook delivery (a real, distinct eventId, exactly
    // as Pluggy would send once the Item transitions) must recover it.
    installMockProvider({
      accounts: [mockAccount],
      transactionsByAccount: new Map([[mockAccount.externalAccountId, [salary]]]),
      status: "CONNECTED",
    });
    const outcome = await handleWebhookEvent(
      db,
      {
        id: connection.externalConnectionId,
        eventId: "webhook-event-second-attempt-connected",
        event: "item/updated" as const,
        itemId: connection.externalConnectionId,
      },
      "mock",
    );
    expect(outcome).toBe("PROCESSED");

    const found = await repo.findTransactionByExternalId(
      db,
      fixtureProfile.id,
      "mock",
      "mock-tx-webhook-salary-1",
    );
    expect(found).toBeDefined();
    expect(found?.amount.cents).toBe(850_000);
    expect(found?.financialEffect).toBe("INCOME");
  });
});
