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
} from "../provider";
import { getPluggyClient, type PluggyApiClient } from "./client";
import { normalizePluggyError } from "./errors";
import {
  mapPluggyAccountToExternalAccountInput,
  mapPluggyBillToExternalBillInput,
  mapPluggyTransactionToExternalTransactionInput,
  PLUGGY_PROVIDER_NAME,
} from "./mappers";
import { mapPluggyItemStatus } from "./status";

/**
 * Adapts Pluggy's REST API (via the official `pluggy-sdk` client) to the
 * provider-neutral `OpenFinanceProvider` contract. No Pluggy response
 * object ever crosses this class's public methods unmapped — see
 * `pluggy/mappers.ts`. Accepts an injected client so tests never need
 * network access or real credentials (`getPluggyClient()` is only called
 * when no client is passed in, i.e. in production).
 */
export class PluggyProvider implements OpenFinanceProvider {
  readonly name = PLUGGY_PROVIDER_NAME;
  private readonly client: PluggyApiClient;

  constructor(client: PluggyApiClient = getPluggyClient()) {
    this.client = client;
  }

  async createConnectionToken(
    options: CreateConnectionTokenOptions,
  ): Promise<ConnectionTokenResult> {
    try {
      const result = await this.client.createConnectToken(options.externalConnectionId, {
        ...(options.webhookUrl ? { webhookUrl: options.webhookUrl } : {}),
        clientUserId: options.clientUserId,
      });
      return { connectToken: result.accessToken };
    } catch (error) {
      throw normalizePluggyError(error);
    }
  }

  async getConnection(externalConnectionId: string): Promise<ExternalConnectionStatus> {
    try {
      const item = await this.client.fetchItem(externalConnectionId);
      return {
        externalConnectionId: item.id,
        status: mapPluggyItemStatus(item.status),
        connectorId: String(item.connector.id),
        connectorName: item.connector.name,
        ...(item.error ? { errorCode: item.error.code, errorMessage: item.error.message } : {}),
        ...(item.consentExpiresAt
          ? { consentExpiresAt: new Date(item.consentExpiresAt).toISOString() }
          : {}),
        ...(item.lastUpdatedAt
          ? { providerLastUpdatedAt: new Date(item.lastUpdatedAt).toISOString() }
          : {}),
      };
    } catch (error) {
      throw normalizePluggyError(error);
    }
  }

  async listAccounts(externalConnectionId: string): Promise<readonly ExternalAccountInput[]> {
    try {
      const page = await this.client.fetchAccounts(externalConnectionId);
      return page.results.map(mapPluggyAccountToExternalAccountInput);
    } catch (error) {
      throw normalizePluggyError(error);
    }
  }

  async listTransactions(
    externalAccountId: string,
    options: ListTransactionsOptions = {},
  ): Promise<readonly ExternalTransactionInput[]> {
    try {
      const account = await this.client.fetchAccount(externalAccountId);
      const accountKind = account.type === "CREDIT" ? "CREDIT_CARD" : "BANK";

      const transactions = await this.client.fetchAllTransactions(externalAccountId, {
        ...(options.since ? { dateFrom: options.since } : {}),
        ...(options.externalTransactionIds ? { ids: [...options.externalTransactionIds] } : {}),
      });

      return transactions.map((t) => mapPluggyTransactionToExternalTransactionInput(t, accountKind));
    } catch (error) {
      throw normalizePluggyError(error);
    }
  }

  async listBills(externalAccountId: string): Promise<readonly ExternalBillInput[]> {
    try {
      const page = await this.client.fetchCreditCardBills(externalAccountId);
      return page.results.map((bill) => mapPluggyBillToExternalBillInput(bill, externalAccountId));
    } catch (error) {
      throw normalizePluggyError(error);
    }
  }

  async syncConnection(externalConnectionId: string): Promise<void> {
    try {
      await this.client.updateItem(externalConnectionId);
    } catch (error) {
      throw normalizePluggyError(error);
    }
  }

  async deleteConnection(externalConnectionId: string): Promise<void> {
    try {
      await this.client.deleteItem(externalConnectionId);
    } catch (error) {
      throw normalizePluggyError(error);
    }
  }
}
