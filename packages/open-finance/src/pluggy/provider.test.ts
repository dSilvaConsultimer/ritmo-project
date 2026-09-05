import { describe, expect, it, vi } from "vitest";
import { ProviderError } from "@money-copilot/financial-engine";
import { PluggyProvider } from "./provider";
import type { PluggyApiClient } from "./client";
import {
  fixtureCardPurchaseTransaction,
  fixtureCreditCardAccount,
  fixtureCreditCardBill,
  fixtureItem,
} from "./fixtures/index";

function fakeClient(overrides: Partial<PluggyApiClient> = {}): PluggyApiClient {
  return {
    createConnectToken: vi.fn().mockResolvedValue({ accessToken: "fixture-connect-token" }),
    fetchItem: vi.fn().mockResolvedValue(fixtureItem),
    fetchAccounts: vi.fn().mockResolvedValue({ results: [fixtureCreditCardAccount], page: 1, total: 1, totalPages: 1 }),
    fetchAccount: vi.fn().mockResolvedValue(fixtureCreditCardAccount),
    fetchAllTransactions: vi.fn().mockResolvedValue([fixtureCardPurchaseTransaction]),
    fetchCreditCardBills: vi
      .fn()
      .mockResolvedValue({ results: [fixtureCreditCardBill], page: 1, total: 1, totalPages: 1 }),
    updateItem: vi.fn().mockResolvedValue(fixtureItem),
    deleteItem: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("PluggyProvider — conforms to the OpenFinanceProvider contract", () => {
  it("creates a connect token via the injected client, mapping accessToken -> connectToken", async () => {
    const client = fakeClient();
    const provider = new PluggyProvider(client);
    const result = await provider.createConnectionToken({ clientUserId: "profile-1" });
    expect(result.connectToken).toBe("fixture-connect-token");
    expect(client.createConnectToken).toHaveBeenCalledWith(undefined, { clientUserId: "profile-1" });
  });

  it("maps an Item's status into our generic ProviderConnectionStatus", async () => {
    const provider = new PluggyProvider(fakeClient());
    const status = await provider.getConnection(fixtureItem.id);
    expect(status.status).toBe("CONNECTED");
    expect(status.connectorName).toBe(fixtureItem.connector.name);
  });

  it("returns canonical ExternalAccountInput objects, never a raw Pluggy Account", async () => {
    const provider = new PluggyProvider(fakeClient());
    const accounts = await provider.listAccounts(fixtureItem.id);
    expect(accounts).toHaveLength(1);
    expect(accounts[0]).not.toHaveProperty("itemId"); // Pluggy's own field name, absent from our DTO
    expect(accounts[0]?.kind).toBe("CREDIT_CARD");
  });

  it("looks up the account's kind before mapping its transactions (so sign/effect mapping is correct)", async () => {
    const client = fakeClient();
    const provider = new PluggyProvider(client);
    const transactions = await provider.listTransactions(fixtureCreditCardAccount.id);
    expect(client.fetchAccount).toHaveBeenCalledWith(fixtureCreditCardAccount.id);
    expect(transactions[0]?.financialEffect).toBe("CONSUMPTION");
  });

  it("uses the provider's full pagination sweep (fetchAllTransactions), not a single page", async () => {
    const client = fakeClient();
    const provider = new PluggyProvider(client);
    await provider.listTransactions(fixtureCreditCardAccount.id, { since: "2026-09-01" });
    expect(client.fetchAllTransactions).toHaveBeenCalledWith(
      fixtureCreditCardAccount.id,
      expect.objectContaining({ dateFrom: "2026-09-01" }),
    );
  });

  it("returns canonical ExternalBillInput objects for bills", async () => {
    const provider = new PluggyProvider(fakeClient());
    const bills = await provider.listBills(fixtureCreditCardAccount.id);
    expect(bills).toHaveLength(1);
    expect(bills[0]?.totalAmountCents).toBe(85_000);
  });

  it("delegates syncConnection to the provider's own refresh mechanism (updateItem)", async () => {
    const client = fakeClient();
    const provider = new PluggyProvider(client);
    await provider.syncConnection(fixtureItem.id);
    expect(client.updateItem).toHaveBeenCalledWith(fixtureItem.id);
  });

  it("delegates deleteConnection to the client", async () => {
    const client = fakeClient();
    const provider = new PluggyProvider(client);
    await provider.deleteConnection(fixtureItem.id);
    expect(client.deleteItem).toHaveBeenCalledWith(fixtureItem.id);
  });

  it("normalizes any client error into a ProviderError before it escapes the adapter", async () => {
    const client = fakeClient({
      fetchItem: vi.fn().mockRejectedValue({ statusCode: 401, message: "Invalid API Key" }),
    });
    const provider = new PluggyProvider(client);
    await expect(provider.getConnection("bad-id")).rejects.toBeInstanceOf(ProviderError);
    await expect(provider.getConnection("bad-id")).rejects.toMatchObject({ code: "AUTHENTICATION_ERROR" });
  });
});
