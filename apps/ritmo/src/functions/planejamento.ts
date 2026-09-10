import { createServerFn } from "@tanstack/react-start";
import {
  getDb,
  getFinancialSnapshot,
  getFixedExpensesForProfile,
  getUpcomingFinancialEventsForProfile,
} from "@money-copilot/app-services";
import { getCurrentProfileContext } from "./profile-context";
import { ASOF_DATE } from "./config";

/**
 * Raw data for the Planejamento screen. See `src/adapters/planejamento.ts`
 * for the presentation reshaping — in particular, the "Linha do mês"
 * timeline only ever gets entries with a real, known date (real upcoming
 * `FinancialEvent`s); it never fabricates a salary or bill-due date the
 * engine doesn't actually know (see docs/RITMO.md, "Data-model gaps").
 */
export const getPlanejamentoData = createServerFn({ method: "GET" }).handler(async () => {
  const { financialProfileId } = getCurrentProfileContext();
  const db = await getDb();

  const [snapshot, fixedExpenses, upcomingEvents] = await Promise.all([
    getFinancialSnapshot(db, financialProfileId, ASOF_DATE),
    getFixedExpensesForProfile(db, financialProfileId, ASOF_DATE),
    getUpcomingFinancialEventsForProfile(db, financialProfileId, ASOF_DATE),
  ]);

  return {
    asOfDate: ASOF_DATE,
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
    upcomingEvents: upcomingEvents.map(({ event, breakdown }) => ({
      id: event.id,
      label: event.label,
      startDate: event.startDate,
      endDate: event.endDate,
      knownReservedCents: breakdown.futureConfirmed.cents + breakdown.futureEstimated.cents,
      hasUnknownAmount: breakdown.unknownLabels.length > 0,
    })),
  };
});

export type PlanejamentoData = Awaited<ReturnType<typeof getPlanejamentoData>>;
