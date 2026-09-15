import { describe, expect, it } from "vitest";
import type { Id } from "@money-copilot/shared";
import type { HomeData } from "@/functions/home";
import { toHomeViewModel } from "./home";

function feId(raw: string): Id<"fixed-expense"> {
  return raw as Id<"fixed-expense">;
}
function alertId(raw: string): Id<"alert"> {
  return raw as Id<"alert">;
}
function recommendationId(raw: string): Id<"recommendation"> {
  return raw as Id<"recommendation">;
}

function baseData(overrides: Partial<HomeData> = {}): HomeData {
  return {
    displayName: "Douglas",
    asOfDate: "2026-09-05",
    safeToSpendCents: 217_111,
    safeToSpendBasis: "PLAN_BASED",
    daysRemainingInMonth: 26,
    incomeCents: 1_500_000,
    committedCents: 598_000,
    fixedExpenses: [],
    topAlert: null,
    topPendingRecommendation: null,
    ...overrides,
  };
}

describe("toHomeViewModel", () => {
  it("formats the core figures and reframes the month-remaining copy honestly (no invented pay-date)", () => {
    const vm = toHomeViewModel(baseData());
    expect(vm.safeToSpendLabel).toBe("R$ 2.171,11");
    expect(vm.endOfMonthDays).toBe(26);
    expect(vm.endOfMonthLabel).toBe("Fim do mês em 30/09");
    expect(vm.todayLabel).toBe("Hoje, 05 de setembro");
  });

  it("(gap #1) a fixed expense with no known due day gets a neutral badge, never a guessed day", () => {
    const vm = toHomeViewModel(
      baseData({
        fixedExpenses: [
          {
            id: feId("fe-1"),
            label: "Internet",
            category: "Housing",
            amountCents: 12_000,
            dueDayOfMonth: null,
          },
        ],
      }),
    );
    expect(vm.upcoming[0]!.dueDayBadge).toBe("–");
    expect(vm.upcoming[0]!.detail).toBe("Housing"); // no "vence dia X" clause fabricated
  });

  it("a fixed expense with a known due day shows it in both the badge and the detail line", () => {
    const vm = toHomeViewModel(
      baseData({
        fixedExpenses: [
          {
            id: feId("fe-1"),
            label: "Aluguel",
            category: "Housing",
            amountCents: 180_000,
            dueDayOfMonth: 5,
          },
        ],
      }),
    );
    expect(vm.upcoming[0]!.dueDayBadge).toBe("05");
    expect(vm.upcoming[0]!.detail).toBe("Housing · vence dia 5");
  });

  it("sorts known due-days before unknown ones, and caps at 3", () => {
    const vm = toHomeViewModel(
      baseData({
        fixedExpenses: [
          {
            id: feId("unknown-1"),
            label: "A",
            category: "X",
            amountCents: 100,
            dueDayOfMonth: null,
          },
          { id: feId("known-10"), label: "B", category: "X", amountCents: 100, dueDayOfMonth: 10 },
          { id: feId("known-5"), label: "C", category: "X", amountCents: 100, dueDayOfMonth: 5 },
          { id: feId("known-20"), label: "D", category: "X", amountCents: 100, dueDayOfMonth: 20 },
        ],
      }),
    );
    expect(vm.upcoming.map((c) => c.id)).toEqual(["known-5", "known-10", "known-20"]);
  });

  it("prefers an active alert over a pending recommendation for the insight card", () => {
    const vm = toHomeViewModel(
      baseData({
        topAlert: { id: alertId("a1"), title: "Seu Safe-to-Spend caiu.", severity: "ATTENTION" },
        topPendingRecommendation: {
          id: recommendationId("r1"),
          title: "Recurring subscription: SPOTIFY",
          description: null,
        },
      }),
    );
    expect(vm.insight?.title).toBe("Seu Safe-to-Spend caiu.");
  });

  it("falls back to a pending recommendation when there is no active alert", () => {
    const vm = toHomeViewModel(
      baseData({
        topPendingRecommendation: {
          id: recommendationId("r1"),
          title: "Recurring subscription: SPOTIFY",
          description: "R$ 19,90/mês",
        },
      }),
    );
    expect(vm.insight?.title).toBe("Recurring subscription: SPOTIFY");
    expect(vm.insight?.detail).toBe("R$ 19,90/mês");
  });

  it("shows an honest calm empty state — never a fabricated insight — when neither exists", () => {
    const vm = toHomeViewModel(baseData());
    expect(vm.insight).toBeNull();
  });

  it("tone reflects an IMPORTANT active alert or a negative Safe-to-Spend, never invented", () => {
    expect(toHomeViewModel(baseData()).toneOk).toBe(true);
    expect(toHomeViewModel(baseData({ safeToSpendCents: -100 })).toneOk).toBe(false);
    expect(
      toHomeViewModel(
        baseData({ topAlert: { id: alertId("a1"), title: "x", severity: "IMPORTANT" } }),
      ).toneOk,
    ).toBe(false);
    expect(
      toHomeViewModel(baseData({ topAlert: { id: alertId("a1"), title: "x", severity: "INFO" } }))
        .toneOk,
    ).toBe(true);
  });
});
