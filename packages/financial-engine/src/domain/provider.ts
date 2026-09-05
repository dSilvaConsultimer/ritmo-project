import type { Id } from "@money-copilot/shared";

/**
 * Generic, provider-agnostic connection lifecycle. A real provider (Pluggy,
 * Belvo, ...) has its own richer status vocabulary — the adapter maps it
 * into this shape; `packages/financial-engine` never sees provider-specific
 * status strings. See `packages/open-finance`.
 */
export type ProviderConnectionStatus =
  | "PENDING"
  | "CONNECTED"
  | "SYNCING"
  | "LOGIN_ERROR"
  | "USER_ACTION_REQUIRED"
  | "ERROR"
  | "DISCONNECTED";

/**
 * Metadata about an external financial-data connection (e.g. a Pluggy
 * Item). Never stores banking login credentials — only provider-side
 * identifiers and sync bookkeeping. See RULE (Sprint 3): "do not persist
 * unnecessary PII."
 */
export interface ProviderConnection {
  readonly id: Id<"provider-connection">;
  readonly financialProfileId: Id<"financial-profile">;
  readonly provider: string;
  readonly externalConnectionId: string;
  readonly status: ProviderConnectionStatus;
  readonly connectorId?: string;
  readonly connectorName?: string;
  readonly lastSuccessfulSyncAt?: string;
  readonly lastAttemptedSyncAt?: string;
  readonly errorCode?: string;
  readonly errorMessage?: string;
  readonly consentExpiresAt?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type SyncRunStatus = "PENDING" | "RUNNING" | "SUCCEEDED" | "PARTIAL" | "FAILED";

export interface SyncRunMetrics {
  readonly accountsDiscovered: number;
  readonly transactionsReceived: number;
  readonly transactionsCreated: number;
  readonly transactionsUpdated: number;
  readonly transactionsReconciled: number;
  readonly transactionsIgnoredDuplicates: number;
  readonly billsReceived: number;
}

export const EMPTY_SYNC_RUN_METRICS: SyncRunMetrics = {
  accountsDiscovered: 0,
  transactionsReceived: 0,
  transactionsCreated: 0,
  transactionsUpdated: 0,
  transactionsReconciled: 0,
  transactionsIgnoredDuplicates: 0,
  billsReceived: 0,
};

/**
 * One observable synchronization attempt for a connection — must never
 * silently swallow a partial failure (Sprint 3 brief). `PARTIAL` means some
 * resources synced and at least one failed; `errors` always explains why.
 */
export interface SyncRun {
  readonly id: Id<"sync-run">;
  readonly connectionId: Id<"provider-connection">;
  readonly status: SyncRunStatus;
  readonly startedAt: string;
  readonly finishedAt?: string;
  readonly metrics: SyncRunMetrics;
  readonly errors: readonly string[];
  /** Opaque provider pagination/cursor bookkeeping, if useful for the next incremental sync. */
  readonly providerCursor?: string;
}

/**
 * Normalized provider error taxonomy. Every provider adapter must throw
 * only these — `financial-engine`/`persistence`/the UI never handle a raw
 * provider SDK error type. See docs/OPEN-FINANCE.md, "Error handling."
 */
export type ProviderErrorCode =
  | "AUTHENTICATION_ERROR"
  | "USER_ACTION_REQUIRED"
  | "PROVIDER_UNAVAILABLE"
  | "RATE_LIMITED"
  | "INVALID_CONFIGURATION"
  | "SYNC_CONFLICT"
  | "NETWORK_ERROR"
  | "UNKNOWN_PROVIDER_ERROR";

export class ProviderError extends Error {
  readonly code: ProviderErrorCode;
  readonly provider: string;
  readonly retryable: boolean;

  constructor(
    code: ProviderErrorCode,
    provider: string,
    message: string,
    options: { retryable?: boolean; cause?: unknown } = {},
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "ProviderError";
    this.code = code;
    this.provider = provider;
    this.retryable = options.retryable ?? false;
  }
}
