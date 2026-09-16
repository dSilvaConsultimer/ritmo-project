import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getCategorySpendingDetail, getCategoryTotals, getDb } from "@money-copilot/app-services";
import { getCurrentProfileContext } from "./profile.server";
import { resolveAsOfDate } from "./config";
import { resolveSpendingAsOfDate, type SpendingPeriod } from "./planejamento-period";
import { buildPlanejamentoData } from "./planejamento-data.server";

export type { SpendingPeriod };

/**
 * Thin client-safe wrapper — see `planejamento-data.server.ts` for the real
 * logic and why it lives in its own `.server.ts` file (code-splitting, not
 * just testability).
 */
const getPlanejamentoDataInput = z.object({
  period: z.enum(["current", "previous"]).nullable().default(null),
});

export const getPlanejamentoData = createServerFn({ method: "GET" })
  .validator(getPlanejamentoDataInput)
  .handler(async ({ data }) => {
    const { financialProfileId } = await getCurrentProfileContext();
    const db = await getDb();
    const asOfDate = resolveAsOfDate();
    const period: SpendingPeriod = data.period ?? "current";
    return buildPlanejamentoData(db, financialProfileId, asOfDate, period);
  });

export type PlanejamentoData = Awaited<ReturnType<typeof getPlanejamentoData>>;

const getCategoryTotalsInput = z.object({ period: z.enum(["current", "previous"]) });

/** DEC-135: re-fetches "Gastos por categoria" for a different period without reloading the whole Planning screen. */
export const getCategoryTotalsAction = createServerFn({ method: "GET" })
  .validator(getCategoryTotalsInput)
  .handler(async ({ data }) => {
    const { financialProfileId } = await getCurrentProfileContext();
    const db = await getDb();
    const asOfDate = resolveSpendingAsOfDate(resolveAsOfDate(), data.period);
    const categoryTotals = await getCategoryTotals(db, financialProfileId, asOfDate);
    return categoryTotals.map((t) => ({
      categoryId: t.categoryId,
      categoryName: t.categoryName,
      subcategory: t.subcategory ?? null,
      totalCents: t.total.cents,
      transactionCount: t.transactionCount,
    }));
  });

const getCategorySpendingDetailInput = z.object({
  period: z.enum(["current", "previous"]),
  categoryId: z.string().min(1),
});

/**
 * DEC-135: Planning's category drill-down — the real transactions behind
 * one category's total, fetched on demand (never eagerly loaded for every
 * category up front).
 */
export const getCategorySpendingDetailAction = createServerFn({ method: "GET" })
  .validator(getCategorySpendingDetailInput)
  .handler(async ({ data }) => {
    const { financialProfileId } = await getCurrentProfileContext();
    const db = await getDb();
    const asOfDate = resolveSpendingAsOfDate(resolveAsOfDate(), data.period);
    const transactions = await getCategorySpendingDetail(
      db,
      financialProfileId,
      asOfDate,
      data.categoryId,
    );
    return transactions.map((t) => ({
      id: t.id,
      date: t.date,
      description: t.normalizedDescription || t.rawDescription,
      amountCents: t.amount.cents,
      direction: t.direction,
    }));
  });
