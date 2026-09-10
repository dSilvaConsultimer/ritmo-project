import type { HomeData } from "@/functions/home";
import {
  brl,
  daysInMonth,
  dueDayBadge,
  formatDayMonth,
  formatMonthEndShortDate,
  greetingForHour,
  sortByDueDay,
} from "./format";

export interface HomeCompromisso {
  readonly id: string;
  readonly label: string;
  readonly category: string;
  readonly dueDayBadge: string;
  readonly detail: string;
  readonly amountLabel: string;
}

export interface HomeInsight {
  readonly title: string;
  readonly detail: string;
  readonly href: "/insights";
}

export interface HomeViewModel {
  readonly greeting: string;
  readonly displayName: string;
  readonly toneOk: boolean;
  readonly toneLabel: string;
  readonly safeToSpendLabel: string;
  readonly todayLabel: string;
  readonly endOfMonthDays: number;
  readonly endOfMonthLabel: string;
  readonly monthProgressPercent: number;
  readonly incomeLabel: string;
  readonly committedLabel: string;
  readonly upcoming: readonly HomeCompromisso[];
  readonly insight: HomeInsight | null;
}

function compromissoDetail(category: string, dueDayOfMonth: number | null): string {
  return dueDayOfMonth !== null ? `${category} · vence dia ${dueDayOfMonth}` : category;
}

/**
 * Pure reshaping only — no I/O, no financial calculation. Sorts upcoming
 * commitments with a known due day first (ascending), unknown-due-day ones
 * after, since real fixture data may not have a due day recorded yet (see
 * "Data-model gaps" — mock due-dates are never used here).
 */
export function toHomeViewModel(data: HomeData, now: Date = new Date()): HomeViewModel {
  const sortedExpenses = sortByDueDay(data.fixedExpenses);

  const upcoming: HomeCompromisso[] = sortedExpenses.slice(0, 3).map((e) => ({
    id: e.id,
    label: e.label,
    category: e.category,
    dueDayBadge: dueDayBadge(e.dueDayOfMonth),
    detail: compromissoDetail(e.category, e.dueDayOfMonth),
    amountLabel: brl(e.amountCents),
  }));

  let insight: HomeInsight | null = null;
  if (data.topAlert) {
    insight = {
      title: data.topAlert.title,
      detail: "Veja o motivo detalhado nos seus insights.",
      href: "/insights",
    };
  } else if (data.topPendingRecommendation) {
    insight = {
      title: data.topPendingRecommendation.title,
      detail:
        data.topPendingRecommendation.description ??
        "Uma oportunidade identificada no seu padrão de gastos.",
      href: "/insights",
    };
  }

  const totalDays = daysInMonth(data.asOfDate);
  const elapsedDays = Math.max(0, totalDays - data.daysRemainingInMonth);
  const monthProgressPercent = totalDays > 0 ? Math.round((elapsedDays / totalDays) * 100) : 0;

  const toneOk = data.safeToSpendCents >= 0 && data.topAlert?.severity !== "IMPORTANT";

  return {
    greeting: greetingForHour(now.getHours()),
    displayName: data.displayName,
    toneOk,
    toneLabel: toneOk ? "Seu ritmo está tranquilo" : "Seu ritmo pede atenção",
    safeToSpendLabel: brl(data.safeToSpendCents),
    todayLabel: `Hoje, ${formatDayMonth(data.asOfDate)}`,
    endOfMonthDays: data.daysRemainingInMonth,
    endOfMonthLabel: `Fim do mês em ${formatMonthEndShortDate(data.asOfDate)}`,
    monthProgressPercent,
    incomeLabel: brl(data.incomeCents),
    committedLabel: brl(data.committedCents),
    upcoming,
    insight,
  };
}
