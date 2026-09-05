import { describe, expect, it } from "vitest";
import type { ExternalAccountInput, ExternalTransactionInput } from "@money-copilot/financial-engine";
import { MockProvider } from "./mock-provider";

const account: ExternalAccountInput = {
  provider: "mock",
  externalAccountId: "mock-account-1",
  connectionExternalId: "mock-connection-1",
  kind: "BANK",
  displayName: "Mock Checking",
  currency: "BRL",
  balanceCents: 100_000,
  balanceCertainty: "ACTUAL",
  lastSyncedAt: "2026-09-05T00:00:00.000Z",
};

const transaction: ExternalTransactionInput = {
  provider: "mock",
  externalTransactionId: "mock-tx-1",
  paymentSourceExternalRef: "mock-account-1",
  amountCents: 5_000,
  direction: "DEBIT",
  financialEffect: "CONSUMPTION",
  certainty: "ACTUAL",
  date: "2026-09-04",
  rawDescription: "Mock Purchase",
  status: "POSTED",
};

describe("MockProvider — deterministic, no network, conforms to OpenFinanceProvider", () => {
  it("issues a deterministic connect token derived from clientUserId", async () => {
    const provider = new MockProvider({ accounts: [], transactionsByAccount: new Map() });
    const result = await provider.createConnectionToken({ clientUserId: "profile-1" });
    expect(result.connectToken).toContain("profile-1");
  });

  it("reports a CONNECTED status for any connection id", async () => {
    const provider = new MockProvider({ accounts: [], transactionsByAccount: new Map() });
    const status = await provider.getConnection("any-id");
    expect(status.status).toBe("CONNECTED");
  });

  it("returns the configured accounts and transactions", async () => {
    const provider = new MockProvider({
      accounts: [account],
      transactionsByAccount: new Map([[account.externalAccountId, [transaction]]]),
    });
    expect(await provider.listAccounts("any-connection")).toEqual([account]);
    expect(await provider.listTransactions(account.externalAccountId)).toEqual([transaction]);
  });

  it("filters transactions by the `since` option", async () => {
    const olderTransaction: ExternalTransactionInput = { ...transaction, date: "2026-08-01" };
    const provider = new MockProvider({
      accounts: [account],
      transactionsByAccount: new Map([[account.externalAccountId, [olderTransaction, transaction]]]),
    });
    const result = await provider.listTransactions(account.externalAccountId, { since: "2026-09-01" });
    expect(result).toEqual([transaction]);
  });

  it("returns an empty bill list when none are configured", async () => {
    const provider = new MockProvider({ accounts: [account], transactionsByAccount: new Map() });
    expect(await provider.listBills(account.externalAccountId)).toEqual([]);
  });
});
