import type { TransacoesData } from "@/functions/transacoes";
import { brl, dueDayBadge, formatShortDate, shiftIsoDate, sortByDueDay } from "./format";

export interface TransacoesCompromisso {
  readonly id: string;
  readonly label: string;
  readonly dueDayBadge: string;
  readonly detail: string;
  readonly amountLabel: string;
}

export interface TransacoesMovimento {
  readonly id: string;
  readonly label: string;
  readonly tag: string;
  readonly dateLabel: string;
  readonly amountLabel: string;
  readonly isCredit: boolean;
}

export interface TransacoesGroup {
  readonly label: string;
  readonly items: readonly TransacoesMovimento[];
}

export interface TransacoesViewModel {
  readonly recorrentes: readonly TransacoesCompromisso[];
  readonly grupos: readonly TransacoesGroup[];
}

function detail(category: string, dueDayOfMonth: number | null): string {
  return dueDayOfMonth !== null ? `${category} · todo dia ${dueDayOfMonth}` : category;
}

/**
 * `@money-copilot/financial-engine`'s categorizer returns the literal
 * string `"UNCATEGORIZED"` (never `null`) when no rule matches — this
 * localizes that one known sentinel to the same "Sem categoria" label used
 * for an actually-null category, never inventing a category that wasn't
 * determined.
 */
function tagLabel(category: string | null): string {
  return category === null || category === "UNCATEGORIZED" ? "Sem categoria" : category;
}

/**
 * Pure reshaping only. Groups transactions by Hoje/Ontem/Esta semana
 * relative to `asOfDate` — the domain model only knows a transaction's
 * calendar date, never a time of day, so `dateLabel` shows the real date
 * (e.g. "04/09") instead of the clock time the Lovable mock used; this is
 * the same "copy may change only when the original claims something the
 * engine doesn't know" adaptation already applied on the Home screen. Any
 * group with no real transactions is simply omitted, never shown empty.
 */
export function toTransacoesViewModel(data: TransacoesData): TransacoesViewModel {
  const recorrentes: TransacoesCompromisso[] = sortByDueDay(data.fixedExpenses).map((e) => ({
    id: e.id,
    label: e.label,
    dueDayBadge: dueDayBadge(e.dueDayOfMonth),
    detail: detail(e.category, e.dueDayOfMonth),
    amountLabel: brl(e.amountCents),
  }));

  const today = data.asOfDate;
  const yesterday = shiftIsoDate(data.asOfDate, -1);
  const weekStart = shiftIsoDate(data.asOfDate, -7);

  const toMovimento = (t: TransacoesData["transactions"][number]): TransacoesMovimento => {
    const isCredit = t.direction === "CREDIT";
    return {
      id: t.id,
      label: t.label,
      tag: tagLabel(t.category),
      dateLabel: formatShortDate(t.date),
      amountLabel: `${isCredit ? "+ " : "- "}${brl(t.amountCents)}`,
      isCredit,
    };
  };

  const byDateDesc = (
    a: TransacoesData["transactions"][number],
    b: TransacoesData["transactions"][number],
  ) => b.date.localeCompare(a.date);

  const hoje = data.transactions
    .filter((t) => t.date === today)
    .slice()
    .sort(byDateDesc);
  const ontem = data.transactions
    .filter((t) => t.date === yesterday)
    .slice()
    .sort(byDateDesc);
  const estaSemana = data.transactions
    .filter((t) => t.date < yesterday && t.date >= weekStart)
    .slice()
    .sort(byDateDesc);

  const grupos: TransacoesGroup[] = [
    { label: "Hoje", items: hoje.map(toMovimento) },
    { label: "Ontem", items: ontem.map(toMovimento) },
    { label: "Esta semana", items: estaSemana.map(toMovimento) },
  ].filter((g) => g.items.length > 0);

  return { recorrentes, grupos };
}
