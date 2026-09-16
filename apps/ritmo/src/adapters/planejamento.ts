import type { PlanejamentoData } from "@/functions/planejamento";
import { brl, dueDayBadge, formatShortDate, sortByDueDay } from "./format";

const MATCH_TYPE_LABEL: Record<string, string> = {
  EXACT_MERCHANT: "Comerciante exato",
  CONTAINS_MERCHANT: "Contém no comerciante",
  CONTAINS_DESCRIPTION: "Contém na descrição",
  REGEX_DESCRIPTION: "Padrão na descrição",
};

const ORIGIN_LABEL: Record<string, string> = {
  SYSTEM_DEFAULT: "Padrão do Ritmo",
  USER_DECLARED: "Criada por você",
  HISTORY_INFERRED: "Sugerida pelo Ritmo",
  USER_CONFIRMED_HISTORY: "Confirmada por você",
};

const CONFIDENCE_LABEL: Record<string, string> = {
  HIGH: "Alta confiança",
  MEDIUM: "Confiança média",
  LOW: "Baixa confiança",
};

export interface PlanejamentoIncomeItem {
  readonly id: string;
  readonly label: string;
  readonly amountLabel: string;
  readonly dayBadge: string;
}

export interface PlanejamentoRuleItem {
  readonly id: string;
  readonly summary: string;
  readonly matchLabel: string;
  readonly originLabel: string;
  readonly deletable: boolean;
}

export type PendingConfirmationView =
  | {
      readonly kind: "UNCATEGORIZED_TRANSACTION";
      readonly transactionId: string;
      readonly title: string;
      readonly subtitle: string;
      readonly amountLabel: string;
    }
  | {
      readonly kind: "RECURRING_INCOME_CANDIDATE";
      readonly candidateId: string;
      readonly title: string;
      readonly subtitle: string;
      readonly amountLabel: string;
    }
  | {
      readonly kind: "RECURRING_EXPENSE_CANDIDATE";
      readonly candidateId: string;
      readonly title: string;
      readonly subtitle: string;
      readonly amountLabel: string;
    }
  | {
      readonly kind: "RECOMMENDATION";
      readonly recommendationId: string;
      readonly title: string;
      readonly subtitle: string;
    };

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
  /** "Dinheiro disponível agora" — real current usable cash, when known (DEC-137); `null` when liquidity is unknown (no connected account yet). */
  readonly currentUsableLabel: string | null;
  readonly legend: readonly PlanejamentoLegendItem[];
  readonly incomeLabel: string;
  readonly outflowLabel: string;
  readonly timeline: readonly PlanejamentoTimelineEntry[];
  readonly recorrentes: readonly PlanejamentoRecorrente[];
  readonly eventCards: readonly PlanejamentoEventCard[];
  readonly incomeItems: readonly PlanejamentoIncomeItem[];
  readonly rules: readonly PlanejamentoRuleItem[];
  readonly pendingConfirmations: readonly PendingConfirmationView[];
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
  const eventsReservedCents = data.eventsFutureConfirmedCents + data.eventsFutureEstimatedCents;
  // DEC-137: the legend bar's "whole" is real current usable cash (when
  // known) — what's actually being carved up by these commitments —
  // rather than declared gross income, which no longer feeds this screen
  // at all (see `availableCents`'s own doc comment in `functions/planejamento.ts`).
  const percentBaseCents = data.currentUsableCashCents ?? 0;

  const legend: PlanejamentoLegendItem[] = [
    {
      color: "brand",
      label: "Compromissos fixos",
      value: brl(data.fixedCommitmentsCents),
      percent: percentOf(data.fixedCommitmentsCents, percentBaseCents),
    },
    {
      color: "coral",
      label: "Gastos variáveis",
      value: brl(data.variableBudgetsCents),
      percent: percentOf(data.variableBudgetsCents, percentBaseCents),
    },
    {
      color: "success",
      label: "Reservado para eventos",
      value: brl(eventsReservedCents),
      percent: percentOf(eventsReservedCents, percentBaseCents),
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

  const incomeItems: PlanejamentoIncomeItem[] = [...data.incomes]
    .sort((a, b) => (a.expectedDayOfMonth ?? 99) - (b.expectedDayOfMonth ?? 99))
    .map((i) => ({
      id: i.id,
      label: i.label,
      amountLabel: brl(i.grossAmountCents),
      dayBadge: dueDayBadge(i.expectedDayOfMonth),
    }));

  const rules: PlanejamentoRuleItem[] = [...data.categoryRules]
    .sort((a, b) => a.category.localeCompare(b.category) || a.pattern.localeCompare(b.pattern))
    .map((r) => ({
      id: r.id,
      summary: r.subcategory ? `${r.category} · ${r.subcategory}` : r.category,
      matchLabel: `${MATCH_TYPE_LABEL[r.matchType] ?? r.matchType}: "${r.pattern}"`,
      originLabel: ORIGIN_LABEL[r.origin] ?? r.origin,
      // A system-default rule ships with the app for everyone — only a
      // rule this specific user actually authored can be removed.
      deletable: r.origin !== "SYSTEM_DEFAULT",
    }));

  const pendingConfirmations: PendingConfirmationView[] = data.pendingConfirmations.map((p) => {
    switch (p.kind) {
      case "UNCATEGORIZED_TRANSACTION":
        return {
          kind: p.kind,
          transactionId: p.transactionId,
          title: p.description,
          subtitle: `${formatShortDate(p.date)} · O que foi isso?`,
          amountLabel: `${p.direction === "DEBIT" ? "-" : "+"} ${brl(p.amountCents)}`,
        };
      case "RECURRING_INCOME_CANDIDATE":
        return {
          kind: p.kind,
          candidateId: p.candidateId,
          title: p.merchant,
          subtitle: `Parece uma entrada mensal · ${CONFIDENCE_LABEL[p.confidence] ?? p.confidence}`,
          amountLabel: brl(p.amountCents),
        };
      case "RECURRING_EXPENSE_CANDIDATE":
        return {
          kind: p.kind,
          candidateId: p.candidateId,
          title: p.merchant,
          subtitle: `Parece um gasto mensal · ${CONFIDENCE_LABEL[p.confidence] ?? p.confidence}`,
          amountLabel: brl(p.amountCents),
        };
      case "RECOMMENDATION":
        return {
          kind: p.kind,
          recommendationId: p.recommendationId,
          title: p.title,
          subtitle: p.description ?? "Recomendação do Ritmo",
        };
    }
  });

  return {
    availableLabel: brl(data.availableCents),
    currentUsableLabel:
      data.currentUsableCashCents !== null ? brl(data.currentUsableCashCents) : null,
    legend,
    incomeLabel: brl(data.futureIncomeCents),
    outflowLabel: brl(data.cardAndInstallmentsCents),
    timeline,
    recorrentes,
    eventCards,
    incomeItems,
    rules,
    pendingConfirmations,
  };
}
