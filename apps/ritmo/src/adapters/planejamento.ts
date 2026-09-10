import type { PlanejamentoData } from "@/functions/planejamento";
import { brl, dueDayBadge, formatShortDate, sortByDueDay } from "./format";

export interface PlanejamentoLegendItem {
  readonly color: "brand" | "coral" | "success";
  readonly label: string;
  readonly value: string;
  readonly percent: number;
}

export interface PlanejamentoTimelineEntry {
  readonly id: string;
  readonly dateLabel: string;
  readonly title: string;
  readonly valueLabel: string;
  readonly note: string;
  readonly tone: "in" | "out" | "plan";
}

export interface PlanejamentoEventCard {
  readonly id: string;
  readonly title: string;
  readonly note: string;
  readonly progressPercent: number;
}

export interface PlanejamentoRecorrente {
  readonly id: string;
  readonly label: string;
  readonly dueDayBadge: string;
  readonly detail: string;
  readonly amountLabel: string;
}

export interface PlanejamentoViewModel {
  readonly availableLabel: string;
  readonly legend: readonly PlanejamentoLegendItem[];
  readonly incomeLabel: string;
  readonly outflowLabel: string;
  readonly timeline: readonly PlanejamentoTimelineEntry[];
  readonly recorrentes: readonly PlanejamentoRecorrente[];
  readonly eventCards: readonly PlanejamentoEventCard[];
}

function percentOf(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

/**
 * Pure reshaping only. The "Linha do mês" timeline only ever gets entries
 * with a real, known date — real upcoming `FinancialEvent`s — never a
 * fabricated salary or bill due-date (see "Data-model gaps": no pay-date on
 * `Income`, and most fixture `FixedExpense`s have no confirmed due day yet).
 * As due dates/pay-dates become known, this same adapter/component will
 * pick them up automatically; the component shell itself is unchanged
 * whether the timeline holds many entries or none yet.
 */
export function toPlanejamentoViewModel(data: PlanejamentoData): PlanejamentoViewModel {
  const outflowCents =
    data.fixedCommitmentsCents +
    data.variableBudgetsCents +
    data.eventsFutureConfirmedCents +
    data.eventsFutureEstimatedCents;
  const eventsReservedCents = data.eventsFutureConfirmedCents + data.eventsFutureEstimatedCents;

  const legend: PlanejamentoLegendItem[] = [
    {
      color: "brand",
      label: "Compromissos fixos",
      value: brl(data.fixedCommitmentsCents),
      percent: percentOf(data.fixedCommitmentsCents, data.incomeGrossCents),
    },
    {
      color: "coral",
      label: "Gastos variáveis",
      value: brl(data.variableBudgetsCents),
      percent: percentOf(data.variableBudgetsCents, data.incomeGrossCents),
    },
    {
      color: "success",
      label: "Reservado para eventos",
      value: brl(eventsReservedCents),
      percent: percentOf(eventsReservedCents, data.incomeGrossCents),
    },
  ];

  const sortedEvents = [...data.upcomingEvents].sort((a, b) =>
    a.startDate.localeCompare(b.startDate),
  );

  const timeline: PlanejamentoTimelineEntry[] = sortedEvents.map((e) => {
    const hasKnownAmount = e.knownReservedCents > 0;
    let note: string;
    let valueLabel: string;
    if (e.hasUnknownAmount && !hasKnownAmount) {
      note = "Orçamento ainda não definido";
      valueLabel = "A definir";
    } else if (e.hasUnknownAmount) {
      note = "Orçamento parcialmente definido";
      valueLabel = `- ${brl(e.knownReservedCents)}`;
    } else {
      note = "Evento planejado";
      valueLabel = `- ${brl(e.knownReservedCents)}`;
    }
    return {
      id: e.id,
      dateLabel: formatShortDate(e.startDate),
      title: e.label,
      valueLabel,
      note,
      tone: "plan",
    };
  });

  const eventCards: PlanejamentoEventCard[] = sortedEvents.map((e) => {
    // A percentage is only ever shown once every line item has a known
    // amount — there's no real "target" to measure partial progress
    // against, so a partially-known budget gets the same honest 0% fill as
    // a fully-unknown one (never an invented in-between number).
    if (e.hasUnknownAmount) {
      return {
        id: e.id,
        title: e.label,
        note:
          e.knownReservedCents > 0
            ? "Orçamento parcialmente definido"
            : "Orçamento ainda não definido",
        progressPercent: 0,
      };
    }
    return {
      id: e.id,
      title: e.label,
      note: `${brl(e.knownReservedCents)} reservados para o evento`,
      progressPercent: 100,
    };
  });

  const recorrentes: PlanejamentoRecorrente[] = sortByDueDay(data.fixedExpenses).map((e) => ({
    id: e.id,
    label: e.label,
    dueDayBadge: dueDayBadge(e.dueDayOfMonth),
    detail: e.dueDayOfMonth !== null ? `Todo mês · dia ${e.dueDayOfMonth}` : "Todo mês",
    amountLabel: brl(e.amountCents),
  }));

  return {
    availableLabel: brl(data.safeToSpendCents),
    legend,
    incomeLabel: brl(data.incomeGrossCents),
    outflowLabel: brl(outflowCents),
    timeline,
    recorrentes,
    eventCards,
  };
}
