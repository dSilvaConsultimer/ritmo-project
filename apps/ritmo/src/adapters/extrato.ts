import type { ExtratoData } from "@/functions/extrato";
import { brl, categoryPathLabel, formatMonthYearLabel, formatShortDayMonth } from "./format";

export interface ExtratoMovimento {
  readonly id: string;
  readonly label: string;
  readonly dateLabel: string;
  readonly amountLabel: string;
  readonly categoryLabel: string;
  readonly isCredit: boolean;
}

export interface ExtratoGroup {
  readonly key: string;
  readonly label: string;
  readonly items: readonly ExtratoMovimento[];
}

export interface ExtratoViewModel {
  readonly groups: readonly ExtratoGroup[];
  readonly isEmpty: boolean;
}

/**
 * Pure reshaping only — every transaction already comes newest-first from
 * `getTransactionHistory`, so this only groups by calendar month (reusing
 * the exact same "Sem categoria"/"Categoria › Subcategoria" formatting
 * `format.ts` already established) and never re-sorts or re-classifies
 * anything.
 */
export function toExtratoViewModel(data: ExtratoData): ExtratoViewModel {
  const groups: ExtratoGroup[] = [];
  let currentKey: string | null = null;
  let currentItems: ExtratoMovimento[] = [];

  const flush = () => {
    if (currentKey !== null) {
      groups.push({
        key: currentKey,
        label: formatMonthYearLabel(currentKey),
        items: currentItems,
      });
    }
  };

  for (const t of data.transactions) {
    const monthKey = t.date.slice(0, 7); // "YYYY-MM"
    if (monthKey !== currentKey) {
      flush();
      currentKey = monthKey;
      currentItems = [];
    }
    const isCredit = t.direction === "CREDIT";
    currentItems.push({
      id: t.id,
      label: t.label,
      dateLabel: formatShortDayMonth(t.date),
      amountLabel: `${isCredit ? "+ " : "- "}${brl(t.amountCents)}`,
      categoryLabel: categoryPathLabel(t.category, t.subcategory ?? undefined),
      isCredit,
    });
  }
  flush();

  return { groups, isEmpty: data.transactions.length === 0 };
}
