import { afterEach, describe, expect, it } from "vitest";
import { fixtureProfile } from "@money-copilot/financial-engine";
import type { ExternalAccountInput } from "@money-copilot/financial-engine";
import * as repo from "@money-copilot/persistence";
import { completeConnection, recoverOrphanedConnection } from "./sync";
import { handleWebhookEvent } from "./webhook";
import { resetProviderRegistry } from "./provider-registry";
import { freshSeededDb, installMockProvider } from "./test-helpers";

/**
 * Sprint 4.5 architectural hardening: Pluggy's own documentation says the
 * Connect widget's `onSuccess` callback is not guaranteed to fire, so a
 * `ProviderConnection` must be discoverable/persistable even when it
 * never does. See docs/OPEN-FINANCE.md, "Connection recovery," and
 * docs/DECISIONS.md, DEC-046.
 */

const EXTERNAL_CONNECTION_ID = "mock-orphan-conn-1";

const mockAccount: ExternalAccountInput = {
  provider: "mock",
  externalAccountId: "mock-orphan-account-1",
  connectionExternalId: EXTERNAL_CONNECTION_ID,
  kind: "BANK",
  displayName: "Mock Checking",
  currency: "BRL",
  balanceCents: 50_000,
  balanceCertainty: "ACTUAL",
  lastSyncedAt: "2026-09-05T00:00:00.000Z",
};

afterEach(() => {
  resetProviderRegistry();
});

describe("scenario 1 — onSuccess received normally", () => {
  it("persists a connection and runs the initial sync via completeConnection, as the fast UX path always has", async () => {
    const db = await freshSeededDb();
    installMockProvider({ accounts: [mockAccount], transactionsByAccount: new Map() });

    const { connection, syncRun } = await completeConnection(
      db,
      fixtureProfile.id,
      "mock",
      EXTERNAL_CONNECTION_ID,
    );

    expect(connection.financialProfileId).toBe(fixtureProfile.id);
    expect(syncRun.metrics.accountsDiscovered).toBe(1);
    const allConnections = await repo.listProviderConnections(db, fixtureProfile.id);
    expect(allConnections).toHaveLength(1);
  });
});

describe("scenario 2 — frontend closes before onSuccess", () => {
  it("leaves no connection persisted — the precondition recovery exists to fix", async () => {
    const db = await freshSeededDb();
    installMockProvider({ accounts: [mockAccount], transactionsByAccount: new Map() });
    // Nothing calls completeConnection here — simulating the widget's
    // onSuccess never firing client-side.
    const found = await repo.findProviderConnectionByExternalId(db, "mock", EXTERNAL_CONNECTION_ID);
    expect(found).toBeUndefined();
  });
});

describe("scenario 3 — provider/webhook later confirms the Item", () => {
  it("recovers the connection when an item/created webhook arrives for an unknown externalConnectionId", async () => {
    const db = await freshSeededDb();
    installMockProvider({
      accounts: [mockAccount],
      transactionsByAccount: new Map(),
      clientUserIdByExternalConnectionId: new Map([[EXTERNAL_CONNECTION_ID, fixtureProfile.id]]),
    });

    const outcome = await handleWebhookEvent(
      db,
      { id: EXTERNAL_CONNECTION_ID, eventId: "webhook-recovery-1", event: "item/created", itemId: EXTERNAL_CONNECTION_ID },
      "mock",
    );

    expect(outcome).toBe("PROCESSED");
    const found = await repo.findProviderConnectionByExternalId(db, "mock", EXTERNAL_CONNECTION_ID);
    expect(found?.financialProfileId).toBe(fixtureProfile.id);
  });
});

describe("scenario 4 — missing local connection is recovered", () => {
  it("recoverOrphanedConnection persists a connection and runs the same initial-sync pipeline as onSuccess", async () => {
    const db = await freshSeededDb();
    installMockProvider({
      accounts: [mockAccount],
      transactionsByAccount: new Map(),
      clientUserIdByExternalConnectionId: new Map([[EXTERNAL_CONNECTION_ID, fixtureProfile.id]]),
    });

    const outcome = await recoverOrphanedConnection(db, "mock", EXTERNAL_CONNECTION_ID);

    expect(outcome.recovered).toBe(true);
    if (outcome.recovered && !outcome.alreadyExisted) {
      expect(outcome.syncRun.metrics.accountsDiscovered).toBe(1);
    } else {
      expect.unreachable("expected a freshly recovered connection");
    }
    expect(outcome.connection.financialProfileId).toBe(fixtureProfile.id);
  });

  it("does not recover when the provider reports no clientUserId at all", async () => {
    const db = await freshSeededDb();
    installMockProvider({ accounts: [mockAccount], transactionsByAccount: new Map() });

    const outcome = await recoverOrphanedConnection(db, "mock", EXTERNAL_CONNECTION_ID);

    expect(outcome).toEqual({ recovered: false, reason: "NO_CLIENT_USER_ID" });
    const found = await repo.findProviderConnectionByExternalId(db, "mock", EXTERNAL_CONNECTION_ID);
    expect(found).toBeUndefined();
  });

  it("does not recover when the clientUserId does not match any known FinancialProfile", async () => {
    const db = await freshSeededDb();
    installMockProvider({
      accounts: [mockAccount],
      transactionsByAccount: new Map(),
      clientUserIdByExternalConnectionId: new Map([[EXTERNAL_CONNECTION_ID, "not-a-real-profile-id"]]),
    });

    const outcome = await recoverOrphanedConnection(db, "mock", EXTERNAL_CONNECTION_ID);

    expect(outcome).toEqual({ recovered: false, reason: "UNKNOWN_PROFILE" });
    const found = await repo.findProviderConnectionByExternalId(db, "mock", EXTERNAL_CONNECTION_ID);
    expect(found).toBeUndefined();
  });
});

