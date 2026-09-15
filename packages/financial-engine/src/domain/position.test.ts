import { describe, expect, it } from "vitest";
import { createId } from "@money-copilot/shared";
import * as M from "../money/index";
import { actual, unknownAmount } from "./certainty";
import type { PaymentSource } from "./transaction";
import {
  buildFinancialPositionFromAccounts,
  computeLiquidityAwareSafeToSpend,
  unknownFinancialPosition,
  type FinancialPosition,
} from "./position";

const profileId = createId("financial-profile");
const planSafeToSpend = M.fromReais(2_171.11);

describe("FinancialPosition — unknown liquidity", () => {
  it("never pretends the plan number is real cash when liquidity is unknown", () => {
    const position = unknownFinancialPosition(profileId, "2026-09-05");
    const result = computeLiquidityAwareSafeToSpend(planSafeToSpend, position);
    expect(result.liquidityAwareSafeToSpend).toBeNull();
    expect(result.confidence).toBe("UNKNOWN");
    expect(result.planSafeToSpend.cents).toBe(planSafeToSpend.cents);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});

describe("FinancialPosition — known cash", () => {
  const knownPosition: FinancialPosition = {
    id: createId("financial-position"),
    financialProfileId: profileId,
    asOf: "2026-09-05",
    cashBalance: actual(M.fromReais(1_000)),
    cardOutstandingBalance: actual(M.fromReais(200)),
    otherLiabilities: actual(M.ZERO),
    reservedBalance: unknownAmount(),
    automaticallyInvestedBalance: unknownAmount(),
    source: "manual entry",
    coverage: "COMPLETE",
  };

  it("(test 1) computes a positive Safe-to-Spend directly from current liquidity, with no declared income at all", () => {
    // planSafeToSpend here stands in for a snapshot with zero declared
    // income/commitments — exactly the real bug (DEC-130): a healthy real
    // balance must not be capped by an empty declared plan.
    const result = computeLiquidityAwareSafeToSpend(M.ZERO, knownPosition);
    expect(result.basis).toBe("LIQUIDITY_AWARE");
    // 1000 - 200 (card) = 800.
    expect(result.liquidityAwareSafeToSpend?.cents).toBe(M.fromReais(800).cents);
    expect(result.recommendedTotal.cents).toBe(M.fromReais(800).cents);
    expect(result.confidence).toBe("KNOWN");
  });

  it("(test 8) an outstanding credit-card balance reduces liquidity exactly once", () => {
    const result = computeLiquidityAwareSafeToSpend(planSafeToSpend, knownPosition);
    expect(result.liquidityAwareSafeToSpend?.cents).toBe(M.fromReais(800).cents);
    const cardComponent = result.components.find((c) => c.type === "CARD_OBLIGATIONS");
    expect(cardComponent?.amount.cents).toBe(M.fromReais(-200).cents);
    // Exactly one CARD_OBLIGATIONS line — never split across multiple entries.
    expect(result.components.filter((c) => c.type === "CARD_OBLIGATIONS")).toHaveLength(1);
  });

  it("DEC-130: real liquidity is now authoritative even when far above the (broken/empty) plan — no more min(plan, liquidity)", () => {
    const flushPosition: FinancialPosition = {
      ...knownPosition,
      cashBalance: actual(M.fromReais(50_000)),
      cardOutstandingBalance: actual(M.ZERO),
    };
    const result = computeLiquidityAwareSafeToSpend(planSafeToSpend, flushPosition);
    // Previously this asserted the OLD min(plan, liquidity) behavior
    // (returning the smaller plan figure) — exactly the bug DEC-130 fixes.
    expect(result.liquidityAwareSafeToSpend?.cents).toBe(M.fromReais(50_000).cents);
    expect(result.basis).toBe("LIQUIDITY_AWARE");
    // The plan figure is still reported, just no longer authoritative.
    expect(result.planSafeToSpend.cents).toBe(planSafeToSpend.cents);
  });

  it("marks confidence PARTIAL and warns when card outstanding balance is unknown", () => {
    const partialPosition: FinancialPosition = {
      ...knownPosition,
      cardOutstandingBalance: unknownAmount(),
    };
    const result = computeLiquidityAwareSafeToSpend(planSafeToSpend, partialPosition);
    expect(result.confidence).toBe("PARTIAL");
    expect(result.liquidityAwareSafeToSpend).not.toBeNull();
    expect(result.warnings.some((w) => w.toLowerCase().includes("card"))).toBe(true);
  });

  it("(test 10) falls back to PLAN_BASED when there is no reliable current liquidity at all", () => {
    const unknown = unknownFinancialPosition(profileId, "2026-09-05");
    const result = computeLiquidityAwareSafeToSpend(planSafeToSpend, unknown);
    expect(result.basis).toBe("PLAN_BASED");
    expect(result.liquidityAwareSafeToSpend).toBeNull();
    expect(result.recommendedTotal.cents).toBe(planSafeToSpend.cents);
  });

  it("explainability: every component sums exactly to the reported total", () => {
    const result = computeLiquidityAwareSafeToSpend(planSafeToSpend, knownPosition, {
      upcomingFixedCommitments: M.fromReais(100),
      variableBudgets: M.fromReais(40),
      upcomingEventReservations: M.fromReais(50),
      debtCommitments: M.fromReais(25),
      futureIncome: M.fromReais(3_000),
      protectedSavings: M.fromReais(200),
    });
    const sum = result.components.reduce((acc, c) => M.add(acc, c.amount), M.ZERO);
    expect(sum.cents).toBe(result.liquidityAwareSafeToSpend?.cents);
    expect(result.components.map((c) => c.type)).toEqual([
      "CURRENT_AVAILABLE_CASH",
      "CARD_OBLIGATIONS",
      "UPCOMING_FIXED_COMMITMENTS",
      "VARIABLE_BUDGETS",
      "UPCOMING_EVENT_RESERVATIONS",
      "DEBT_COMMITMENTS",
      "FUTURE_CONFIRMED_INCOME",
      "PROTECTED_SAVINGS",
    ]);
  });

  it("(DEC-130 corrected) 'Já comprometido' excludes variable budgets, protected savings, and future income", () => {
    const result = computeLiquidityAwareSafeToSpend(planSafeToSpend, knownPosition, {
      upcomingFixedCommitments: M.fromReais(100),
      variableBudgets: M.fromReais(40),
      upcomingEventReservations: M.fromReais(50),
      debtCommitments: M.fromReais(25),
      futureIncome: M.fromReais(3_000),
      protectedSavings: M.fromReais(200),
    });
    // card (200) + fixed (100) + events (50) + debt (25) = 375, never the
    // variable budget, protected savings, or future income figures.
    expect(result.committedForwardTotal?.cents).toBe(M.fromReais(375).cents);
  });
});

function account(overrides: Partial<PaymentSource>): PaymentSource {
  return {
    id: createId("payment-source"),
    label: "Test Account",
    type: "DEBIT",
    ...overrides,
  };
}

describe("buildFinancialPositionFromAccounts", () => {
  it("returns UNKNOWN coverage when no accounts are connected", () => {
    const position = buildFinancialPositionFromAccounts([], profileId, "2026-09-05", "pluggy");
    expect(position.coverage).toBe("UNKNOWN");
    expect(position.cashBalance.certainty).toBe("UNKNOWN");
  });

  it("returns COMPLETE coverage and sums balances when every account is known", () => {
    const accounts: PaymentSource[] = [
      account({ type: "DEBIT", balance: actual(M.fromReais(1_000)) }),
      account({ type: "DEBIT", balance: actual(M.fromReais(500)) }),
      account({ type: "CREDIT_CARD", balance: actual(M.fromReais(300)) }),
    ];
    const position = buildFinancialPositionFromAccounts(accounts, profileId, "2026-09-05", "pluggy");
    expect(position.coverage).toBe("COMPLETE");
    expect(position.cashBalance.amount?.cents).toBe(M.fromReais(1_500).cents);
    expect(position.cashBalance.certainty).toBe("ACTUAL");
    expect(position.cardOutstandingBalance.amount?.cents).toBe(M.fromReais(300).cents);
  });

  it("returns PARTIAL coverage and an ESTIMATED certainty when some accounts have no known balance", () => {
    const accounts: PaymentSource[] = [
      account({ type: "DEBIT", balance: actual(M.fromReais(1_000)) }),
      account({ type: "DEBIT", balance: unknownAmount() }),
    ];
    const position = buildFinancialPositionFromAccounts(accounts, profileId, "2026-09-05", "pluggy");
    expect(position.coverage).toBe("PARTIAL");
    expect(position.cashBalance.certainty).toBe("ESTIMATED");
    expect(position.cashBalance.amount?.cents).toBe(M.fromReais(1_000).cents);
  });

  it("never invents otherLiabilities from connected accounts alone", () => {
    const accounts: PaymentSource[] = [account({ type: "DEBIT", balance: actual(M.fromReais(1_000)) })];
    const position = buildFinancialPositionFromAccounts(accounts, profileId, "2026-09-05", "pluggy");
    expect(position.otherLiabilities.certainty).toBe("UNKNOWN");
  });

  it("degrades liquidity-aware confidence to PARTIAL when coverage is incomplete, even if known amounts compute cleanly", () => {
    const accounts: PaymentSource[] = [
      account({ type: "DEBIT", balance: actual(M.fromReais(1_000)) }),
      account({ type: "CREDIT_CARD", balance: unknownAmount() }),
    ];
    const position = buildFinancialPositionFromAccounts(accounts, profileId, "2026-09-05", "pluggy");
    expect(position.coverage).toBe("PARTIAL");
    const result = computeLiquidityAwareSafeToSpend(planSafeToSpend, position);
    expect(result.confidence).toBe("PARTIAL");
  });
});

describe("buildFinancialPositionFromAccounts — reserved / available balance (DEC-130, corrected)", () => {
  it("(evidence-based, DEC-130 update) subtracts reservedBalance exactly once EVEN WHEN availableBalance equals the raw balance — the real observed Pluggy payload for this profile shows availableBalance/closingBalance identical to balance despite a genuine active reservation, so availableBalance cannot be assumed to already exclude it", () => {
    const accounts: PaymentSource[] = [
      account({
        type: "DEBIT",
        balance: actual(M.fromReais(35_995.75)),
        // Matches the REAL fixtureBankAccountWithReservedBalance payload:
        // availableBalance (Pluggy's closingBalance) is identical to
        // balance, not lower — it does NOT exclude the reservation here.
        availableBalance: actual(M.fromReais(35_995.75)),
        reservedBalance: actual(M.fromReais(1_000.04)),
      }),
    ];
    const position = buildFinancialPositionFromAccounts(accounts, profileId, "2026-09-05", "pluggy");
    // 35,995.75 - 1,000.04 = 34,995.71 — subtracted once, regardless of
    // which balance field was preferred for the base figure.
    expect(position.cashBalance.amount?.cents).toBe(M.fromReais(34_995.71).cents);
    expect(position.reservedBalance.amount?.cents).toBe(M.fromReais(1_000.04).cents);
  });

  it("still only subtracts reservedBalance ONCE even when availableBalance is genuinely lower than balance (never double-subtracted regardless of the gap's cause)", () => {
    const accounts: PaymentSource[] = [
      account({
        type: "DEBIT",
        balance: actual(M.fromReais(35_995.75)),
        availableBalance: actual(M.fromReais(34_995.71)),
        reservedBalance: actual(M.fromReais(1_000.04)),
      }),
    ];
    const position = buildFinancialPositionFromAccounts(accounts, profileId, "2026-09-05", "pluggy");
    // Even though availableBalance here already looks like it might exclude
    // the reservation, the safe/conservative rule always subtracts it once
    // more from whichever cash figure is used — 34,995.71 - 1,000.04.
    expect(position.cashBalance.amount?.cents).toBe(M.fromReais(33_995.67).cents);
  });

  it("falls back to balance minus reservedBalance exactly once when no availableBalance is reported", () => {
    const accounts: PaymentSource[] = [
      account({
        type: "DEBIT",
        balance: actual(M.fromReais(35_995.75)),
        reservedBalance: actual(M.fromReais(1_000.04)),
      }),
    ];
    const position = buildFinancialPositionFromAccounts(accounts, profileId, "2026-09-05", "pluggy");
    expect(position.cashBalance.amount?.cents).toBe(M.fromReais(34_995.71).cents);
  });

  it("(test 13) captures automaticallyInvestedBalance for explainability without ever subtracting it from cashBalance", () => {
    const accounts: PaymentSource[] = [
      account({
        type: "DEBIT",
        balance: actual(M.fromReais(35_995.75)),
        automaticallyInvestedBalance: actual(M.fromReais(3_599.57)),
      }),
    ];
    const position = buildFinancialPositionFromAccounts(accounts, profileId, "2026-09-05", "pluggy");
    expect(position.cashBalance.amount?.cents).toBe(M.fromReais(35_995.75).cents);
    expect(position.automaticallyInvestedBalance.amount?.cents).toBe(M.fromReais(3_599.57).cents);
  });

  it("(test 13) automaticallyInvestedBalance is never double-counted even alongside a lower availableBalance and a reservedBalance on the same account", () => {
    const accounts: PaymentSource[] = [
      account({
        type: "DEBIT",
        balance: actual(M.fromReais(35_995.75)),
        availableBalance: actual(M.fromReais(35_995.75)),
        reservedBalance: actual(M.fromReais(1_000.04)),
        automaticallyInvestedBalance: actual(M.fromReais(3_599.57)),
      }),
    ];
    const position = buildFinancialPositionFromAccounts(accounts, profileId, "2026-09-05", "pluggy");
    // Only the reservation is ever subtracted; the invested amount neither
    // adds on top nor gets subtracted a second time.
    expect(position.cashBalance.amount?.cents).toBe(M.fromReais(34_995.71).cents);
    expect(position.automaticallyInvestedBalance.amount?.cents).toBe(M.fromReais(3_599.57).cents);
  });

  it("(test 12) reservedBalance is subtracted exactly once even across multiple bank accounts, never accumulated per-field pass", () => {
    const accounts: PaymentSource[] = [
      account({
        id: createId("payment-source"),
        type: "DEBIT",
        balance: actual(M.fromReais(10_000)),
        reservedBalance: actual(M.fromReais(1_000)),
      }),
      account({
        id: createId("payment-source"),
        type: "DEBIT",
        balance: actual(M.fromReais(5_000)),
        reservedBalance: actual(M.fromReais(500)),
      }),
    ];
    const position = buildFinancialPositionFromAccounts(accounts, profileId, "2026-09-05", "pluggy");
    // (10,000 - 1,000) + (5,000 - 500) = 13,500 — each account's own
    // reservation subtracted exactly once from that account's own cash.
    expect(position.cashBalance.amount?.cents).toBe(M.fromReais(13_500).cents);
    expect(position.reservedBalance.amount?.cents).toBe(M.fromReais(1_500).cents);
  });

  it("reports reservedBalance/automaticallyInvestedBalance as UNKNOWN (not zero) when no account reports them", () => {
    const accounts: PaymentSource[] = [account({ type: "DEBIT", balance: actual(M.fromReais(1_000)) })];
    const position = buildFinancialPositionFromAccounts(accounts, profileId, "2026-09-05", "pluggy");
    expect(position.reservedBalance.certainty).toBe("UNKNOWN");
    expect(position.automaticallyInvestedBalance.certainty).toBe("UNKNOWN");
  });
});
