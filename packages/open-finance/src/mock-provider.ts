import type {
  ExternalAccountInput,
  ExternalBillInput,
  ExternalTransactionInput,
} from "@money-copilot/financial-engine";
import type {
  ConnectionTokenResult,
  CreateConnectionTokenOptions,
  ExternalConnectionStatus,
  ListTransactionsOptions,
  OpenFinanceProvider,
} from "./provider";

/**
 * A fully deterministic, in-memory `OpenFinanceProvider` — no network, no
 * credentials. Useful for demos and for exercising the full
 * connect→sync→snapshot pipeline end to end without Pluggy sandbox access.
 * Returns the same canonical DTOs a real adapter would, just without ever
 * calling out to a real provider.
 */
export class MockProvider implements OpenFinanceProvider {
  readonly name = "mock";

  private readonly accounts: readonly ExternalAccountInput[];
  private readonly transactionsByAccount: ReadonlyMap<string, readonly ExternalTransactionInput[]>;
  private readonly billsByAccount: ReadonlyMap<string, readonly ExternalBillInput[]>;
  /** Simulates Pluggy's `Item.clientUserId` — set per externalConnectionId so connection-recovery tests can exercise `getConnection`'s `clientUserId` field without real Pluggy access. */
  private readonly clientUserIdByExternalConnectionId: ReadonlyMap<string, string>;

  constructor(options: {
    accounts: readonly ExternalAccountInput[];
    transactionsByAccount: ReadonlyMap<string, readonly ExternalTransactionInput[]>;
    billsByAccount?: ReadonlyMap<string, readonly ExternalBillInput[]>;
    clientUserIdByExternalConnectionId?: ReadonlyMap<string, string>;
  }) {
    this.accounts = options.accounts;
    this.transactionsByAccount = options.transactionsByAccount;
    this.billsByAccount = options.billsByAccount ?? new Map();
    this.clientUserIdByExternalConnectionId = options.clientUserIdByExternalConnectionId ?? new Map();
  }

  async createConnectionToken(
    options: CreateConnectionTokenOptions,
  ): Promise<ConnectionTokenResult> {
    return { connectToken: `mock-connect-token-for-${options.clientUserId}` };
  }

  async getConnection(externalConnectionId: string): Promise<ExternalConnectionStatus> {
    const clientUserId = this.clientUserIdByExternalConnectionId.get(externalConnectionId);
    return {
      externalConnectionId,
      status: "CONNECTED",
      connectorId: "mock-connector",
      connectorName: "Mock Bank",
      ...(clientUserId ? { clientUserId } : {}),
    };
  }

  async listAccounts(_externalConnectionId: string): Promise<readonly ExternalAccountInput[]> {
    return this.accounts;
  }

  async listTransactions(
    externalAccountId: string,
    options: ListTransactionsOptions = {},
  ): Promise<readonly ExternalTransactionInput[]> {
    const all = this.transactionsByAccount.get(externalAccountId) ?? [];
    if (!options.since) return all;
    return all.filter((t) => t.date >= options.since!);
  }

  async listBills(externalAccountId: string): Promise<readonly ExternalBillInput[]> {
    return this.billsByAccount.get(externalAccountId) ?? [];
  }

  async syncConnection(_externalConnectionId: string): Promise<void> {
    // No-op: the mock provider has no server-side sync process to trigger.
  }

  async deleteConnection(_externalConnectionId: string): Promise<void> {
    // No-op.
  }
}
