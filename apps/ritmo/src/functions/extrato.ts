import { createServerFn } from "@tanstack/react-start";
import { getDb, getTransactionHistory } from "@money-copilot/app-services";
import { getCurrentProfileContext } from "./profile.server";
import { resolveAsOfDate } from "./config";

/**
 * Raw data for the Extrato screen (DEC-129) — the full, all-time
 * transaction ledger for the current profile. A pure read model over
 * `financial_transactions` via `getTransactionHistory`; never mutates it,
 * never date-windowed (unlike Transações, which is current-month only —
 * see `functions/transacoes.ts`). See `src/adapters/extrato.ts` for the
 * presentation reshaping (friendly label, category path, month grouping).
 */
export const getExtratoData = createServerFn({ method: "GET" }).handler(async () => {
  const { financialProfileId } = await getCurrentProfileContext();
  const db = await getDb();
  const asOfDate = resolveAsOfDate();

  const transactions = await getTransactionHistory(db, financialProfileId, asOfDate);

  return {
    transactions: transactions.map((t) => ({
      id: t.id,
      date: t.date,
      label: t.normalizedMerchant ?? t.normalizedDescription,
      amountCents: t.amount.cents,
      direction: t.direction,
      category: t.category,
      subcategory: t.subcategory ?? null,
    })),
  };
});

export type ExtratoData = Awaited<ReturnType<typeof getExtratoData>>;
