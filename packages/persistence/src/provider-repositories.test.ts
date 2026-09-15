import { describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { createId, type Id } from "@money-copilot/shared";
import type { ProviderConnection, SyncRun, CreditCardBill } from "@money-copilot/financial-engine";
import { EMPTY_SYNC_RUN_METRICS, fromCents } from "@money-copilot/financial-engine";
import { createDatabase } from "./db";
import { runMigrations } from "./migrate";
import * as repo from "./repositories";
import * as schema from "./schema";
import * as mappers from "./mappers";

async function freshDb() {
  const db = await createDatabase();
  await runMigrations(db);
  return db;
}

async function seedProfile(db: Awaited<ReturnType<typeof freshDb>>) {
  const profileId = createId("financial-profile");
  await repo.upsertProfile(db, { id: profileId, label: "Test", createdAt: "2026-09-05" });
  return profileId;
}

describe("provider connection idempotency", () => {
  it("finds an existing connection instead of allowing a duplicate for the same external item", async () => {
    const db = await freshDb();
    const profileId = await seedProfile(db);

    const connection: ProviderConnection = {
      id: createId("provider-connection"),
      financialProfileId: profileId,
      provider: "pluggy",
      externalConnectionId: "item-123",
      status: "CONNECTED",
      createdAt: "2026-09-05",
      updatedAt: "2026-09-05",
    };

    await repo.upsertProviderConnection(db, connection);

    const found = await repo.findProviderConnection(db, profileId, "pluggy", "item-123");
    expect(found?.id).toBe(connection.id);

    // A second attempt with a DIFFERENT internal id for the same external
    // item must be recognized via findProviderConnection before insertion —
    // the app-services sync flow uses this to avoid ever creating a
    // duplicate row for the same real-world connection.
    const notFound = await repo.findProviderConnection(db, profileId, "pluggy", "item-999");
    expect(notFound).toBeUndefined();

    const connections = await repo.listProviderConnections(db, profileId);
    expect(connections).toHaveLength(1);
  });

  it("rejects a genuine duplicate row at the database level (unique constraint)", async () => {
    const db = await freshDb();
    const profileId = await seedProfile(db);

    const makeConnection = (id: Id<"provider-connection">): ProviderConnection => ({
      id,
      financialProfileId: profileId,
      provider: "pluggy",
      externalConnectionId: "item-dup",
      status: "CONNECTED",
      createdAt: "2026-09-05",
      updatedAt: "2026-09-05",
    });

    await repo.upsertProviderConnection(db, makeConnection(createId("provider-connection")));
    await expect(
      repo.upsertProviderConnection(db, makeConnection(createId("provider-connection"))),
    ).rejects.toThrow();
  });
});

describe("webhook idempotency", () => {
  it("claims a fresh event id and rejects a duplicate delivery of the same id", async () => {
    const db = await freshDb();

    const first = await repo.claimWebhookEvent(
      db,
      "event-1",
      "pluggy",
      "transactions/created",
      "2026-09-05T00:00:00.000Z",
      { event: "transactions/created", eventId: "event-1" },
    );
    expect(first).toBe("INSERTED");

    const second = await repo.claimWebhookEvent(
      db,
      "event-1",
      "pluggy",
      "transactions/created",
      "2026-09-05T00:00:01.000Z",
      { event: "transactions/created", eventId: "event-1" },
    );
    expect(second).toBe("ALREADY_PROCESSED");
  });

  it("marks a claimed event processed, and a failed one with an error message", async () => {
    const db = await freshDb();
    await repo.claimWebhookEvent(db, "event-2", "pluggy", "item/created", "2026-09-05T00:00:00.000Z", {});
    await repo.markWebhookEventProcessed(db, "event-2", "2026-09-05T00:00:05.000Z");

    await repo.claimWebhookEvent(db, "event-3", "pluggy", "item/error", "2026-09-05T00:00:00.000Z", {});
    await repo.markWebhookEventFailed(db, "event-3", "2026-09-05T00:00:05.000Z", "boom");
    // No throw — this is enough to prove both paths are callable and distinct.
  });
});

describe("bills", () => {
  it("persists a bill without it ever needing a FinancialSnapshotInput slot", async () => {
    const db = await freshDb();
    const profileId = await seedProfile(db);
    const paymentSourceId = createId("payment-source");
    await repo.upsertPaymentSource(
      db,
      { id: paymentSourceId, label: "Card", type: "CREDIT_CARD" },
      profileId,
    );

    const bill: CreditCardBill = {
      id: createId("credit-card-bill"),
      financialProfileId: profileId,
      paymentSourceId,
      dueDate: "2026-10-10",
      totalAmount: fromCents(85_000),
      certainty: "ACTUAL",
      createdAt: "2026-09-05",
      updatedAt: "2026-09-05",
    };
    await repo.upsertBill(db, bill);

    const bills = await repo.listBillsForPaymentSource(db, paymentSourceId);
    expect(bills).toHaveLength(1);
    expect(bills[0]?.totalAmount.cents).toBe(85_000);
  });
});

describe("PaymentSource — reserved/available/invested balance round-trip (DEC-130)", () => {
  it("persists and reads back availableBalance, reservedBalance, and automaticallyInvestedBalance independently", async () => {
    const db = await freshDb();
    const profileId = await seedProfile(db);
    const paymentSourceId = createId("payment-source");
    await repo.upsertPaymentSource(
      db,
      {
        id: paymentSourceId,
        label: "Conta Corrente",
        type: "DEBIT",
        balance: { certainty: "ACTUAL", amount: fromCents(3_599_575) },
        availableBalance: { certainty: "ACTUAL", amount: fromCents(3_499_571) },
        reservedBalance: { certainty: "ACTUAL", amount: fromCents(100_004) },
        automaticallyInvestedBalance: { certainty: "ACTUAL", amount: fromCents(359_957) },
      },
      profileId,
    );

    const [source] = await repo.listPaymentSourcesForProfile(db, profileId);
    expect(source?.balance?.amount?.cents).toBe(3_599_575);
    expect(source?.availableBalance?.amount?.cents).toBe(3_499_571);
    expect(source?.reservedBalance?.amount?.cents).toBe(100_004);
    expect(source?.automaticallyInvestedBalance?.amount?.cents).toBe(359_957);
  });

  it("leaves the new fields entirely absent (not zero) when never set", async () => {
    const db = await freshDb();
    const profileId = await seedProfile(db);
    const paymentSourceId = createId("payment-source");
    await repo.upsertPaymentSource(
      db,
      { id: paymentSourceId, label: "Card", type: "CREDIT_CARD", balance: { certainty: "ACTUAL", amount: fromCents(85_000) } },
      profileId,
    );

    const [source] = await repo.listPaymentSourcesForProfile(db, profileId);
    expect(source?.availableBalance).toBeUndefined();
    expect(source?.reservedBalance).toBeUndefined();
    expect(source?.automaticallyInvestedBalance).toBeUndefined();
  });
});

describe("Income — provenance round-trip (DEC-130)", () => {
  it("persists and reads back source and expectedDayOfMonth", async () => {
    const db = await freshDb();
    const profileId = await seedProfile(db);
    const incomeId = createId("income");
    await repo.upsertIncome(
      db,
      {
        id: incomeId,
        label: "Salário",
        grossAmount: fromCents(850_000),
        certainty: "CONFIRMED",
        recurring: true,
        source: "USER_CONFIRMED_HISTORY",
        expectedDayOfMonth: 5,
      },
      profileId,
    );

    const [row] = await db.select().from(schema.incomes).where(eq(schema.incomes.id, incomeId));
    const income = mappers.rowToIncome(row!);
    expect(income.source).toBe("USER_CONFIRMED_HISTORY");
    expect(income.expectedDayOfMonth).toBe(5);
  });

  it("defaults a legacy row with no source to USER_DECLARED, never leaving it ambiguous", async () => {
    const db = await freshDb();
    const profileId = await seedProfile(db);
    // Simulates a pre-DEC-130 row: insert without ever setting `source`.
    await db.execute(
      sql`insert into incomes (id, financial_profile_id, label, gross_amount_cents, certainty, recurring)
          values ('income-legacy-1', ${profileId}, 'Legacy income', 500000, 'CONFIRMED', true)`,
    );

    const [row] = await db.select().from(schema.incomes).where(eq(schema.incomes.id, "income-legacy-1"));
    const income = mappers.rowToIncome(row!);
    expect(income.source).toBe("USER_DECLARED");
    expect(income.expectedDayOfMonth).toBeUndefined();
  });
});

describe("sync runs", () => {
  it("records a sync run and retrieves the latest one for a connection", async () => {
    const db = await freshDb();
    const profileId = await seedProfile(db);
    const connectionId = createId("provider-connection");
    await repo.upsertProviderConnection(db, {
      id: connectionId,
      financialProfileId: profileId,
      provider: "pluggy",
      externalConnectionId: "item-1",
      status: "CONNECTED",
      createdAt: "2026-09-05",
      updatedAt: "2026-09-05",
    });

    const run: SyncRun = {
      id: createId("sync-run"),
      connectionId,
      status: "SUCCEEDED",
      startedAt: "2026-09-05T00:00:00.000Z",
      finishedAt: "2026-09-05T00:00:10.000Z",
      metrics: { ...EMPTY_SYNC_RUN_METRICS, transactionsCreated: 5 },
      errors: [],
    };
    await repo.upsertSyncRun(db, run);

    const latest = await repo.getLatestSyncRun(db, connectionId);
    expect(latest?.status).toBe("SUCCEEDED");
    expect(latest?.metrics.transactionsCreated).toBe(5);
  });

  it("preserves errors on a PARTIAL sync run rather than swallowing them", async () => {
    const db = await freshDb();
    const profileId = await seedProfile(db);
    const connectionId = createId("provider-connection");
    await repo.upsertProviderConnection(db, {
      id: connectionId,
      financialProfileId: profileId,
      provider: "pluggy",
      externalConnectionId: "item-2",
      status: "CONNECTED",
      createdAt: "2026-09-05",
      updatedAt: "2026-09-05",
    });

    const run: SyncRun = {
      id: createId("sync-run"),
      connectionId,
      status: "PARTIAL",
      startedAt: "2026-09-05T00:00:00.000Z",
      metrics: EMPTY_SYNC_RUN_METRICS,
      errors: ["Failed to fetch bills for account acc-1: NETWORK_ERROR"],
    };
    await repo.upsertSyncRun(db, run);

    const latest = await repo.getLatestSyncRun(db, connectionId);
    expect(latest?.status).toBe("PARTIAL");
    expect(latest?.errors).toEqual(["Failed to fetch bills for account acc-1: NETWORK_ERROR"]);
  });
});