describe("scenario 5 — both onSuccess and webhook arrive", () => {
  it("never creates a duplicate ProviderConnection when onSuccess persists first and a webhook confirms afterward", async () => {
    const db = await freshSeededDb();
    installMockProvider({
      accounts: [mockAccount],
      transactionsByAccount: new Map(),
      clientUserIdByExternalConnectionId: new Map([[EXTERNAL_CONNECTION_ID, fixtureProfile.id]]),
    });

    // onSuccess path.
    const { connection: fromOnSuccess } = await completeConnection(
      db,
      fixtureProfile.id,
      "mock",
      EXTERNAL_CONNECTION_ID,
    );

    // Webhook arrives afterward for the same Item.
    const outcome = await handleWebhookEvent(
      db,
      { id: EXTERNAL_CONNECTION_ID, eventId: "webhook-after-onsuccess-1", event: "item/created", itemId: EXTERNAL_CONNECTION_ID },
      "mock",
    );
    expect(outcome).toBe("PROCESSED");

    const allConnections = await repo.listProviderConnections(db, fixtureProfile.id);
    expect(allConnections).toHaveLength(1);
    expect(allConnections[0]?.id).toBe(fromOnSuccess.id);
  });

  it("never creates a duplicate ProviderConnection when a webhook recovers first and onSuccess arrives afterward", async () => {
    const db = await freshSeededDb();
    installMockProvider({
      accounts: [mockAccount],
      transactionsByAccount: new Map(),
      clientUserIdByExternalConnectionId: new Map([[EXTERNAL_CONNECTION_ID, fixtureProfile.id]]),
    });

    const recovered = await recoverOrphanedConnection(db, "mock", EXTERNAL_CONNECTION_ID);
    expect(recovered.recovered).toBe(true);

    // onSuccess arrives late (e.g. a delayed client callback) for the same Item.
    const { connection: fromOnSuccess } = await completeConnection(
      db,
      fixtureProfile.id,
      "mock",
      EXTERNAL_CONNECTION_ID,
    );

    const allConnections = await repo.listProviderConnections(db, fixtureProfile.id);
    expect(allConnections).toHaveLength(1);
    expect(recovered.recovered && !recovered.alreadyExisted && recovered.connection.id).toBe(fromOnSuccess.id);
  });
});

describe("scenario 6 — repeated recovery remains idempotent", () => {
  it("a second recoverOrphanedConnection call for the same Item reuses the existing connection without re-deriving anything", async () => {
    const db = await freshSeededDb();
    installMockProvider({
      accounts: [mockAccount],
      transactionsByAccount: new Map(),
      clientUserIdByExternalConnectionId: new Map([[EXTERNAL_CONNECTION_ID, fixtureProfile.id]]),
    });

    const first = await recoverOrphanedConnection(db, "mock", EXTERNAL_CONNECTION_ID);
    expect(first.recovered).toBe(true);
    expect(first.recovered && first.alreadyExisted).toBe(false);

    const second = await recoverOrphanedConnection(db, "mock", EXTERNAL_CONNECTION_ID);
    expect(second.recovered).toBe(true);
    expect(second.recovered && second.alreadyExisted).toBe(true);
    expect(first.recovered && second.recovered && second.connection.id).toBe(
      first.recovered && first.connection.id,
    );

    const allConnections = await repo.listProviderConnections(db, fixtureProfile.id);
    expect(allConnections).toHaveLength(1);
  });

  it("repeated item/created webhook deliveries for the same recovered Item never duplicate the connection", async () => {
    const db = await freshSeededDb();
    installMockProvider({
      accounts: [mockAccount],
      transactionsByAccount: new Map(),
      clientUserIdByExternalConnectionId: new Map([[EXTERNAL_CONNECTION_ID, fixtureProfile.id]]),
    });

    await handleWebhookEvent(
      db,
      { id: EXTERNAL_CONNECTION_ID, eventId: "webhook-repeat-1", event: "item/created", itemId: EXTERNAL_CONNECTION_ID },
      "mock",
    );
    await handleWebhookEvent(
      db,
      { id: EXTERNAL_CONNECTION_ID, eventId: "webhook-repeat-2", event: "item/updated", itemId: EXTERNAL_CONNECTION_ID },
      "mock",
    );

    const allConnections = await repo.listProviderConnections(db, fixtureProfile.id);
    expect(allConnections).toHaveLength(1);
  });
});
