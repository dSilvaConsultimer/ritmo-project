import { PluggyClient } from "pluggy-sdk";
import { ProviderError } from "@money-copilot/financial-engine";

/**
 * The subset of `PluggyClient` this adapter actually calls — narrowed so
 * tests can inject a fake without depending on the real SDK class or
 * network access. `PluggyClient` itself already satisfies this (structural
 * typing), so production code passes no second argument.
 */
export interface PluggyApiClient {
  createConnectToken(
    itemId?: string,
    options?: { webhookUrl?: string; clientUserId?: string },
  ): Promise<{ accessToken: string }>;
  fetchItem(id: string): ReturnType<PluggyClient["fetchItem"]>;
  fetchAccounts(itemId: string): ReturnType<PluggyClient["fetchAccounts"]>;
  fetchAccount(id: string): ReturnType<PluggyClient["fetchAccount"]>;
  fetchAllTransactions(
    accountId: string,
    options?: Parameters<PluggyClient["fetchAllTransactions"]>[1],
  ): ReturnType<PluggyClient["fetchAllTransactions"]>;
  fetchCreditCardBills(accountId: string): ReturnType<PluggyClient["fetchCreditCardBills"]>;
  updateItem(id: string): ReturnType<PluggyClient["updateItem"]>;
  deleteItem(id: string): ReturnType<PluggyClient["deleteItem"]>;
}

let cachedClient: PluggyClient | undefined;

/**
 * Lazily creates and reuses a single `PluggyClient` per process. The SDK
 * itself caches the underlying API key (a JWT) and only re-authenticates
 * once it's actually expired (`isJwtExpired`, ~2h validity per Pluggy) —
 * reusing one client instance is what makes that caching effective across
 * calls, rather than re-authenticating on every request. Server-only:
 * `CLIENT_ID`/`CLIENT_SECRET` must never reach browser code.
 */
export function getPluggyClient(): PluggyApiClient {
  if (cachedClient) return cachedClient;

  const clientId = process.env["PLUGGY_CLIENT_ID"];
  const clientSecret = process.env["PLUGGY_CLIENT_SECRET"];

  if (!clientId || !clientSecret) {
    throw new ProviderError(
      "INVALID_CONFIGURATION",
      "pluggy",
      "PLUGGY_CLIENT_ID/PLUGGY_CLIENT_SECRET are not configured. See .env.example.",
    );
  }

  cachedClient = new PluggyClient({ clientId, clientSecret });
  return cachedClient;
}

/** Test-only: clears the cached client so a fake can be substituted per test. */
export function resetPluggyClientCache(): void {
  cachedClient = undefined;
}
