import { afterEach, describe, expect, it } from "vitest";
import { fixtureProfile, categoryRules as fixtureCategoryRules } from "@money-copilot/financial-engine";
import type { ExternalAccountInput } from "@money-copilot/financial-engine";
import * as repo from "@money-copilot/persistence";
import { createId } from "@money-copilot/shared";
import {
  getFinancialPosition,
  getInstallmentCommitments,
  getConnections,
  getReconciliationCandidates,
  getLifestyleComparison,
  getRecurringCandidates,
  getUncategorizedTransactions,
  getFixedExpensesForProfile,
  getCategoryRuleCount,
  getCategoryRulesList,
} from "./queries";
import { syncConnection } from "./sync";
import { resetProviderRegistry } from "./provider-registry";
import { freshSeededDb, installMockProvider } from "./test-helpers";

const ASOF = "2026-09-05";

afterEach(() => {
  resetProviderRegistry();
});

describe("getFinancialPosition", () => {
  it("is UNKNOWN coverage before any account is connected", async () => {
    const db = await freshSeededDb();
    const position = await getFinancialPosition(db, fixtureProfile.id, ASOF);
    expect(position.coverage).toBe("UNKNOWN");
  });

  it("derives a COMPLETE-coverage position from synced account balances", async () => {
    const db = await freshSeededDb();
    const account: ExternalAccountInput = {
      provider: "mock",
      externalAccountId: "mock-position-account-1",
      connectionExternalId: "mock-position-conn-1",
      kind: "BANK",
      displayName: "Mock Checking",
      currency: "BRL",
      balanceCents: 250_000,
      balanceCertainty: "ACTUAL",
      lastSyncedAt: "2026-09-05T00:00:00.000Z",
    };
    installMockProvider({ accounts: [account], transactionsByAccount: new Map() });
    const connection = {
      id: createId("provider-connection"),
      financialProfileId: fixtureProfile.id,
      provider: "mock" as const,
      externalConnectionId: account.connectionExternalId,
      status: "PENDING" as const,
      createdAt: "2026-09-05",
      updatedAt: "2026-09-05",
    };
    await repo.upsertProviderConnection(db, connection);
    await syncConnection(db, fixtureProfile.id, connection.id);

    const position = await getFinancialPosition(db, fixtureProfile.id, ASOF);
    expect(position.coverage).toBe("COMPLETE");
    expect(position.cashBalance.amount?.cents).toBe(250_000);
  });
});

describe("getInstallmentCommitments", () => {
  it("reports the old debt's current-period amount and flags the incomplete schedule", async () => {
    const db = await freshSeededDb();
    const commitments = await getInstallmentCommitments(db, fixtureProfile.id, ASOF);
    expect(commitments.currentPeriodAmount.cents).toBe(140_000);
    expect(commitments.hasIncompleteData).toBe(true);
  });
});

describe("getConnections", () => {
  it("returns an empty list for a profile with no provider connections", async () => {
    const db = await freshSeededDb();
    expect(await getConnections(db, fixtureProfile.id)).toEqual([]);
  });
});

describe("getReconciliationCandidates", () => {
  it("is empty for the clean fixture (no unresolved possible duplicates)", async () => {
    const db = await freshSeededDb();
    expect(await getReconciliationCandidates(db, fixtureProfile.id, ASOF)).toEqual([]);
  });
});

describe("getRecurringCandidates", () => {
  it("finds no recurring pattern in the fixture's single-month transaction set", async () => {
    const db = await freshSeededDb();
    expect(await getRecurringCandidates(db, fixtureProfile.id, ASOF)).toEqual([]);
  });
});

describe("getFixedExpensesForProfile", () => {
  it("returns the fixture's confirmed recurring commitments, with dueDayOfMonth absent by default", async () => {
    const db = await freshSeededDb();
    const expenses = await getFixedExpensesForProfile(db, fixtureProfile.id, ASOF);
    expect(expenses.length).toBeGreaterThan(0);
    expect(expenses.some((e) => e.label.toLowerCase().includes("housing") || e.category === "Housing")).toBe(true);
    for (const expense of expenses) {
      expect(expense.dueDayOfMonth).toBeUndefined();
    }
  });
});

describe("getCategoryRuleCount", () => {
  it("matches the real global rule set, not a hardcoded number", async () => {
    const db = await freshSeededDb();
    expect(await getCategoryRuleCount(db)).toBe(fixtureCategoryRules.length);
  });
});

describe("getCategoryRulesList", () => {
  it("returns the same count as getCategoryRuleCount, sorted by descending priority", async () => {
    const db = await freshSeededDb();
    const rules = await getCategoryRulesList(db);
    expect(rules.length).toBe(fixtureCategoryRules.length);
    for (let i = 1; i < rules.length; i++) {
      expect(rules[i - 1]!.priority).toBeGreaterThanOrEqual(rules[i]!.priority);
    }
  });
});

describe("getUncategorizedTransactions", () => {
  it("flags the PagSeguro transaction as uncategorized", async () => {
    const db = await freshSeededDb();
    const uncategorized = await getUncategorizedTransactions(db, fixtureProfile.id, ASOF);
    expect(uncategorized).toHaveLength(1);
    expect(uncategorized[0]?.rawMerchant).toBe("PAGSEGURO");
  });
});

describe("getLifestyleComparison", () => {
  it("reports both current and independent-living scenarios as SUSTAINABLE for the fixture", async () => {
    const db = await freshSeededDb();
    const comparison = await getLifestyleComparison(db, fixtureProfile.id, ASOF);
    expect(comparison.currentViability).toBe("SUSTAINABLE");
    expect(comparison.independentViability).toBe("SUSTAINABLE");
  });
});
