import { describe, expect, it } from "vitest";
import type { Id } from "@money-copilot/shared";
import type { PlanejamentoData } from "@/functions/planejamento";
import { toPlanejamentoViewModel } from "./planejamento";

function feId(raw: string): Id<"fixed-expense"> {
  return raw as Id<"fixed-expense">;
}
function eventId(raw: string): Id<"financial-event"> {
  return raw as Id<"financial-event">;
}

function baseData(overrides: Partial<PlanejamentoData> = {}): PlanejamentoData {
  return {
    asOfDate: "2026-09-05",
    safeToSpendCents: 184_200,
    incomeGrossCents: 720_000,
    fixedCommitmentsCents: 330_630,
    variableBudgetsCents: 156_240,
    eventsFutureConfirmedCents: 0,
    eventsFutureEstimatedCents: 0,
    fixedExpenses: [],
    upcomingEvents: [],
    ...overrides,
  };
}

describe("toPlanejamentoViewModel", () => {
  it("formats the available figure and the legend with percentages of gross income", () => {
    const vm = toPlanejamentoViewModel(baseData());
    expect(vm.availableLabel).toBe("R$ 1.842,00");
    expect(vm.legend[0]).toEqual({
      color: "brand",
      label: "Compromissos fixos",
      value: "R$ 3.306,30",
      percent: 46,
    });
  });

  it("sums fixed + variable + event reservations into a single outflow figure", () => {
    const vm = toPlanejamentoViewModel(
      baseData({ eventsFutureConfirmedCents: 10_000, eventsFutureEstimatedCents: 5_000 }),
    );
    expect(vm.outflowLabel).toBe("R$ 5.018,70"); // 3306.30 + 1562.40 + 100 + 50
  });

  it("never fabricates a timeline date — only real upcoming events appear, sorted soonest-first", () => {
    const vm = toPlanejamentoViewModel(
      baseData({
        upcomingEvents: [
          {
            id: eventId("later"),
            label: "Viagem em dezembro",
            startDate: "2026-12-10",
            endDate: "2026-12-12",
            knownReservedCents: 0,
            hasUnknownAmount: true,
          },
          {
            id: eventId("sooner"),
            label: "Beach trip (Sep 25-27)",
            startDate: "2026-09-25",
            endDate: "2026-09-27",
            knownReservedCents: 0,
            hasUnknownAmount: true,
          },
        ],
      }),
    );
    expect(vm.timeline.map((t) => t.id)).toEqual(["sooner", "later"]);
    expect(vm.timeline[0]!.dateLabel).toBe("25/09");
    expect(vm.timeline[0]!.valueLabel).toBe("A definir");
    expect(vm.timeline[0]!.note).toBe("Orçamento ainda não definido");
  });

  it("shows a real reserved amount when known, without implying a fabricated total", () => {
    const vm = toPlanejamentoViewModel(
      baseData({
        upcomingEvents: [
          {
            id: eventId("e1"),
            label: "Casamento do primo",
            startDate: "2026-10-05",
            endDate: "2026-10-05",
            knownReservedCents: 50_000,
            hasUnknownAmount: false,
          },
        ],
      }),
    );
    expect(vm.timeline[0]!.valueLabel).toBe("- R$ 500,00");
    expect(vm.timeline[0]!.note).toBe("Evento planejado");
    expect(vm.eventCards[0]!.progressPercent).toBe(100);
    expect(vm.eventCards[0]!.note).toBe("R$ 500,00 reservados para o evento");
  });

  it("never invents a partial percentage — a partially-known budget still shows 0% progress", () => {
    const vm = toPlanejamentoViewModel(
      baseData({
        upcomingEvents: [
          {
            id: eventId("e1"),
            label: "Viagem",
            startDate: "2026-10-05",
            endDate: "2026-10-05",
            knownReservedCents: 30_000,
            hasUnknownAmount: true,
          },
        ],
      }),
    );
    expect(vm.eventCards[0]!.progressPercent).toBe(0);
    expect(vm.eventCards[0]!.note).toBe("Orçamento parcialmente definido");
  });

  it("preserves the timeline/event-card shell with an honest empty state when there are no real upcoming events", () => {
    const vm = toPlanejamentoViewModel(baseData());
    expect(vm.timeline).toEqual([]);
    expect(vm.eventCards).toEqual([]);
  });

  it("sorts recurring commitments known-due-day-first, and never fabricates a due day", () => {
    const vm = toPlanejamentoViewModel(
      baseData({
        fixedExpenses: [
          { id: feId("unknown"), label: "Internet", amountCents: 12_000, dueDayOfMonth: null },
          { id: feId("known"), label: "Aluguel", amountCents: 180_000, dueDayOfMonth: 5 },
        ],
      }),
    );
    expect(vm.recorrentes.map((r) => r.id)).toEqual(["known", "unknown"]);
    expect(vm.recorrentes[0]!.detail).toBe("Todo mês · dia 5");
    expect(vm.recorrentes[1]!.detail).toBe("Todo mês");
    expect(vm.recorrentes[1]!.dueDayBadge).toBe("–");
  });
});
