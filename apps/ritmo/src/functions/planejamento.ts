import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  getCategoriesForProfile,
  getCategoryRulesList,
  getCategorySpendingDetail,
  getCategoryTotals,
  getDb,
  getFinancialSnapshot,
  getFixedExpensesForProfile,
  getIncomesForProfile,
  getPendingConfirmations,
  getUpcomingFinancialEventsForProfile,
} from "@money-copilot/app-services";
import { getCurrentProfileContext } from "./profile.server";
import { resolveAsOfDate } from "./config";

export type SpendingPeriod = "current" | "previous";

/** The 1st of the month before `asOfDate`'s month — any date within that month works, since every category-total/date function only ever compares year+month. */
function previousMonthAsOfDate(asOfDate: string): string {
  const [year, month] = asOfDate.split("-").map(Number) as [number, number];
  const previous = new Date(Date.UTC(year, month - 1 - 1, 1));
  return previous.toISOString().slice(0, 10);
}

function resolveSpendingAsOfDate(realAsOfDate: string, period: SpendingPeriod): string {
  return period === "previous" ? previousMonthAsOfDate(realAsOfDate) : realAsOfDate;
}

/**
 * Raw data for the Planejamento screen. See `src/adapters/planejamento.ts`
 * for the presentation reshaping — in particular, the "Linha do mês"
 * timeline only ever gets entries with a real, known date (real upcoming
 * `FinancialEvent`s); it never fabricates a salary or bill-due date the
 * engine doesn't actually know (see docs/RITMO.md, "Data-model gaps").
 *
 * "Entradas previstas" here is deliberately the DECLARED/expected income
 * (`snapshot.income.gross`, the `incomes` table) — a forward-looking
 * planning figure, unlike Home's "Entradas do mês" (realized transactions —
 * see `home.ts` and docs/DECISIONS.md DEC-127). Both are correct for their
 * own screen; they answer different questions on purpose.
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
    const spendingAsOfDate = resolveSpendingAsOfDate(asOfDate, period);

    const [
      snapshot,
      fixedExpenses,
      incomes,
      upcomingEvents,
      categoryRules,
      pendingConfirmations,
      categories,
      categoryTotals,
    ] = await Promise.all([
      getFinancialSnapshot(db, financialProfileId, asOfDate),
      getFixedExpensesForProfile(db, financialProfileId, asOfDate),
      getIncomesForProfile(db, financialProfileId, asOfDate),
      getUpcomingFinancialEventsForProfile(db, financialProfileId, asOfDate),
      getCategoryRulesList(db, financialProfileId),
      getPendingConfirmations(db, financialProfileId, asOfDate),
      getCategoriesForProfile(db, financialProfileId),
      getCategoryTotals(db, financialProfileId, spendingAsOfDate),
    ]);

    return {
      asOfDate,
      safeToSpendCents: snapshot.safeToSpend.total.cents,
      incomeGrossCents: snapshot.income.gross.cents,
      fixedCommitmentsCents: snapshot.commitments.fixed.cents,
      variableBudgetsCents: snapshot.commitments.variableBudgets.cents,
      eventsFutureConfirmedCents: snapshot.commitments.futureConfirmed.cents,
      eventsFutureEstimatedCents: snapshot.commitments.futureEstimated.cents,
      fixedExpenses: fixedExpenses.map((e) => ({
        id: e.id,
        label: e.label,
        amountCents: e.amount.cents,
        dueDayOfMonth: e.dueDayOfMonth ?? null,
      })),
      incomes: incomes.map((i) => ({
        id: i.id,
        label: i.label,
        grossAmountCents: i.grossAmount.cents,
        expectedDayOfMonth: i.expectedDayOfMonth ?? null,
        source: i.source,
      })),
      upcomingEvents: upcomingEvents.map(({ event, breakdown }) => ({
        id: event.id,
        label: event.label,
        startDate: event.startDate,
        endDate: event.endDate,
        knownReservedCents: breakdown.futureConfirmed.cents + breakdown.futureEstimated.cents,
        hasUnknownAmount: breakdown.unknownLabels.length > 0,
      })),
      // DEC-132: "Regras e categorias" — the ONE canonical source, replacing
      // the old standalone `/categorias` screen entirely (see that route,
      // now a redirect here).
      categoryRules: categoryRules.map((r) => ({
        id: r.id,
        matchType: r.matchType,
        pattern: r.pattern,
        category: r.category,
        subcategory: r.subcategory ?? null,
        origin: r.origin,
      })),
      // DEC-132: "Ritmo precisa confirmar" — see `getPendingConfirmations`'s
      // own doc comment for what this aggregates and why. Flattened to
      // `*Cents` numbers, matching every other DTO field in this function —
      // `Money` itself is never sent across the RPC boundary directly.
      pendingConfirmations: pendingConfirmations.map((p) => {
        switch (p.kind) {
          case "UNCATEGORIZED_TRANSACTION":
            return {
              kind: p.kind,
              transactionId: p.transactionId,
              description: p.description,
              amountCents: p.amount.cents,
              direction: p.direction,
              date: p.date,
            };
          case "RECURRING_INCOME_CANDIDATE":
          case "RECURRING_EXPENSE_CANDIDATE":
            return {
              kind: p.kind,
              candidateId: p.candidateId,
              merchant: p.merchant,
              amountCents: p.amount.cents,
              occurrences: p.occurrences,
              confidence: p.confidence,
            };
          case "RECOMMENDATION":
            return {
              kind: p.kind,
              recommendationId: p.recommendationId,
              title: p.title,
              description: p.description ?? null,
              recommendationType: p.recommendationType,
            };
        }
      }),
      // DEC-135: the CategoryPicker's data source — every category visible to
      // this profile (base + personal).
      categories: categories
        .map((c) => ({ id: c.id, name: c.name, isBase: c.financialProfileId === undefined }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      // DEC-135: "Gastos por categoria" — real transactions, CONSUMPTION/FEE/
      // REFUND only (see `monthlyCategoryTotals`'s own doc comment for the
      // exact exclusion rule: TRANSFER/CARD_PAYMENT/INVESTMENT/INCOME never
      // appear here). `period` controls which calendar month this covers;
      // every other field on this response stays tied to the REAL current date.
      categorySpendingPeriod: period,
      categoryTotals: categoryTotals.map((t) => ({
        categoryId: t.categoryId,
        categoryName: t.categoryName,
        subcategory: t.subcategory ?? null,
        totalCents: t.total.cents,
        transactionCount: t.transactionCount,
      })),
    };
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
