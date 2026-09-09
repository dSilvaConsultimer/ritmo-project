import { createDatabase, runMigrations, seed, type Database } from "@money-copilot/persistence";
import { MockProvider } from "@money-copilot/open-finance";
import type { ExternalAccountInput, ExternalTransactionInput, ExternalBillInput } from "@money-copilot/financial-engine";
import { registerProvider, resetProviderRegistry } from "./provider-registry";

/** A fresh, migrated, seeded (founder fixture) in-memory database for tests. */
export async function freshSeededDb(): Promise<Database> {
  const db = await createDatabase();
  await runMigrations(db);
  await seed(db);
  return db;
}

export function installMockProvider(options: {
  accounts: readonly ExternalAccountInput[];
  transactionsByAccount: ReadonlyMap<string, readonly ExternalTransactionInput[]>;
  billsByAccount?: ReadonlyMap<string, readonly ExternalBillInput[]>;
  clientUserIdByExternalConnectionId?: ReadonlyMap<string, string>;
}): MockProvider {
  resetProviderRegistry();
  const provider = new MockProvider(options);
  registerProvider("mock", provider);
  return provider;
}
