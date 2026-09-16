import { mkdtempSync, mkdirSync, cpSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/pglite/migrator";
import { buildFinancialPositionFromAccounts } from "@money-copilot/financial-engine";
import type { Id } from "@money-copilot/shared";
import { createDatabase } from "./db";
import * as repo from "./repositories";
import * as schema from "./schema";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REAL_MIGRATIONS_DIR = join(__dirname, "..", "migrations");

/**
 * Builds a temporary migrations folder containing only the first
 * `migrationCount` entries from the real journal — i.e. "the database as it
 * existed at the end of Sprint 2" (one migration) vs. "as of Sprint 3" (two).
 * This lets a single test exercise both a clean-database apply AND a
 * forward migration from an earlier schema, without relying only on always
 * migrating a fresh database from scratch (see Sprint 3 quality gate:
 * "verify existing Sprint 2 database can migrate forward").
 */
function buildPartialMigrationsFolder(migrationCount: number): string {
  const dir = mkdtempSync(join(tmpdir(), "money-copilot-migrations-"));
  mkdirSync(join(dir, "meta"), { recursive: true });

  const journal = JSON.parse(
    readFileSync(join(REAL_MIGRATIONS_DIR, "meta", "_journal.json"), "utf-8"),
  ) as { entries: { tag: string }[] };
  const entries = journal.entries.slice(0, migrationCount);

  writeFileSync(
    join(dir, "meta", "_journal.json"),
    JSON.stringify({ ...journal, entries }, null, 2),
  );

  for (const entry of entries) {
    cpSync(join(REAL_MIGRATIONS_DIR, `${entry.tag}.sql`), join(dir, `${entry.tag}.sql`));
    const idx = entries.indexOf(entry);
    const snapshotName = `${String(idx).padStart(4, "0")}_snapshot.json`;
    cpSync(join(REAL_MIGRATIONS_DIR, "meta", snapshotName), join(dir, "meta", snapshotName));
  }

  return dir;
}

describe("migrations — clean database", () => {
  it("applies every migration to a brand new database without error", async () => {
    const db = await createDatabase();
    await expect(migrate(db, { migrationsFolder: REAL_MIGRATIONS_DIR })).resolves.not.toThrow();

    // The Sprint 3 tables exist and are queryable.
    await expect(db.select().from(schema.providerConnections)).resolves.toEqual([]);
    await expect(db.select().from(schema.bills)).resolves.toEqual([]);
    await expect(db.select().from(schema.syncRuns)).resolves.toEqual([]);
    await expect(db.select().from(schema.webhookEvents)).resolves.toEqual([]);

    // The Sprint 4 AI copilot tables exist and are queryable.
    await expect(db.select().from(schema.conversations)).resolves.toEqual([]);
    await expect(db.select().from(schema.conversationMessages)).resolves.toEqual([]);
    await expect(db.select().from(schema.aiToolExecutions)).resolves.toEqual([]);
    await expect(db.select().from(schema.aiRequests)).resolves.toEqual([]);
  });
});

describe("migrations — Sprint 2 -> Sprint 3 forward migration", () => {
  it("migrates an existing Sprint 2 database forward without losing data", async () => {
    const db = await createDatabase();

    // 1. Apply only the Sprint 2 migration (everything up to and including
    //    migration 0000) — this is "the database as Sprint 2 left it."
    const sprint2Folder = buildPartialMigrationsFolder(1);
    await migrate(db, { migrationsFolder: sprint2Folder });

    // 2. Insert Sprint-2-shaped data using only the columns that existed
    //    then (the new Sprint 3 columns don't exist in the DB yet).
    await db.execute(
      sql`insert into financial_profiles (id, label, created_at) values ('profile-1', 'Test', '2026-09-05')`,
    );
    await db.execute(
      sql`insert into payment_sources (id, financial_profile_id, label, type) values ('ps-1', 'profile-1', 'Nubank', 'CREDIT_CARD')`,
    );

    // 3. Apply the Sprint 3 migration on top — the forward migration.
    const sprint3Folder = buildPartialMigrationsFolder(2);
    await expect(migrate(db, { migrationsFolder: sprint3Folder })).resolves.not.toThrow();

    // 4. The Sprint 2 data survived, and the new Sprint 3 columns are usable.
    // Selects only the columns that existed as of THIS migration boundary
    // (not the full, ever-growing `schema.paymentSources`) — later
    // migrations (e.g. DEC-130's reserved/available/invested balance
    // columns) add more columns to this same table, which would otherwise
    // make this SELECT reference columns that don't exist yet at this
    // specific, deliberately-partial migration count.
    const [paymentSource] = await db
      .select({
        id: schema.paymentSources.id,
        label: schema.paymentSources.label,
        subtype: schema.paymentSources.subtype,
        provider: schema.paymentSources.provider,
      })
      .from(schema.paymentSources);
    expect(paymentSource?.id).toBe("ps-1");
    expect(paymentSource?.label).toBe("Nubank");
    expect(paymentSource?.subtype).toBeNull(); // new column, defaults to null for pre-existing rows

    await db.execute(
      sql`update payment_sources set subtype = 'CREDIT_CARD', provider = 'pluggy' where id = 'ps-1'`,
    );
    const [updated] = await db
      .select({ provider: schema.paymentSources.provider })
      .from(schema.paymentSources);
    expect(updated?.provider).toBe("pluggy");

    // The brand new Sprint 3 tables are present and queryable too.
    await expect(db.select().from(schema.providerConnections)).resolves.toEqual([]);
  });
});

describe("migrations — Sprint 3 -> Sprint 4 forward migration", () => {
  it("migrates an existing Sprint 3 database forward without losing data", async () => {
    const db = await createDatabase();

    // 1. Apply everything up to and including the Sprint 3 migration
    //    (0000 + 0001) — "the database as Sprint 3 left it."
    const sprint3Folder = buildPartialMigrationsFolder(2);
    await migrate(db, { migrationsFolder: sprint3Folder });

    // 2. Insert Sprint-3-shaped data (no AI copilot tables exist yet).
    await db.execute(
      sql`insert into financial_profiles (id, label, created_at) values ('profile-1', 'Test', '2026-09-05')`,
    );
    await db.execute(
      sql`insert into provider_connections (id, financial_profile_id, provider, external_connection_id, status, created_at, updated_at)
          values ('conn-1', 'profile-1', 'pluggy', 'item-1', 'ACTIVE', '2026-09-05', '2026-09-05')`,
    );

    // 3. Apply the Sprint 4 migration on top — the forward migration.
    const sprint4Folder = buildPartialMigrationsFolder(3);
    await expect(migrate(db, { migrationsFolder: sprint4Folder })).resolves.not.toThrow();

    // 4. The Sprint 3 data survived.
    const [connection] = await db.select().from(schema.providerConnections);
    expect(connection?.id).toBe("conn-1");
    expect(connection?.provider).toBe("pluggy");

    // 5. The brand new Sprint 4 AI copilot tables are present and queryable.
    await expect(db.select().from(schema.conversations)).resolves.toEqual([]);
    await expect(db.select().from(schema.conversationMessages)).resolves.toEqual([]);
    await expect(db.select().from(schema.aiToolExecutions)).resolves.toEqual([]);
    await expect(db.select().from(schema.aiRequests)).resolves.toEqual([]);

    // 6. A conversation can now be inserted and linked back to the profile.
    await db.execute(
      sql`insert into conversations (id, financial_profile_id, status, created_at, updated_at)
          values ('conv-1', 'profile-1', 'ACTIVE', '2026-09-05', '2026-09-05')`,
    );
    const [conversation] = await db.select().from(schema.conversations);
    expect(conversation?.financialProfileId).toBe("profile-1");
  });
});

describe("migrations — DEC-131 duplicate PaymentSource repair + unique constraint", () => {
  it("repoints references from a pre-existing duplicate PaymentSource onto the canonical (most complete, freshest) one, then enforces uniqueness going forward", async () => {
    const db = await createDatabase();

    // 1. Apply everything up to and including migration 0010 — "the
    //    database as it existed right before DEC-131's constraint," i.e.
    //    exactly the state a pre-DEC-131 sync race could have produced.
    const preFolder = buildPartialMigrationsFolder(11);
    await migrate(db, { migrationsFolder: preFolder });

    await db
      .insert(schema.financialProfiles)
      .values({ id: "profile-dup-1", label: "Test", createdAt: "2026-09-05" });
    await db.insert(schema.providerConnections).values({
      id: "conn-dup-1",
      financialProfileId: "profile-dup-1",
      provider: "pluggy",
      externalConnectionId: "item-dup-1",
      status: "CONNECTED",
      createdAt: "2026-09-05",
      updatedAt: "2026-09-05",
    });

    // The STALE duplicate: created first, never touched again by any later
    // sync (missing the reserved/available/invested balances a later sync
    // populated) — the same real Pluggy account as the row below.
    await db.insert(schema.paymentSources).values({
      id: "ps-stale-dup",
      financialProfileId: "profile-dup-1",
      label: "Conta Corrente",
      type: "DEBIT",
      subtype: "CHECKING_ACCOUNT",
      provider: "pluggy",
      externalAccountId: "pluggy-account-dup-1",
      connectionId: "conn-dup-1",
      balanceCertainty: "ACTUAL",
      balanceCents: 3_599_575,
      lastSyncedAt: "2026-09-01T00:00:00.000Z",
    });
    // The CANONICAL duplicate: every subsequent sync's find-then-insert
    // happened to keep finding and updating THIS row instead — more
    // complete (has reserved/available balances) and more recently synced.
    await db.insert(schema.paymentSources).values({
      id: "ps-canonical-dup",
      financialProfileId: "profile-dup-1",
      label: "Conta Corrente",
      type: "DEBIT",
      subtype: "CHECKING_ACCOUNT",
      provider: "pluggy",
      externalAccountId: "pluggy-account-dup-1",
      connectionId: "conn-dup-1",
      balanceCertainty: "ACTUAL",
      balanceCents: 3_599_575,
      availableBalanceCents: 3_599_575,
      reservedBalanceCents: 100_004,
      lastSyncedAt: "2026-09-15T00:00:00.000Z",
    });
    // An unrelated, genuinely distinct CREDIT_CARD PaymentSource on the same
    // connection — must be left completely untouched by the repair (it has
    // its own distinct externalAccountId, so it was never part of any
    // duplicate group).
    await db.insert(schema.paymentSources).values({
      id: "ps-card-untouched",
      financialProfileId: "profile-dup-1",
      label: "Cartão",
      type: "CREDIT_CARD",
      provider: "pluggy",
      externalAccountId: "pluggy-card-account-1",
      connectionId: "conn-dup-1",
      balanceCertainty: "ACTUAL",
      balanceCents: 96_195,
      lastSyncedAt: "2026-09-15T00:00:00.000Z",
    });

    // A real transaction attached to the STALE row — proves repointing,
    // never deletion, of dependent data. Raw SQL (DEC-136): the typed
    // `schema.financialTransactions` insert always emits every column the
    // CURRENT schema declares (e.g. `category_id`, added by migration
    // 0016) regardless of what's actually applied at this pre-migration-11
    // boundary — only the columns that existed back then may appear here.
    await db.execute(
      sql`insert into financial_transactions (id, financial_profile_id, payment_source_id, date, amount_cents, direction, raw_description, normalized_description, status, certainty, financial_effect, origin, created_at, updated_at)
          values ('tx-dup-1', 'profile-dup-1', 'ps-stale-dup', '2026-09-10', 5590, 'DEBIT', 'NETFLIX', 'NETFLIX', 'POSTED', 'ACTUAL', 'CONSUMPTION', 'IMPORTED', '2026-09-10', '2026-09-10')`,
    );
    // An installment plan already attached to the CANONICAL row, to prove a
    // reference already pointing at the eventual survivor is left intact.
    await db.insert(schema.installmentPlans).values({
      id: "plan-dup-1",
      financialProfileId: "profile-dup-1",
      description: "Some purchase",
      paymentSourceId: "ps-canonical-dup",
      installmentAmountCents: 20_000,
      certainty: "ACTUAL",
      status: "ACTIVE",
    });
    // A bill attached to the STALE row.
    await db.insert(schema.bills).values({
      id: "bill-dup-1",
      financialProfileId: "profile-dup-1",
      paymentSourceId: "ps-stale-dup",
      dueDate: "2026-09-20",
      totalAmountCents: 96_195,
      certainty: "ACTUAL",
      createdAt: "2026-09-05",
      updatedAt: "2026-09-05",
    });

    // 2. Apply the DEC-131 migration on top — repair, then constrain.
    const fullFolder = buildPartialMigrationsFolder(12);
    await expect(migrate(db, { migrationsFolder: fullFolder })).resolves.not.toThrow();
    // Then catch the database up to every later migration too — the DEC-131
    // repair being verified below is unaffected by anything added since,
    // but the typed `schema.financialTransactions` queries further down
    // always reference every column the CURRENT schema declares (e.g.
    // `category_id`, added by migration 0016), so the physical table needs
    // to actually have them.
    await migrate(db, { migrationsFolder: REAL_MIGRATIONS_DIR });

    // 3. Exactly one PaymentSource remains for this provider account, and
    //    it's the more complete, fresher one.
    const remaining = await db
      .select()
      .from(schema.paymentSources)
      .where(eq(schema.paymentSources.externalAccountId, "pluggy-account-dup-1"));
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.id).toBe("ps-canonical-dup");
    // The survivor's own reservedBalance metadata is exactly what it was —
    // canonicalization never touches the winning row's own data.
    expect(remaining[0]?.reservedBalanceCents).toBe(100_004);

    // The unrelated CREDIT_CARD PaymentSource is completely untouched.
    const [card] = await db
      .select()
      .from(schema.paymentSources)
      .where(eq(schema.paymentSources.id, "ps-card-untouched"));
    expect(card?.balanceCents).toBe(96_195);

    // No transaction was duplicated by the repair — still exactly one row
    // for this profile, merely repointed.
    const allTransactions = await db
      .select()
      .from(schema.financialTransactions)
      .where(eq(schema.financialTransactions.financialProfileId, "profile-dup-1"));
    expect(allTransactions).toHaveLength(1);

    // 4. Every dependent reference now points at the canonical survivor.
    const [tx] = await db
      .select()
      .from(schema.financialTransactions)
      .where(eq(schema.financialTransactions.id, "tx-dup-1"));
    expect(tx?.paymentSourceId).toBe("ps-canonical-dup");

    const [plan] = await db
      .select()
      .from(schema.installmentPlans)
      .where(eq(schema.installmentPlans.id, "plan-dup-1"));
    expect(plan?.paymentSourceId).toBe("ps-canonical-dup");

    const [bill] = await db.select().from(schema.bills).where(eq(schema.bills.id, "bill-dup-1"));
    expect(bill?.paymentSourceId).toBe("ps-canonical-dup");

    // 5. The invariant is now enforced by the DATABASE, not just
    //    application code: a second row for the same identity fails to insert.
    await expect(
      db.insert(schema.paymentSources).values({
        id: "ps-new-dup-attempt",
        financialProfileId: "profile-dup-1",
        label: "Conta Corrente",
        type: "DEBIT",
        provider: "pluggy",
        externalAccountId: "pluggy-account-dup-1",
      }),
    ).rejects.toThrow();

    // 6. Two manually-entered payment sources (provider/externalAccountId
    //    both null) remain unaffected — Postgres unique-constraint NULL
    //    semantics never restrict them.
    await db.insert(schema.paymentSources).values({
      id: "ps-manual-1",
      financialProfileId: "profile-dup-1",
      label: "Carteira",
      type: "CASH",
    });
    await expect(
      db.insert(schema.paymentSources).values({
        id: "ps-manual-2",
        financialProfileId: "profile-dup-1",
        label: "Carteira 2",
        type: "CASH",
      }),
    ).resolves.not.toThrow();

    // 7. After cleanup, the checking account's liquidity is counted exactly
    //    once by the position engine — the whole point of this repair.
    const accounts = await repo.listPaymentSourcesForProfile(db, "profile-dup-1");
    const position = buildFinancialPositionFromAccounts(
      accounts,
      "profile-dup-1" as Id<"financial-profile">,
      "2026-09-15",
      "pluggy",
    );
    // 35,995.75 (closing == balance here) - 1,000.04 reserved = 34,995.71 —
    // never doubled to 69,991.46.
    expect(position.cashBalance.amount?.cents).toBe(3_499_571);
  });

  it("is a no-op repair on a database with no duplicates — the constraint is simply added", async () => {
    const db = await createDatabase();
    await expect(migrate(db, { migrationsFolder: REAL_MIGRATIONS_DIR })).resolves.not.toThrow();
    await expect(db.select().from(schema.paymentSources)).resolves.toEqual([]);
  });
});
