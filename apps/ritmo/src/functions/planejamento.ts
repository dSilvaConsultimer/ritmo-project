import { createServerFn } from "@tanstack/react-start";
import {
  getCategoryRulesList,
  getDb,
  getFinancialSnapshot,
  getFixedExpensesForProfile,
  getIncomesForProfile,
  getPendingConfirmations,
  getUpcomingFinancialEventsForProfile,
} from "@money-copilot/app-services";
import { getCurrentProfileContext } from "./profile.server";
import { resolveAsOfDate } from "./config";

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
export const getPlanejamentoData = createServerFn({ method: "GET" }).handler(async () => {
  const { financialProfileId } = await getCurrentProfileContext();
  const db = await getDb();
  const asOfDate = resolveAsOfDate();

  const [snapshot, fixedExpenses, incomes, upcomingEvents, categoryRules, pendingConfirmations] =
    await Promise.all([
      getFinancialSnapshot(db, financialProfileId, asOfDate),
      getFixedExpensesForProfile(db, financialProfileId, asOfDate),
      getIncomesForProfile(db, financialProfileId, asOfDate),
      getUpcomingFinancialEventsForProfile(db, financialProfileId, asOfDate),
      getCategoryRulesList(db),
      getPendingConfirmations(db, financialProfileId, asOfDate),
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
  };
});

export type PlanejamentoData = Awaited<ReturnType<typeof getPlanejamentoData>>;
