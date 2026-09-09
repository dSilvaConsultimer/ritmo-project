import { MockDiscoveryProvider, type LocalDiscoveryProvider } from "@money-copilot/discovery";

/**
 * Sprint 6: mirrors `provider-registry.ts`'s exact pattern for Open
 * Finance. Only `"mock"` exists today — no live discovery provider
 * credential is currently configured (see docs/CONCIERGE.md, "Live
 * provider status"). Adding a real provider later is purely additive: a
 * new adapter class + a new registry branch, never a change to any caller.
 */
export type DiscoveryProviderName = "mock";

const registry = new Map<DiscoveryProviderName, LocalDiscoveryProvider>();

export function getDiscoveryProvider(name: DiscoveryProviderName = "mock"): LocalDiscoveryProvider {
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
