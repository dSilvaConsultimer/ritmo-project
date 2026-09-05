import { describe, expect, it } from "vitest";
import { createId } from "@money-copilot/shared";
import * as M from "../money/index";
import type { FinancialTransaction, PaymentSource } from "./transaction";
import {
  computeFingerprint,
  excludedTransactionIds,
  findTransactionDuplicates,
  matchTransactions,
} from "./reconciliation";

const nubank: PaymentSource = { id: createId("payment-source"), label: "Nubank", type: "CREDIT_CARD" };

function tx(overrides: Partial<FinancialTransaction> = {}): FinancialTransaction {
  return {
    id: createId("transaction"),
    financialProfileId: createId("financial-profile"),
    paymentSource: nubank,
    date: "2026-09-04",
    amount: M.fromReais(250),
    direction: "DEBIT",
    rawDescription: "RESTAURANT X",
    normalizedDescription: "RESTAURANT X",
    rawMerchant: "RESTAURANT X",
    normalizedMerchant: "RESTAURANT X",
    status: "POSTED",
    certainty: "ACTUAL",
    financialEffect: "CONSUMPTION",
    category: "Food",
    origin: "MANUAL",
    createdAt: "2026-09-04",
    updatedAt: "2026-09-04",
    ...overrides,
  };
}

describe("computeFingerprint", () => {
  it("is deterministic for identical inputs", () => {
    const a = tx();
    const b = tx({ id: createId("transaction") });
    expect(computeFingerprint(a)).toBe(computeFingerprint(b));
  });
});

describe("matchTransactions", () => {
  it("detects a HIGH-confidence duplicate via matching provider external id", () => {
    const a = tx({ externalProviderId: "pluggy", externalTransactionId: "abc-123" });
    const b = tx({
      id: createId("transaction"),
      externalProviderId: "pluggy",
      externalTransactionId: "abc-123",
      origin: "IMPORTED",
    });
    expect(matchTransactions(a, b)).toEqual({ confidence: "HIGH", method: "PROVIDER_ID" });
  });

  it("detects a HIGH-confidence duplicate via an exact deterministic fingerprint", () => {
    const a = tx();
    const b = tx({ id: createId("transaction"), origin: "IMPORTED" });
    expect(matchTransactions(a, b)).toEqual({ confidence: "HIGH", method: "FINGERPRINT" });
  });

  it("detects a MEDIUM-confidence match for a manual entry reconciled by a next-day import", () => {
    const manual = tx({ origin: "MANUAL", date: "2026-09-04" });
    const imported = tx({
      id: createId("transaction"),
      origin: "IMPORTED",
      date: "2026-09-05",
      externalProviderId: "pluggy",
      externalTransactionId: "xyz-999",
    });
    const result = matchTransactions(manual, imported);
    expect(result.confidence).toBe("MEDIUM");
  });

  it("does NOT report a confident match when amount or merchant differs", () => {
    const a = tx();
    const b = tx({ id: createId("transaction"), amount: M.fromReais(999) });
    expect(matchTransactions(a, b).confidence).toBe("NONE");
  });

  it("reports LOW confidence rather than a false positive when only amount/direction agree", () => {
    const a = tx({ normalizedMerchant: "RESTAURANT X", date: "2026-09-01" });
    const b = tx({
      id: createId("transaction"),
      normalizedMerchant: "A COMPLETELY DIFFERENT PLACE",
      date: "2026-09-20",
    });
    expect(matchTransactions(a, b).confidence).toBe("LOW");
  });
});

describe("pending -> posted reconciliation", () => {
  it("recognizes a PENDING record and its later POSTED version as the same movement", () => {
    const pending = tx({
      status: "PENDING",
      date: "2026-09-04",
      externalProviderId: "pluggy",
      externalTransactionId: "auth-001",
    });
    const posted = tx({
      id: createId("transaction"),
      status: "POSTED",
      date: "2026-09-04",
      externalProviderId: "pluggy",
      externalTransactionId: "auth-001",
    });
    const links = findTransactionDuplicates([pending, posted]);
    expect(links).toHaveLength(1);
    expect(links[0]?.status).toBe("CONFIRMED");

    const excluded = excludedTransactionIds(links);
    expect(excluded.has(pending.id)).not.toBe(excluded.has(posted.id));
  });
});

describe("findTransactionDuplicates", () => {
  it("auto-confirms a provider external-id duplicate", () => {
    const a = tx({ externalProviderId: "pluggy", externalTransactionId: "same-id" });
    const b = tx({
      id: createId("transaction"),
      externalProviderId: "pluggy",
      externalTransactionId: "same-id",
      origin: "IMPORTED",
    });
    const links = findTransactionDuplicates([a, b]);
    expect(links).toHaveLength(1);
    expect(links[0]?.status).toBe("CONFIRMED");
    expect(links[0]?.method).toBe("PROVIDER_ID");
  });

  it("auto-confirms an exact fallback-fingerprint duplicate", () => {
    const a = tx();
    const b = tx({ id: createId("transaction") });
    const links = findTransactionDuplicates([a, b]);
    expect(links).toHaveLength(1);
    expect(links[0]?.status).toBe("CONFIRMED");
    expect(links[0]?.method).toBe("FINGERPRINT");
  });

  it("reconciles a manual transaction with a later-imported equivalent", () => {
    const manual = tx({ origin: "MANUAL", date: "2026-09-04" });
    const imported = tx({ id: createId("transaction"), origin: "IMPORTED", date: "2026-09-05" });
    const links = findTransactionDuplicates([manual, imported]);
    expect(links).toHaveLength(1);
    expect(links[0]?.status).toBe("CONFIRMED");

    const excluded = excludedTransactionIds(links);
    // Exactly one side is excluded from downstream sums — never both, never neither.
    expect(excluded.has(manual.id)).not.toBe(excluded.has(imported.id));
  });

  it("does NOT silently merge a low-confidence possible duplicate", () => {
    const a = tx({ normalizedMerchant: "RESTAURANT X", date: "2026-09-01" });
    const b = tx({
      id: createId("transaction"),
      normalizedMerchant: "A COMPLETELY DIFFERENT PLACE",
      date: "2026-09-20",
    });
    const links = findTransactionDuplicates([a, b]);
    expect(links).toHaveLength(1);
    expect(links[0]?.status).toBe("CANDIDATE");

    const excluded = excludedTransactionIds(links);
    expect(excluded.size).toBe(0);
  });
});
