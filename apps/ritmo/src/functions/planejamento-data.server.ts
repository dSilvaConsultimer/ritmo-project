import type { Database } from "@money-copilot/persistence";
import type {
  FinancialSnapshot,
  LiquiditySafeToSpendComponentType,
} from "@money-copilot/financial-engine";
import {
  getCategoriesForProfile,
  getCategoryRulesList,
  getCategoryTotals,
  getFinancialSnapshot,
  getFixedExpensesForProfile,
  getIncomesForProfile,
  getPendingConfirmations,
  getPlanningForecast,
  getUpcomingFinancialEventsForProfile,
} from "@money-copilot/app-services";
import { resolveSpendingAsOfDate, type SpendingPeriod } from "./planejamento-period";

/**
 * DEC-137 (Issue B): the absolute amount of one `snapshot.liquidity`
 * component, by type — `undefined` when `basis` is `PLAN_BASED` (the
 * `components` array is empty in that case) or when this particular
 * component simply wasn't relevant (e.g. no card balance, no upcoming
 * event reservations). Every `LiquiditySafeToSpendComponent.amount` is
 * already signed (negative for an outflow, positive for the base cash
 * figure or an inflow) — this returns the absolute value, since every
 * caller below treats sign as "which direction," not part of the number.
 */
function liquidityComponentCents(
  snapshot: FinancialSnapshot,
  type: LiquiditySafeToSpendComponentType,
): number | undefined {
  const component = snapshot.liquidity.components.find((c) => c.type === type);
  return component ? Math.abs(component.amount.cents) : undefined;
}

/**
 * Raw data for the Planejamento screen. See `src/adapters/planejamento.ts`
 * for the presentation reshaping — in particular, the "Linha do mês"
 * timeline only ever gets entries with a real, known date (real upcoming
 * `FinancialEvent`s); it never fabricates a salary or bill-due date the
 * engine doesn't actually know (see docs/RITMO.md, "Data-model gaps").
 *
 * DEC-137: every forward-looking figure below now reads the SAME canonical
 * `snapshot.liquidity` the engine already computes for Home (never a
 * second calculation in this file) — `availableCents` is
 * `snapshot.liquidity.recommendedTotal`, exactly what Home's
 * `safeToSpendCents` reads, so the two screens can never disagree for the
 * same profile/asOfDate/snapshot (see `home-planejamento-consistency.test.ts`).
 * When real liquidity is unknown (`basis: "PLAN_BASED"` — no connected
 * account yet), each figure falls back to the previously-existing
 * plan-based field, exactly as it behaved before this decision.
 *
 * Lives in its own `.server.ts` file (not inline in `planejamento.ts`'s
 * `createServerFn` handler, and not a plain export of that non-suffixed
 * file either) so this test can call it directly WITHOUT breaking
 * TanStack Start's client/server code-split — see `home.server.ts`'s own
 * doc comment for the exact regression this structure avoids (a plain
 * exported function with this dependency chain leaked `pg`/`openai`/
 * `pluggy-sdk` into the client bundle when it lived in the non-suffixed
 * file).
 */
export async function buildPlanejamentoData(
  db: Database,
  financialProfileId: string,
  asOfDate: string,
  period: SpendingPeriod,
) {
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
    forecast,
  ] = await Promise.all([
    getFinancialSnapshot(db, financialProfileId, asOfDate),
    getFixedExpensesForProfile(db, financialProfileId, asOfDate),
    getIncomesForProfile(db, financialProfileId, asOfDate),
    getUpcomingFinancialEventsForProfile(db, financialProfileId, asOfDate),
    getCategoryRulesList(db, financialProfileId),
    getPendingConfirmations(db, financialProfileId, asOfDate),
    getCategoriesForProfile(db, financialProfileId),
    getCategoryTotals(db, financialProfileId, spendingAsOfDate),
    getPlanningForecast(db, financialProfileId, asOfDate),
  ]);

  const isLiquidityAware = snapshot.liquidity.basis === "LIQUIDITY_AWARE";

  return {
    asOfDate,
    // DEC-137: the ONE canonical current-month available figure — see this
    // function's own doc comment. Never `snapshot.safeToSpend.total`
    // directly (that was this bug's exact root cause: a PLAN_BASED-only
    // figure that ignores real liquidity, shown alongside Home's
    // liquidity-aware one for the same profile).
    availableCents: snapshot.liquidity.recommendedTotal.cents,
    availableBasis: snapshot.liquidity.basis,
    // "Dinheiro disponível agora" — real current usable cash, when known.
    currentUsableCashCents: liquidityComponentCents(snapshot, "CURRENT_AVAILABLE_CASH") ?? null,
    // DEC-140: "Entradas previstas" is now the PREDICTED normal monthly
    // income — the average of the last 3 completed months' real INCOME-effect
    // totals (`computeExpectedMonthlyIncome`), the SAME model for a salaried
    // or self-employed profile. Deliberately shown REGARDLESS of whether
    // this month's income has already been realized — that's a completely
    // separate concern this figure never touches (Safe-to-Spend's own
    // FUTURE_CONFIRMED_INCOME reconciliation, unchanged, is what actually
    // prevents double-counting — see `home-planejamento-consistency.test.ts`).
    futureIncomeCents: forecast.expectedMonthlyIncome.cents,
    // DEC-140: "Compromissos fixos" is now the predicted monthly total of
    // DETECTED recurring commitments (`detectRecurringFixedCommitments`) —
    // built from transaction BEHAVIOR (identity + monthly cadence over 3+
    // consecutive completed months), never from `Category.name` and never
    // requiring a declared `FixedExpense` row. Amounts are averaged, never
    // required to be identical (rent vs. a varying electricity bill are
    // both "fixed" in this sense).
    fixedCommitmentsCents: forecast.recurringFixedTotal.cents,
    // DEC-140: "Gastos variáveis" is the residual predicted monthly
    // spending — eligible consumption minus the same recognized recurring
    // patterns above minus finite installments (`computeExpectedMonthlyVariableSpending`).
    variableBudgetsCents: forecast.expectedMonthlyVariableSpending.cents,
    // "Reservado para eventos" — unpaid/future-only event reservations.
    eventsFutureConfirmedCents: isLiquidityAware
      ? (liquidityComponentCents(snapshot, "UPCOMING_EVENT_RESERVATIONS") ?? 0)
      : snapshot.commitments.futureConfirmed.cents,
    eventsFutureEstimatedCents: isLiquidityAware ? 0 : snapshot.commitments.futureEstimated.cents,
    // "Saídas previstas" — card + debt/installment obligations. This is
    // what was silently missing before: the old figure summed
    // fixed+variable+events (never card), so a real card balance never
    // appeared anywhere in the summary.
    cardAndInstallmentsCents: isLiquidityAware
      ? (liquidityComponentCents(snapshot, "CARD_OBLIGATIONS") ?? 0) +
        (liquidityComponentCents(snapshot, "DEBT_COMMITMENTS") ?? 0)
      : snapshot.commitments.debtCommitments.cents,
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
}
