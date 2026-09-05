import { MockProvider, PluggyProvider, type OpenFinanceProvider } from "@money-copilot/open-finance";

export type ProviderName = "pluggy" | "mock";

const registry = new Map<ProviderName, OpenFinanceProvider>();

/**
 * Resolves a provider adapter by name. `PluggyProvider` is only
 * constructed lazily, on first use — so a process with no
 * `PLUGGY_CLIENT_ID`/`PLUGGY_CLIENT_SECRET` configured can still boot and
 * serve the demo/fixture dashboard; it only throws
 * (`ProviderError: INVALID_CONFIGURATION`) if something actually tries to
 * use the real Pluggy provider without credentials.
 */
export function getProvider(name: ProviderName): OpenFinanceProvider {
  const cached = registry.get(name);
  if (cached) return cached;

  const provider = name === "mock" ? new MockProvider({ accounts: [], transactionsByAccount: new Map() }) : new PluggyProvider();
  registry.set(name, provider);
  return provider;
}

/** Test-only: allows injecting a fake provider (e.g. a MockProvider with fixtures) under a given name. */
export function registerProvider(name: ProviderName, provider: OpenFinanceProvider): void {
  registry.set(name, provider);
}

export function resetProviderRegistry(): void {
  registry.clear();
}
