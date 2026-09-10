import { DiscoveryError, MockDiscoveryProvider, type LocalDiscoveryProvider } from "@money-copilot/discovery";

/**
 * Sprint 6: mirrors `provider-registry.ts`'s exact pattern for Open
 * Finance. Only `"mock"` exists today — no live discovery provider
 * credential is currently configured (see docs/CONCIERGE.md, "Live
 * provider status"). Adding a real provider later is purely additive: a
 * new adapter class + a new registry branch, never a change to any caller.
 */
export type DiscoveryProviderName = "mock";

const registry = new Map<DiscoveryProviderName, LocalDiscoveryProvider>();

/**
 * Sprint 7 (docs/CONCIERGE.md, "Live provider status" / discovery
 * production safety): `MockDiscoveryProvider` returns obviously-synthetic
 * venue data — fine for development and every automated test, but it must
 * never be what a real production deployment shows a user as if it were a
 * real search result. Since `"mock"` is the ONLY provider registered until
 * a real credential exists, resolving it in production throws instead of
 * silently returning fake data — callers (`concierge-service.ts`) catch
 * this specific error and return an honest "search unavailable" result
 * rather than a crash or fabricated venues. `env` is an explicit parameter
 * (defaulting to `process.env.NODE_ENV`) so this is deterministically
 * testable without mutating global process state.
 */
export function getDiscoveryProvider(
  name: DiscoveryProviderName = "mock",
  env: string | undefined = process.env["NODE_ENV"],
): LocalDiscoveryProvider {
  if (name === "mock" && env === "production" && !registry.has(name)) {
    throw new DiscoveryError(
      "PROVIDER_NOT_CONFIGURED_FOR_PRODUCTION",
      "No live discovery provider is configured — refusing to use synthetic mock venue data in production.",
    );
  }
  const cached = registry.get(name);
  if (cached) return cached;
  const provider = new MockDiscoveryProvider();
  registry.set(name, provider);
  return provider;
}

/** Test-only: allows injecting a fake/fixture-controlled provider under a given name. */
export function registerDiscoveryProvider(name: DiscoveryProviderName, provider: LocalDiscoveryProvider): void {
  registry.set(name, provider);
}

export function resetDiscoveryProviderRegistry(): void {
  registry.clear();
}
