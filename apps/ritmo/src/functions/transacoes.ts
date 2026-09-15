import { createServerFn } from "@tanstack/react-start";
import { getDb, getFixedExpensesForProfile, getTransactions } from "@money-copilot/app-services";
import { getCurrentProfileContext } from "./profile.server";
import { resolveAsOfDate } from "./config";

/**
 * Raw data for the Transações screen. See `src/adapters/transacoes.ts` for
 * the presentation reshaping (grouping by Hoje/Ontem/Esta semana, etc.).
 */
export const getTransacoesData = createServerFn({ method: "GET" }).handler(async () => {
  const { financialProfileId } = await getCurrentProfileContext();
  const db = await getDb();
  const asOfDate = resolveAsOfDate();

  const [fixedExpenses, transactions] = await Promise.all([
    getFixedExpensesForProfile(db, financialProfileId, asOfDate),
    getTransactions(db, financialProfileId, asOfDate),
  ]);

  return {
    asOfDate,
    fixedExpenses: fixedExpenses.map((e) => ({
      id: e.id,
      label: e.label,
      category: e.category,
      amountCents: e.amount.cents,
      dueDayOfMonth: e.dueDayOfMonth ?? null,
    })),
    transactions: transactions.map((t) => ({
      id: t.id,
      date: t.date,
      label: t.normalizedMerchant ?? t.normalizedDescription,
      category: t.category,
      amountCents: t.amount.cents,
      direction: t.direction,
    })),
  };
});

export type TransacoesData = Awaited<ReturnType<typeof getTransacoesData>>;
