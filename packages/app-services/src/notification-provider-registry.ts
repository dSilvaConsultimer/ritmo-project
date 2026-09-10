import { MockNotificationProvider, type NotificationProvider } from "./notifications/provider";

/**
 * Mirrors `discovery-provider-registry.ts`/`provider-registry.ts`'s exact
 * pattern. Only `"mock"` exists — no real push/email provider is
 * configured (see docs/ALERTS-NOTIFICATIONS.md, "External notification
 * provider status"). Adding a real one later is purely additive.
 */
export type NotificationProviderName = "mock";

const registry = new Map<NotificationProviderName, NotificationProvider>();

export function getNotificationProvider(name: NotificationProviderName = "mock"): NotificationProvider {
  const cached = registry.get(name);
  if (cached) return cached;
  const provider = new MockNotificationProvider();
  registry.set(name, provider);
  return provider;
}

export function registerNotificationProvider(name: NotificationProviderName, provider: NotificationProvider): void {
  registry.set(name, provider);
}

export function resetNotificationProviderRegistry(): void {
  registry.clear();
}
