import type {
  ExternalAccountInput,
  ExternalBillInput,
  ExternalTransactionInput,
  ProviderConnectionStatus,
} from "@money-copilot/financial-engine";

/**
 * Provider-neutral inputs/outputs for the abstraction below. Every concrete
 * adapter (`PluggyProvider`, a future `BelvoProvider`, `MockProvider`)
 * implements this same shape — nothing provider-specific ever crosses this
 * boundary. See docs/OPEN-FINANCE.md.
 */
export interface CreateConnectionTokenOptions {
  /** A stable, non-sensitive identifier for the user — derived from the internal FinancialProfile id. */
  readonly clientUserId: string;
  /** Where the provider should send webhook events for this connection. */
  readonly webhookUrl?: string;
  /** Set when refreshing/re-authenticating an existing connection rather than creating a new one. */
  readonly externalConnectionId?: string;
}

export interface ConnectionTokenResult {
  readonly connectToken: string;
}

export interface ExternalConnectionStatus {
  readonly externalConnectionId: string;
  readonly status: ProviderConnectionStatus;
  readonly connectorId?: string;
  readonly connectorName?: string;
  readonly errorCode?: string;
  readonly errorMessage?: string;
  readonly consentExpiresAt?: string;
  /** The provider's own last-completed-sync timestamp, if it reports one. */
  readonly providerLastUpdatedAt?: string;
}

export interface ListTransactionsOptions {
  /** Only return transactions on/after this ISO date. */
  readonly since?: string;
  /** Only return transactions with these external ids (used for webhook-triggered re-fetches). */
  readonly externalTransactionIds?: readonly string[];
}

/**
 * The provider abstraction. `financial-engine` never depends on this — this
 * package depends on `financial-engine` (for the canonical DTOs), never the
 * other way around. See NON-NEGOTIABLE: "Pluggy must not leak into the
 * financial engine."
 */
export interface OpenFinanceProvider {
  readonly name: string;

  createConnectionToken(options: CreateConnectionTokenOptions): Promise<ConnectionTokenResult>;

  getConnection(externalConnectionId: string): Promise<ExternalConnectionStatus>;

  listAccounts(externalConnectionId: string): Promise<readonly ExternalAccountInput[]>;

  listTransactions(
    externalAccountId: string,
    options?: ListTransactionsOptions,
  ): Promise<readonly ExternalTransactionInput[]>;

  listBills(externalAccountId: string): Promise<readonly ExternalBillInput[]>;

  /** Asks the provider to refresh this connection's data (not a full local sync — see `@money-copilot/app-services`). */
  syncConnection(externalConnectionId: string): Promise<void>;

  deleteConnection(externalConnectionId: string): Promise<void>;
}
