import { describe, expect, it } from "vitest";
import type { Id } from "@money-copilot/shared";
import type { InsightsData } from "@/functions/insights";
import { toInsightsViewModel } from "./insights";

function alertId(raw: string): Id<"alert"> {
  return raw as Id<"alert">;
}
function recommendationId(raw: string): Id<"recommendation"> {
  return raw as Id<"recommendation">;
}

function baseData(overrides: Partial<InsightsData> = {}): InsightsData {
  return {
    asOfDate: "2026-09-05",
    alerts: [],
    pendingRecommendations: [],
    ...overrides,
  };
}

describe("toInsightsViewModel", () => {
  it("shows an honest calm empty state when there is nothing real to report", () => {
    const vm = toInsightsViewModel(baseData());
    expect(vm.cards).toEqual([]);
    expect(vm.summaryTitle).toBe("Nenhuma novidade esta semana");
  });

  it("builds a specific, evidence-grounded detail sentence for a Safe-to-Spend drop, never a placeholder", () => {
    const vm = toInsightsViewModel(
      baseData({
        alerts: [
          {
            id: alertId("a1"),
            type: "SAFE_TO_SPEND_MATERIAL_DROP",
            severity: "ATTENTION",
            title: "Seu Safe-to-Spend caiu após novas despesas.",
            evidence: {
              kind: "SAFE_TO_SPEND_MATERIAL_DROP",
              previousCents: 214_000,
              currentCents: 184_200,
              deltaCents: -29_800,
              relativeDropRatio: 0.139,
            },
          },
        ],
      }),
    );
    expect(vm.cards[0]!.tag).toBe("Safe-to-Spend");
    expect(vm.cards[0]!.tom).toBe("atencao");
    expect(vm.cards[0]!.detalhe).toBe("De R$ 2.140,00 para R$ 1.842,00.");
  });

  it("maps INFO severity to a neutral tone, and ATTENTION/IMPORTANT to atencao", () => {
    const vm = toInsightsViewModel(
      baseData({
        alerts: [
          {
            id: alertId("a1"),
            type: "STALE_CONCIERGE_PLAN",
            severity: "INFO",
            title: "x",
            evidence: {
              kind: "STALE_CONCIERGE_PLAN",
              savedPlanId: "p1",
              planLabel: "Plano de outubro",
              savedAt: "2026-08-01",
            },
          },
        ],
      }),
    );
    expect(vm.cards[0]!.tom).toBe("neutro");
    expect(vm.cards[0]!.detalhe).toBe('O plano "Plano de outubro" pode estar desatualizado.');
  });

  it("shows real pending recommendations with a neutral tone and their real description", () => {
    const vm = toInsightsViewModel(
      baseData({
        pendingRecommendations: [
          {
            id: recommendationId("r1"),
            type: "CANCEL_RECURRING_COST",
            title: "Recurring subscription: SPOTIFY",
            description: "R$ 21,90/mês recorrente identificado.",
            projectedMonthlyImpactCents: 2_190,
          },
        ],
      }),
    );
    expect(vm.cards[0]!.tag).toBe("Recorrência");
    expect(vm.cards[0]!.tom).toBe("neutro");
    expect(vm.cards[0]!.detalhe).toBe("R$ 21,90/mês recorrente identificado.");
  });

  it("falls back to the real projected impact figure when a recommendation has no description", () => {
    const vm = toInsightsViewModel(
      baseData({
        pendingRecommendations: [
          {
            id: recommendationId("r1"),
            type: "REVIEW_RECURRING_COST",
            title: "Review: NETFLIX",
            description: null,
            projectedMonthlyImpactCents: 4_590,
          },
        ],
      }),
    );
    expect(vm.cards[0]!.detalhe).toBe("Impacto projetado de R$ 45,90/mês.");
  });

  it("the weekly summary reflects real counts and severity, never a hardcoded number", () => {
    const vm = toInsightsViewModel(
      baseData({
        alerts: [
          {
            id: alertId("a1"),
            type: "SAFE_TO_SPEND_MATERIAL_DROP",
            severity: "IMPORTANT",
            title: "x",
            evidence: {
              kind: "SAFE_TO_SPEND_MATERIAL_DROP",
              previousCents: 1,
              currentCents: 0,
              deltaCents: -1,
              relativeDropRatio: null,
            },
          },
        ],
        pendingRecommendations: [
          {
            id: recommendationId("r1"),
            type: "CANCEL_RECURRING_COST",
            title: "x",
            description: null,
            projectedMonthlyImpactCents: 0,
          },
        ],
      }),
    );
    expect(vm.summaryTitle).toBe("Seu ritmo pede atenção");
    expect(vm.summaryDetail).toBe("2 novidades merecem atenção, nada urgente.");
  });
});
