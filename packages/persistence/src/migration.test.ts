import { mkdtempSync, mkdirSync, cpSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/pglite/migrator";
import { createDatabase } from "./db";
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
