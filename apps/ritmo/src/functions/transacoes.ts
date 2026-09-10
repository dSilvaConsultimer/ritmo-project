import { createServerFn } from "@tanstack/react-start";
import { getDb, getFixedExpensesForProfile, getTransactions } from "@money-copilot/app-services";
import { getCurrentProfileContext } from "./profile-context";
import { ASOF_DATE } from "./config";

/**
 * Raw data for the Transações screen. See `src/adapters/transacoes.ts` for
 * the presentation reshaping (grouping by Hoje/Ontem/Esta semana, etc.).
 */
export const getTransacoesData = createServerFn({ method: "GET" }).handler(async () => {
  const { financialProfileId } = getCurrentProfileContext();
  const db = await getDb();

  const [fixedExpenses, transactions] = await Promise.all([
    getFixedExpensesForProfile(db, financialProfileId, ASOF_DATE),
    getTransactions(db, financialProfileId, ASOF_DATE),
  ]);

  return {
    asOfDate: ASOF_DATE,
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
